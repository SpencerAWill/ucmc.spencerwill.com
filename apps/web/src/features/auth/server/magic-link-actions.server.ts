/**
 * Action implementations behind the magic-link server fns. Kept in a
 * .server.ts file so the module-scope imports of D1, cookies, and the
 * rate-limit binding stay off the client module graph — the shell in
 * `./server-fns.ts` loads this via a dynamic import inside its
 * createServerFn handlers.
 *
 * Each function has a matching `*Fn` wrapper in `server-fns.ts`; tests
 * exercise the actions here directly.
 */
import { and, eq, ne } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { normalizeEmail } from "#/server/auth/email-normalize";
import { generateUserPublicId } from "#/server/auth/ids";
import {
  consumeMagicLink,
  requestMagicLink,
} from "#/features/auth/server/magic-link.server";
import { UnauthorizedError } from "#/server/auth/errors.server";
import type { Principal } from "#/server/auth/principal.server";
import {
  clearProofCookie,
  readProofCookie,
  writeProofCookie,
} from "#/server/auth/proof-cookie.server";
import type { EmailProof } from "#/server/auth/proof-cookie.server";
import {
  closeSession,
  loadCurrentPrincipal,
  openSession,
  rotateSession,
} from "#/server/auth/session.server";
import { POLICIES_VERSION } from "#/config/legal";
import type { ConsumeMagicLinkResult } from "#/features/auth/server/server-fns";
import type {
  DetailsInput,
  PublicProfileInput,
  RegistrationInput,
} from "#/server/profile/profile-schemas";
import { getDb, isUniqueViolation, schema } from "#/server/db";
import {
  checkAuthRateLimitByEmail,
  checkAuthRateLimitByIp,
} from "#/server/rate-limit.server";
import { verifyTurnstile } from "#/features/auth/server/turnstile.server";

/**
 * Resolve a normalized email address to its owning userId via the
 * user_emails table. Returns null when no verified row exists for
 * that address. Used by the magic-link request + consume paths to
 * decide login vs. register and to identify the returning user.
 */
async function findUserIdByEmail(email: string): Promise<string | null> {
  const row = await getDb().query.userEmails.findFirst({
    where: eq(schema.userEmails.email, normalizeEmail(email)),
    columns: { userId: true },
  });
  return row?.userId ?? null;
}

/** Sentinel returned by `resolveUserByEmail` when `user_emails`
 *  references a `userId` that no longer exists in `users`. Only
 *  reachable mid-cascade or with manual SQL inconsistencies; callers
 *  should treat this as "invalid" rather than registering a new user. */
const BROKEN_USER_FK = Symbol("broken_user_fk");

/**
 * Consume-time lookup: given a verified email, return the owning user
 * along with whether they have a profile. One join replaces the prior
 * three-query sequence (userEmails → users → profiles).
 *
 * Returns:
 *   - `null` if the address has no row in `user_emails` (fresh
 *     registration click).
 *   - `BROKEN_USER_FK` when `user_emails` references a userId that
 *     no longer exists in `users` — only possible mid-cascade or with
 *     manual-SQL inconsistency. Caller treats this as invalid rather
 *     than as a fresh registrant, matching the prior explicit guard.
 *   - The resolved `{ userId, status, hasProfile }` otherwise.
 *
 * The LEFT JOIN against `users` is what makes the broken-FK case
 * distinguishable from "no row in user_emails": the outer row exists,
 * but its joined `users.id` comes back NULL.
 */
async function resolveUserByEmail(
  email: string,
): Promise<
  | { userId: string; status: schema.UserStatus; hasProfile: boolean }
  | typeof BROKEN_USER_FK
  | null
> {
  const row = await getDb()
    .select({
      userId: schema.users.id,
      status: schema.users.status,
      profileUserId: schema.profiles.userId,
    })
    .from(schema.userEmails)
    .leftJoin(schema.users, eq(schema.users.id, schema.userEmails.userId))
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .where(eq(schema.userEmails.email, normalizeEmail(email)))
    .get();
  if (!row) {
    return null;
  }
  if (row.userId === null || row.status === null) {
    return BROKEN_USER_FK;
  }
  return {
    userId: row.userId,
    status: row.status,
    hasProfile: row.profileUserId !== null,
  };
}

// ── timing jitter ────────────────────────────────────────────────────────
// All paths through requestMagicLinkAction must take roughly the same
// wall-clock time so an attacker can't distinguish "known email" (DB hit +
// Resend fetch) from "unknown email" or "rate-limited" (early return) by
// timing the response. We pad to a minimum + random jitter.

const MIN_RESPONSE_MS = 500;
const JITTER_RANGE_MS = 300;

async function padTiming(start: number): Promise<void> {
  const elapsed = Date.now() - start;
  const target = MIN_RESPONSE_MS + Math.random() * JITTER_RANGE_MS;
  if (elapsed < target) {
    await new Promise((r) => setTimeout(r, target - elapsed));
  }
}

export async function requestMagicLinkAction(args: {
  email: string;
  turnstileToken: string;
  redirect?: string;
}): Promise<{ ok: true }> {
  const start = Date.now();
  try {
    // Turnstile check first — rejects bots before any rate-limit or DB
    // work. Silently succeeds when TURNSTILE_SECRET_KEY is unset (local
    // dev). Returns the same { ok: true } shape on failure so the caller
    // can't distinguish a rejected challenge from a sent email.
    if (args.turnstileToken && !(await verifyTurnstile(args.turnstileToken))) {
      return { ok: true };
    }

    // Both rate-limit checks silently short-circuit to the success shape
    // so the client can't distinguish rate-limited vs honored vs unknown
    // email.
    if (!(await checkAuthRateLimitByIp())) {
      return { ok: true };
    }
    if (!(await checkAuthRateLimitByEmail(args.email))) {
      return { ok: true };
    }

    const existingUserId = await findUserIdByEmail(args.email);

    await requestMagicLink({
      email: args.email,
      intent: existingUserId ? "login" : "register",
      redirect: args.redirect,
    });

    return { ok: true };
  } finally {
    await padTiming(start);
  }
}

export async function consumeMagicLinkAction(
  token: string,
): Promise<ConsumeMagicLinkResult> {
  if (!(await checkAuthRateLimitByIp())) {
    return { ok: false, reason: "rate_limited" };
  }

  const proof = await consumeMagicLink(token);
  if (!proof) {
    return { ok: false, reason: "invalid" };
  }

  // If a verified email row already points at a user, the magic-link
  // click is a returning-user sign-in: open a session directly and
  // skip the proof cookie entirely. The caller sees `mode: "session"`
  // and can route by status + hasProfile instead of bouncing through
  // /register/profile.
  //
  // If `user_emails` references a userId that no longer exists,
  // surface as invalid rather than registering a new account — same
  // outcome as the prior explicit guard.
  //
  // If no user owns this email yet, this is a first-time registration
  // click — write the short-lived proof cookie that /register/profile
  // gates on, and return `mode: "proof"` so the caller redirects there.
  const existing = await resolveUserByEmail(proof.email);
  if (existing === BROKEN_USER_FK) {
    return { ok: false, reason: "invalid" };
  }
  if (existing) {
    // First time an officer-pre-added (unclaimed) user clicks a magic
    // link to their on-file address: the round-trip IS the verification
    // proof, so stamp `verifiedAt` on the matching primary user_emails
    // row before opening the session. Idempotent: the WHERE filter on
    // `verified_at IS NULL` makes a re-consume a no-op. Status stays
    // "unclaimed" until profile submission flips it to "approved" (see
    // `submitProfileAction`).
    if (existing.status === "unclaimed") {
      await getDb()
        .update(schema.userEmails)
        .set({ verifiedAt: new Date() })
        .where(
          and(
            eq(schema.userEmails.userId, existing.userId),
            eq(schema.userEmails.email, normalizeEmail(proof.email)),
            // Guard so we never overwrite a real verification timestamp
            // — important if a future code path stamps verifiedAt
            // outside this branch.
            eq(schema.userEmails.isPrimary, true),
          ),
        );
    }
    // rotateSession (not openSession) so any stale session cookie on the
    // device gets replaced — same privilege-boundary discipline the
    // other auth transitions follow.
    await rotateSession(existing.userId);
    return {
      ok: true,
      mode: "session",
      status: existing.status,
      hasProfile: existing.hasProfile,
    };
  }

  await writeProofCookie({
    email: proof.email,
    intent: proof.intent,
    issuedAt: Date.now(),
  });

  return { ok: true, mode: "proof", intent: proof.intent };
}

export async function getSessionAction(): Promise<{
  principal: Principal | null;
  anonymousPermissions: string[];
}> {
  const { loadAnonymousPermissions } =
    await import("#/server/auth/principal.server");
  const [principal, anonymousPermissions] = await Promise.all([
    loadCurrentPrincipal(),
    loadAnonymousPermissions(),
  ]);
  return { principal, anonymousPermissions };
}

export async function getProofAction(): Promise<{
  proof: EmailProof | null;
}> {
  const proof = await readProofCookie();
  return { proof };
}

export async function getProfileAction(): Promise<{
  profile: typeof schema.profiles.$inferSelect | null;
  emergencyContacts: Array<{
    name: string;
    phone: string;
    relationship: schema.ContactRelationship;
  }>;
}> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    return { profile: null, emergencyContacts: [] };
  }
  const db = getDb();
  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, principal.userId),
  });
  const contacts = profile
    ? await db
        .select({
          name: schema.emergencyContacts.name,
          phone: schema.emergencyContacts.phone,
          relationship: schema.emergencyContacts.relationship,
        })
        .from(schema.emergencyContacts)
        .where(eq(schema.emergencyContacts.userId, principal.userId))
    : [];
  return { profile: profile ?? null, emergencyContacts: contacts };
}

export async function signOutAction(): Promise<{ ok: true }> {
  await closeSession();
  return { ok: true };
}

/**
 * Bundles every piece of data the site stores about the caller into a
 * single plain-JSON shape — used by the `/api/account/export` route
 * handler to back the "download my data" promise on /privacy.
 *
 * Excludes:
 *   - passkey public-key material + counters (not useful to the
 *     member; dumping authenticator metadata is a foothold for a
 *     stolen-account scenario, not a recovery aid),
 *   - magic-link token hashes (one-shot auth state, never user-facing).
 *
 * Throws `UnauthorizedError` when no principal is present. The
 * `/api/account/export` route handler `instanceof`-checks the
 * sentinel and translates it to a 401 Response — string-matching
 * the message would couple the route's correctness to specific
 * error wording, which is what #25 set out to fix.
 */
export async function exportMyDataAction(): Promise<{
  exportedAt: string;
  schemaVersion: 1;
  user: typeof schema.users.$inferSelect | null;
  emails: Array<{
    email: string;
    isPrimary: boolean;
    // Nullable to support the officer pre-add path: an unclaimed user
    // whose row has not yet been claimed has `verifiedAt = NULL`. Real
    // members exporting their data always have a non-null timestamp;
    // the type widening is for completeness, not because anyone in the
    // claim path can call /api/account/export without first round-
    // tripping a magic link (which stamps verifiedAt).
    verifiedAt: Date | null;
    createdAt: Date;
  }>;
  profile: typeof schema.profiles.$inferSelect | null;
  emergencyContacts: Array<{
    name: string;
    phone: string;
    relationship: schema.ContactRelationship;
    createdAt: Date;
  }>;
  roles: string[];
  waiverAttestations: Array<{
    cycle: string;
    version: string;
    attestedAt: Date;
    // attestedBy + revokedBy can be null when the officer who acted
    // on the row has since deleted their account (FK ON DELETE SET
    // NULL, see 0018_waiver_attestedby_set_null.sql).
    attestedBy: string | null;
    revokedAt: Date | null;
    revokedBy: string | null;
    revocationReason: string | null;
    notes: string | null;
  }>;
  excluded: string[];
}> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new UnauthorizedError();
  }

  const db = getDb();
  const userId = principal.userId;

  // The six reads all key on `userId` only — no dependency between
  // them. Bundle them in a `db.batch` so they ride on a single D1
  // HTTP request (`Promise.all` would still issue six separate
  // calls) and observe a single point-in-time snapshot of the user's
  // data. The export endpoint isn't on a hot path, but the
  // consistency win (the bundle can't see a profile mid-write while
  // missing the matching emergency-contact row) is free here.
  const [
    userRows,
    emails,
    profileRows,
    emergencyContacts,
    userRoles,
    attestations,
  ] = await db.batch([
    db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1),
    db
      .select({
        email: schema.userEmails.email,
        isPrimary: schema.userEmails.isPrimary,
        verifiedAt: schema.userEmails.verifiedAt,
        createdAt: schema.userEmails.createdAt,
      })
      .from(schema.userEmails)
      .where(eq(schema.userEmails.userId, userId)),
    db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.userId, userId))
      .limit(1),
    db
      .select({
        name: schema.emergencyContacts.name,
        phone: schema.emergencyContacts.phone,
        relationship: schema.emergencyContacts.relationship,
        createdAt: schema.emergencyContacts.createdAt,
      })
      .from(schema.emergencyContacts)
      .where(eq(schema.emergencyContacts.userId, userId)),
    db
      .select({ roleId: schema.userRoles.roleId })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId)),
    db
      .select({
        cycle: schema.waiverAttestations.cycle,
        version: schema.waiverAttestations.version,
        attestedAt: schema.waiverAttestations.attestedAt,
        attestedBy: schema.waiverAttestations.attestedBy,
        revokedAt: schema.waiverAttestations.revokedAt,
        revokedBy: schema.waiverAttestations.revokedBy,
        revocationReason: schema.waiverAttestations.revocationReason,
        notes: schema.waiverAttestations.notes,
      })
      .from(schema.waiverAttestations)
      .where(eq(schema.waiverAttestations.userId, userId)),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    user: userRows[0] ?? null,
    emails,
    profile: profileRows[0] ?? null,
    emergencyContacts,
    roles: userRoles.map((r) => r.roleId),
    waiverAttestations: attestations,
    excluded: [
      "Passkey credentials (public keys, counters, transports)",
      "Magic-link token hashes",
    ],
  };
}

/**
 * Self-serve hard delete. Removes the caller's user row and cascades
 * through profiles, emergency_contacts, sessions, passkey_credentials,
 * user_roles, and waiver_attestations (the ON DELETE CASCADE rules in
 * schema.ts handle each child table). Explicitly deletes the caller's
 * avatar from R2 — Drizzle cascades only cover relational rows, not
 * blob storage. Closes the session cookie before returning so the
 * browser redirects to a signed-out state.
 *
 * Self-protection: if the caller is the only `system_admin` left, we
 * refuse — deleting the last admin would leave the platform with no
 * way to grant `system_admin` to anyone else without a manual D1
 * intervention. Officers in that position should promote a successor
 * via /members/roles before deleting their own account.
 */
export async function deleteMyAccountAction(): Promise<{ ok: true }> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }

  const db = getDb();

  // Last-system-admin guard. system_admin is granted via a
  // user_roles row with roleId=role_system_admin; if exactly one
  // such row exists and it points at us, refuse. Off-by-one here
  // would silently leave the platform admin-less, so the comparison
  // is intentionally a strict count + identity check.
  if (principal.roles.includes("system_admin")) {
    const rows = await db
      .select({ userId: schema.userRoles.userId })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.roleId, "role_system_admin"));
    if (rows.length === 1 && rows[0]?.userId === principal.userId) {
      throw new Error(
        "Cannot delete the only remaining system_admin. Promote a successor via /members/roles first.",
      );
    }
  }

  // Capture the identifying info we'll need on the audit row BEFORE
  // the user is gone — once the FK cascade fires, both
  // `actorUserId` and `targetUserId` go to NULL and the row would
  // otherwise have no way to identify whose account was deleted.
  // This is a documented exception to the no-PII-in-metadata rule;
  // see `audit-log.server.ts`'s module doc-comment.
  const auditMetadata = {
    userId: principal.userId,
    email: principal.primaryEmail,
  };

  // Delete the avatar object from R2 before the row goes away. The
  // R2 helper is a no-op if the key doesn't exist.
  if (principal.avatarKey) {
    const { deleteAvatar } = await import("#/server/r2/avatars.server");
    await deleteAvatar(principal.avatarKey);
  }

  // Drop the user row. Foreign-key cascades in schema.ts handle:
  //   profiles, emergency_contacts, sessions, passkey_credentials,
  //   user_roles, waiver_attestations.
  // announcements.created_by is ON DELETE SET NULL, so authored
  // announcements stay but lose the author attribution.
  await db.delete(schema.users).where(eq(schema.users.id, principal.userId));

  // Audit AFTER the destructive work succeeds — recording before
  // would leave a false-positive row if the avatar cleanup or the
  // user-row delete threw. Both `actorUserId` and `targetUserId`
  // are NULL because the user is already gone; the captured
  // metadata is the surviving attribution.
  const { recordAuditEvent } = await import("#/server/audit/audit-log.server");
  await recordAuditEvent({
    actorUserId: null,
    action: "member.self_deleted",
    targetUserId: null,
    metadata: auditMetadata,
  });

  // Clear the session cookie. closeSession would also try to delete a
  // sessions row by id, but the cascade above already removed it; the
  // cookie clear is the part that matters here.
  await closeSession();

  return { ok: true };
}

export interface SubmitProfileResult {
  ok: true;
  /**
   * The user's status AFTER the submit lands. Almost always `"pending"`
   * (first-time registrant, or returning user without a profile), but
   * the unclaimed-claim path flips straight to `"approved"`. The form
   * uses this to pick the post-submit destination — pending users see
   * `/register/pending`, approved users go to `/my/account`.
   */
  status: schema.UserStatus;
}

export async function submitProfileAction(
  data: RegistrationInput,
): Promise<SubmitProfileResult> {
  const principal = await loadCurrentPrincipal();
  const proof = principal ? null : await readProofCookie();

  if (!principal && !proof) {
    throw new Error("Not authorized to submit a profile");
  }

  const email = normalizeEmail(principal?.primaryEmail ?? proof!.email);

  const { emergencyContacts, bio, policiesAck: _ack, ...rest } = data;
  // Empty/whitespace-only bio normalizes to NULL so the DB has a single
  // representation of "no bio set". `policiesAck` is enforced by the
  // zod schema; we don't store the boolean — we record the moment it
  // was ticked plus the policy version so a future POLICIES_VERSION
  // bump can require re-ack.
  const profileData = {
    ...rest,
    bio: bio.length > 0 ? bio : null,
    policiesAcknowledgedAt: new Date(),
    policiesVersion: POLICIES_VERSION,
  };

  // Find or create the user row. For session-based callers (returning
  // user without a profile) we already know the userId. For proof-based
  // callers (first-time registrants), we look the email up in
  // user_emails first — covers the retry / parallel-tab race where
  // another device already completed registration with the same
  // verified email — and only insert when the address has never been
  // claimed. The user_emails UNIQUE(email) constraint is the actual
  // race boundary; the pre-lookup is just to avoid wasting an inserted
  // users row on the loser of the race.
  const db = getDb();
  let userId: string;
  let isNewUser = false;
  if (principal) {
    userId = principal.userId;
  } else {
    const existingUserId = await findUserIdByEmail(email);
    if (existingUserId) {
      userId = existingUserId;
    } else {
      const newUserId = `user_${uuidv7()}`;
      try {
        await db.batch([
          db.insert(schema.users).values({
            id: newUserId,
            publicId: generateUserPublicId(),
            status: "pending",
          }),
          db.insert(schema.userEmails).values({
            id: `uem_${uuidv7()}`,
            userId: newUserId,
            email,
            isPrimary: true,
            verifiedAt: new Date(),
          }),
        ]);
        userId = newUserId;
        isNewUser = true;
      } catch (err) {
        if (isUniqueViolation(err, "user_emails.email")) {
          // Lost the race; the email belongs to a user that another
          // tab/device just created. Re-resolve and reuse.
          const recovered = await findUserIdByEmail(email);
          if (!recovered) {
            throw new Error(
              "user_emails missing after UNIQUE violation (impossible)",
              { cause: err },
            );
          }
          userId = recovered;
        } else {
          throw err;
        }
      }
    }
  }

  // Status reset to "pending" only matters for the existing-user path:
  // a returning user who lost their profile must re-enter the approval
  // queue. Brand-new users were already inserted with status="pending"
  // above, so we skip the UPDATE for them entirely. For everyone else
  // we let SQL decide whether the row needs touching by guarding the
  // UPDATE with `WHERE status != 'approved'` — the principal's status
  // can be stale by the time the batch commits (an approver flipping
  // the row mid-flight), and the WHERE keeps an unconditional revert
  // from racing with that approval.
  const now = new Date();
  const stmts: Parameters<typeof db.batch>[0][number][] = [
    db
      .insert(schema.profiles)
      .values({ userId, ...profileData, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.profiles.userId,
        set: { ...profileData, updatedAt: now },
      }),
    db
      .delete(schema.emergencyContacts)
      .where(eq(schema.emergencyContacts.userId, userId)),
  ];
  if (emergencyContacts.length > 0) {
    stmts.push(
      db.insert(schema.emergencyContacts).values(
        emergencyContacts.map((ec) => ({
          id: `ec_${uuidv7()}`,
          userId,
          name: ec.name,
          phone: ec.phone,
          relationship: ec.relationship,
        })),
      ),
    );
  }
  // Officer-pre-added (unclaimed) users land here with `principal.status
  // === "unclaimed"` and no profile. The pre-add itself was the
  // approval signal, so flip them straight to "approved" and NULL the
  // placeholder columns — they skip the normal pending queue. The
  // `WHERE status = 'unclaimed'` guard makes the UPDATE safe against a
  // stale principal: if an officer concurrently deleted or reactivated
  // the row, no rows match and the UPDATE is a no-op.
  //
  // **`approvedBy` is intentionally left at NULL on this path.** The
  // normal approval flow stamps `approvedBy = approver.userId`, but no
  // officer is *currently* approving — the approval already happened
  // (semantically) at officer pre-add time. Attribution lives in the
  // audit log: `member.pre_added` (officer actor) → `member.claimed`
  // (self actor) is the canonical chain. Any UI that displays an
  // "Approved by X" line on a member must handle the `approvedBy IS
  // NULL` case (treat as "auto-approved via pre-add claim"); the shape
  // `status = 'approved' AND approved_at IS NOT NULL AND approved_by
  // IS NULL` is unambiguous.
  const isClaimingFromUnclaimed =
    !!principal && principal.status === "unclaimed";
  if (isClaimingFromUnclaimed) {
    stmts.push(
      db
        .update(schema.users)
        .set({
          status: "approved",
          approvedAt: new Date(),
          placeholderName: null,
          unclaimedAt: null,
        })
        .where(
          and(
            eq(schema.users.id, userId),
            eq(schema.users.status, "unclaimed"),
          ),
        ),
    );
    // Bundle the `member.claimed` audit into the same batch as the
    // status flip so the two are atomic — a worker death between the
    // batch returning and a post-batch audit insert would otherwise
    // strand a freshly-approved user with no claim event in the audit
    // chain. The schema doc-comment names `member.pre_added` →
    // `member.claimed` as the canonical attribution chain, so the
    // audit row is load-bearing.
    const { buildAuditEventStatement } =
      await import("#/server/audit/audit-log.server");
    stmts.push(
      buildAuditEventStatement({
        actorUserId: userId,
        action: "member.claimed",
        targetUserId: userId,
        metadata: { priorStatus: "unclaimed" },
      }),
    );
  } else if (!isNewUser) {
    stmts.push(
      db
        .update(schema.users)
        .set({ status: "pending" })
        .where(
          and(eq(schema.users.id, userId), ne(schema.users.status, "approved")),
        ),
    );
  }
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);

  if (!principal) {
    await openSession(userId);
    clearProofCookie();
  }

  // Compute the post-submit status without an extra DB read: the only
  // ways the user lands here are
  //   - claim-from-unclaimed → "approved" (set above)
  //   - new user             → "pending" (insert default)
  //   - returning user, was not "approved" → reset to "pending"
  //   - returning user, was "approved" → still "approved" (the WHERE
  //     guard above keeps the revert from firing)
  const status: schema.UserStatus = isClaimingFromUnclaimed
    ? "approved"
    : isNewUser
      ? "pending"
      : principal!.status === "approved"
        ? "approved"
        : "pending";

  return { ok: true, status };
}

/**
 * Partial update for the Profile tab. Only writes the public-ish columns
 * (preferredName, ucAffiliation) onto the existing profile row. Caller
 * must be authenticated; the route guard at /account already enforces
 * `requireApproved`, so the row is guaranteed to exist.
 */
export async function submitPublicProfileAction(
  data: PublicProfileInput,
): Promise<{ ok: true }> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not authorized to submit a profile");
  }

  const { bio, ...rest } = data;
  await getDb()
    .update(schema.profiles)
    .set({
      ...rest,
      bio: bio.length > 0 ? bio : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.profiles.userId, principal.userId));

  return { ok: true };
}

/**
 * Partial update for the Details tab. Writes fullName + phone onto the
 * existing profile row and replaces the emergency contact set
 * (delete-then-insert, same pattern as `submitProfileAction`). Caller
 * must be authenticated.
 */
export async function submitDetailsAction(
  data: DetailsInput,
): Promise<{ ok: true }> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not authorized to submit a profile");
  }

  const { emergencyContacts, ...profileData } = data;
  const db = getDb();

  // Profile update + emergency-contact replace as one batch. Same
  // shape as `submitProfileAction` and `adminUpdateProfileAction`:
  // delete-then-insert + audit (no audit needed for self-edit) all
  // committed together.
  const stmts: Parameters<typeof db.batch>[0][number][] = [
    db
      .update(schema.profiles)
      .set({ ...profileData, updatedAt: new Date() })
      .where(eq(schema.profiles.userId, principal.userId)),
    db
      .delete(schema.emergencyContacts)
      .where(eq(schema.emergencyContacts.userId, principal.userId)),
  ];
  if (emergencyContacts.length > 0) {
    stmts.push(
      db.insert(schema.emergencyContacts).values(
        emergencyContacts.map((ec) => ({
          id: `ec_${uuidv7()}`,
          userId: principal.userId,
          name: ec.name,
          phone: ec.phone,
          relationship: ec.relationship,
        })),
      ),
    );
  }
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);

  return { ok: true };
}
