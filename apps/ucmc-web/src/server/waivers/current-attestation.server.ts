/**
 * Cross-feature source of truth for "does this member hold a current
 * paper-waiver attestation?".
 *
 * The predicate is `(userId, cycle, version)` AND non-revoked — see
 * `requireCurrentWaiver` in `features/auth/guards.ts` for why
 * non-revoked alone is not enough: bumping `WAIVER_VERSION`
 * invalidates every existing attestation, so the version has to be
 * part of the match.
 *
 * This lives in `src/server/` rather than `features/waivers/` for the
 * same reason the audit *recorder* does (`server/audit/audit-log.server.ts`)
 * — three features need to ask the question, but only one owns the
 * read-side UI:
 *   - `features/waivers` — the officer queue + attest/revoke flow
 *   - `features/gear`    — `requireCartMember` refuses carts from
 *                          waiver-lapsed members
 *   - `features/members` — waiver status on the member detail page
 * `import/no-restricted-paths` forbids features importing each other,
 * and hand-rolling the predicate per feature is exactly how the three
 * copies drift apart on the next `WAIVER_VERSION` bump.
 */
import { and, desc, eq, isNull } from "drizzle-orm";

import { WAIVER_VERSION } from "#/config/legal";
import { currentWaiverCycle } from "#/config/waiver-cycle";
import { getDb, schema } from "#/server/db";

/**
 * Compact waiver standing for one member, as rendered next to a member
 * on officer-facing surfaces. Deliberately smaller than
 * `WaiverAttestationSummary` (the full history row in
 * `features/waivers`): a status badge needs "covered or not, since
 * when, by whom" and nothing else — notes and revocation reasons stay
 * behind the waivers feature's own reads.
 */
export interface MemberWaiverStatus {
  /** Cycle the check was evaluated against — always the current one. */
  cycle: string;
  version: string;
  /** True when a non-revoked attestation exists for `(cycle, version)`. */
  attested: boolean;
  attestedAt: Temporal.Instant | null;
  /**
   * Preferred name of the attesting officer. Null when not attested, and
   * also when the officer has since deleted their account — the FK is
   * `ON DELETE SET NULL` (migration 0018), so the attestation survives
   * without its attestor. Callers render "(deleted user)".
   */
  attestedByName: string | null;
}

/**
 * The shared WHERE fragment: a live attestation for `cycle` at the
 * current `WAIVER_VERSION`. Exported so callers that need it inside a
 * larger query (anti-joins, batch reads) compose it rather than
 * re-deriving the three conditions.
 */
export function currentAttestationFilter(cycle: string) {
  return and(
    eq(schema.waiverAttestations.cycle, cycle),
    eq(schema.waiverAttestations.version, WAIVER_VERSION),
    isNull(schema.waiverAttestations.revokedAt),
  );
}

/**
 * Subquery of every user id holding a current attestation. The officer
 * queue anti-joins against this to list members still owing a waiver.
 */
export function currentlyAttestedUserIds(cycle: string) {
  return getDb()
    .select({ userId: schema.waiverAttestations.userId })
    .from(schema.waiverAttestations)
    .where(currentAttestationFilter(cycle));
}

/**
 * Boolean check for one member. Used by member-facing gates that only
 * need to allow or refuse (the gear cart), so it selects a single id
 * rather than building a full status object.
 */
export async function hasCurrentAttestation(userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.waiverAttestations.id })
    .from(schema.waiverAttestations)
    .where(
      and(
        eq(schema.waiverAttestations.userId, userId),
        currentAttestationFilter(currentWaiverCycle()),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Full status for one member, including who attested and when. Returns
 * an `attested: false` status (not null) when there's no live row, so
 * callers always have a cycle + version to render alongside the badge.
 */
export async function loadMemberWaiverStatus(
  userId: string,
): Promise<MemberWaiverStatus> {
  const cycle = currentWaiverCycle();
  const att = schema.waiverAttestations;

  const row = await getDb()
    .select({
      attestedAt: att.attestedAt,
      attestedByName: schema.profiles.preferredName,
    })
    .from(att)
    // LEFT so a deleted attestor doesn't drop the attestation row —
    // `attestedByName` comes back null and the member still reads as
    // attested, which is the truth.
    .leftJoin(schema.profiles, eq(schema.profiles.userId, att.attestedBy))
    .where(and(eq(att.userId, userId), currentAttestationFilter(cycle)))
    .orderBy(desc(att.attestedAt))
    .limit(1)
    .get();

  return {
    cycle,
    version: WAIVER_VERSION,
    attested: row !== undefined,
    attestedAt: row?.attestedAt ?? null,
    attestedByName: row?.attestedByName ?? null,
  };
}
