/**
 * Action implementations for the paper-waiver attestation flow. Members
 * print, sign, and physically hand a waiver to an officer; the officer
 * marks them attested in `/members/waivers`. The signed PDF stays
 * off-platform with the Treasurer per Bylaw 1.3 — this module only
 * tracks who attested whom and when.
 *
 * Follows the shell + .server.ts split — the shell in `./waiver-fns.ts`
 * dynamic-imports each action so server-only code never reaches the
 * client bundle.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { WAIVER_VERSION } from "#/config/legal";
import { currentWaiverCycle } from "#/config/waiver-cycle";
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { getDb, schema } from "#/server/db";

// ── auth helpers ────────────────────────────────────────────────────────

/**
 * Loads the current principal and asserts they hold `waivers:verify`.
 * Held by Treasurer + President + system_admin; the latter via the
 * blanket bypass in principal.server.ts.
 */
async function requireWaiverVerifier(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("waivers:verify")) {
    throw new Error("Forbidden: missing waivers:verify");
  }
  return principal;
}

async function requireSignedIn(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  return principal;
}

// ── types ──────────────────────────────────────────────────────────────

export interface WaiverAttestationSummary {
  id: string;
  cycle: string;
  version: string;
  attestedAt: Date;
  attestedByUserId: string;
  attestedByPreferredName: string | null;
  attestedByEmail: string;
  revokedAt: Date | null;
  revokedByUserId: string | null;
  revocationReason: string | null;
  notes: string | null;
}

export interface WaiverStatus {
  cycle: string;
  version: string;
  current: WaiverAttestationSummary | null;
}

export interface MemberNeedingAttestation {
  userId: string;
  publicId: string;
  email: string;
  preferredName: string | null;
  fullName: string | null;
  ucAffiliation: string | null;
  approvedAt: Date | null;
}

// ── reads ──────────────────────────────────────────────────────────────

/**
 * Returns the caller's full attestation history (oldest first). Member-
 * facing read for `/account/waiver` history list.
 */
export async function listMyWaiverHistoryAction(): Promise<
  WaiverAttestationSummary[]
> {
  const principal = await requireSignedIn();
  return loadAttestationHistory(principal.userId);
}

/**
 * Officer-only equivalent for inspecting another member's history from
 * the `/members/waivers` side sheet.
 */
export async function listWaiverHistoryForUserAction(input: {
  userId: string;
}): Promise<WaiverAttestationSummary[]> {
  await requireWaiverVerifier();
  return loadAttestationHistory(input.userId);
}

/**
 * Returns the caller's status for the current cycle: the most recent
 * non-revoked attestation row that matches `(currentWaiverCycle(),
 * WAIVER_VERSION)`, or `null` if missing/expired.
 */
export async function getMyCurrentWaiverStatusAction(): Promise<WaiverStatus> {
  const principal = await requireSignedIn();
  const cycle = currentWaiverCycle();
  const current = await loadCurrentAttestation(principal.userId, cycle);
  return { cycle, version: WAIVER_VERSION, current };
}

/**
 * Officer queue: returns approved members who do NOT have a
 * non-revoked attestation for the current cycle + version. Sorted by
 * approval date (oldest first) so newer pending arrivals fall to the
 * bottom of the list.
 */
export async function listMembersNeedingAttestationAction(): Promise<
  MemberNeedingAttestation[]
> {
  await requireWaiverVerifier();
  const db = getDb();
  const cycle = currentWaiverCycle();

  // Subquery: users with a current, non-revoked attestation for this
  // cycle + version. We anti-join against this set.
  const attestedSubquery = db
    .select({ userId: schema.waiverAttestations.userId })
    .from(schema.waiverAttestations)
    .where(
      and(
        eq(schema.waiverAttestations.cycle, cycle),
        eq(schema.waiverAttestations.version, WAIVER_VERSION),
        isNull(schema.waiverAttestations.revokedAt),
      ),
    );

  const rows = await db
    .select({
      userId: schema.users.id,
      publicId: schema.users.publicId,
      email: schema.users.email,
      approvedAt: schema.users.approvedAt,
      preferredName: schema.profiles.preferredName,
      fullName: schema.profiles.fullName,
      ucAffiliation: schema.profiles.ucAffiliation,
    })
    .from(schema.users)
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .where(
      and(
        eq(schema.users.status, "approved"),
        sql`${schema.users.id} NOT IN ${attestedSubquery}`,
      ),
    )
    .orderBy(asc(schema.users.approvedAt), asc(schema.users.email));

  return rows;
}

// ── writes ─────────────────────────────────────────────────────────────

/**
 * Officer marks `userId` attested for the current cycle. Inserts a new
 * row; previous attestations for the same `(userId, cycle, version)`
 * stay untouched (history preserved). Throws if the target isn't an
 * approved member.
 */
export async function attestWaiverAction(input: {
  userId: string;
  notes?: string;
}): Promise<{ id: string }> {
  const officer = await requireWaiverVerifier();
  const db = getDb();

  const target = await db.query.users.findFirst({
    where: eq(schema.users.id, input.userId),
    columns: { id: true, status: true },
  });
  if (!target) {
    throw new Error("Target user not found");
  }
  if (target.status !== "approved") {
    throw new Error("Cannot attest a non-approved member");
  }

  const id = `wa_${uuidv7()}`;
  await db.insert(schema.waiverAttestations).values({
    id,
    userId: input.userId,
    cycle: currentWaiverCycle(),
    version: WAIVER_VERSION,
    attestedAt: new Date(),
    attestedBy: officer.userId,
    notes: input.notes?.trim() || null,
  });
  return { id };
}

/**
 * Bulk-attest variant for when an officer has a stack of paper waivers
 * to process at the start of the season. All-or-nothing per row: each
 * insert validates the same target-status precondition; an invalid
 * userId throws and aborts the whole call before any rows are written
 * (drizzle-kit doesn't expose a true transaction over D1, so we
 * pre-validate in one query, then write).
 */
export async function bulkAttestWaiversAction(input: {
  userIds: string[];
  notes?: string;
}): Promise<{ count: number }> {
  const officer = await requireWaiverVerifier();
  if (input.userIds.length === 0) {
    return { count: 0 };
  }
  const db = getDb();

  // Pre-validate every target is approved — fail before any insert if
  // even one is wrong. drizzle-kit doesn't expose a true transaction
  // over D1, so the pre-check + multi-row insert is best-effort.
  const allTargets = await db.query.users.findMany({
    where: (users, { inArray }) => inArray(users.id, input.userIds),
    columns: { id: true, status: true },
  });
  const found = new Set(allTargets.map((t) => t.id));
  for (const id of input.userIds) {
    if (!found.has(id)) {
      throw new Error(`Target user not found: ${id}`);
    }
  }
  for (const t of allTargets) {
    if (t.status !== "approved") {
      throw new Error(`Cannot attest non-approved member: ${t.id}`);
    }
  }

  const cycle = currentWaiverCycle();
  const now = new Date();
  const notes = input.notes?.trim() || null;
  const rows = input.userIds.map((userId) => ({
    id: `wa_${uuidv7()}`,
    userId,
    cycle,
    version: WAIVER_VERSION,
    attestedAt: now,
    attestedBy: officer.userId,
    notes,
  }));
  await db.insert(schema.waiverAttestations).values(rows);

  return { count: rows.length };
}

/**
 * Officer revokes a prior attestation, supplying a reason. The row
 * stays for audit history; the member's `requireCurrentWaiver` guard
 * stops counting it because the row now has a `revokedAt`.
 */
export async function revokeWaiverAttestationAction(input: {
  attestationId: string;
  reason: string;
}): Promise<{ ok: true }> {
  const officer = await requireWaiverVerifier();
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Revocation reason is required");
  }
  const db = getDb();

  const existing = await db.query.waiverAttestations.findFirst({
    where: eq(schema.waiverAttestations.id, input.attestationId),
    columns: { id: true, revokedAt: true },
  });
  if (!existing) {
    throw new Error("Attestation not found");
  }
  if (existing.revokedAt) {
    throw new Error("Attestation already revoked");
  }

  await db
    .update(schema.waiverAttestations)
    .set({
      revokedAt: new Date(),
      revokedBy: officer.userId,
      revocationReason: reason,
    })
    .where(eq(schema.waiverAttestations.id, input.attestationId));

  return { ok: true };
}

// ── internals ──────────────────────────────────────────────────────────

async function loadAttestationHistory(
  userId: string,
): Promise<WaiverAttestationSummary[]> {
  const db = getDb();
  const att = schema.waiverAttestations;
  const attestor = schema.users;
  const profile = schema.profiles;

  const rows = await db
    .select({
      id: att.id,
      cycle: att.cycle,
      version: att.version,
      attestedAt: att.attestedAt,
      attestedByUserId: att.attestedBy,
      attestedByEmail: attestor.email,
      attestedByPreferredName: profile.preferredName,
      revokedAt: att.revokedAt,
      revokedByUserId: att.revokedBy,
      revocationReason: att.revocationReason,
      notes: att.notes,
    })
    .from(att)
    .innerJoin(attestor, eq(attestor.id, att.attestedBy))
    .leftJoin(profile, eq(profile.userId, att.attestedBy))
    .where(eq(att.userId, userId))
    .orderBy(desc(att.attestedAt));

  return rows;
}

async function loadCurrentAttestation(
  userId: string,
  cycle: string,
): Promise<WaiverAttestationSummary | null> {
  const db = getDb();
  const att = schema.waiverAttestations;
  const attestor = schema.users;
  const profile = schema.profiles;

  const row = await db
    .select({
      id: att.id,
      cycle: att.cycle,
      version: att.version,
      attestedAt: att.attestedAt,
      attestedByUserId: att.attestedBy,
      attestedByEmail: attestor.email,
      attestedByPreferredName: profile.preferredName,
      revokedAt: att.revokedAt,
      revokedByUserId: att.revokedBy,
      revocationReason: att.revocationReason,
      notes: att.notes,
    })
    .from(att)
    .innerJoin(attestor, eq(attestor.id, att.attestedBy))
    .leftJoin(profile, eq(profile.userId, att.attestedBy))
    .where(
      and(
        eq(att.userId, userId),
        eq(att.cycle, cycle),
        eq(att.version, WAIVER_VERSION),
        isNull(att.revokedAt),
      ),
    )
    .orderBy(desc(att.attestedAt))
    .limit(1)
    .get();

  return row ?? null;
}
