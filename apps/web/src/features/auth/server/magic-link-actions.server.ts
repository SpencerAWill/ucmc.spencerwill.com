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
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { generateUserPublicId } from "#/server/auth/ids";
import {
  consumeMagicLink,
  requestMagicLink,
} from "#/features/auth/server/magic-link.server";
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
import { getDb, schema } from "#/server/db";
import {
  checkAuthRateLimitByEmail,
  checkAuthRateLimitByIp,
} from "#/server/rate-limit.server";
import { verifyTurnstile } from "#/features/auth/server/turnstile.server";

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

    const existing = await getDb().query.users.findFirst({
      where: eq(schema.users.email, args.email),
      columns: { id: true },
    });

    await requestMagicLink({
      email: args.email,
      intent: existing ? "login" : "register",
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

  // If a user row already exists for this email, the magic-link click is
  // a returning-user sign-in: open a session directly and skip the proof
  // cookie entirely. The caller sees `mode: "session"` and can route by
  // status + hasProfile instead of bouncing through /register/profile.
  //
  // If no user row exists, this is a first-time registration click —
  // write the short-lived proof cookie that /register/profile gates on,
  // and return `mode: "proof"` so the caller redirects there.
  const existing = await getDb().query.users.findFirst({
    where: eq(schema.users.email, proof.email),
    columns: { id: true, status: true },
  });

  if (existing) {
    const profile = await getDb().query.profiles.findFirst({
      where: eq(schema.profiles.userId, existing.id),
      columns: { userId: true },
    });
    // rotateSession (not openSession) so any stale session cookie on the
    // device gets replaced — same privilege-boundary discipline the
    // other auth transitions follow.
    await rotateSession(existing.id);
    return {
      ok: true,
      mode: "session",
      status: existing.status,
      hasProfile: Boolean(profile),
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
 * Caller-auth is the responsibility of the route handler — it knows
 * how to return a 401 Response. Throwing here would force the
 * handler to translate, which adds a layer for no reason.
 */
export async function exportMyDataAction(): Promise<{
  exportedAt: string;
  schemaVersion: 1;
  user: typeof schema.users.$inferSelect | null;
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
    attestedBy: string;
    revokedAt: Date | null;
    revokedBy: string | null;
    revocationReason: string | null;
    notes: string | null;
  }>;
  excluded: string[];
}> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }

  const db = getDb();
  const userId = principal.userId;

  const [user, profile, emergencyContacts, userRoles, attestations] =
    await Promise.all([
      db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
      db.query.profiles.findFirst({
        where: eq(schema.profiles.userId, userId),
      }),
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
    user: user ?? null,
    profile: profile ?? null,
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

  // Clear the session cookie. closeSession would also try to delete a
  // sessions row by id, but the cascade above already removed it; the
  // cookie clear is the part that matters here.
  await closeSession();

  return { ok: true };
}

export async function submitProfileAction(
  data: RegistrationInput,
): Promise<{ ok: true }> {
  const principal = await loadCurrentPrincipal();
  const proof = principal ? null : await readProofCookie();

  if (!principal && !proof) {
    throw new Error("Not authorized to submit a profile");
  }

  const email = principal?.email ?? proof!.email;

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

  // Find or create the user row. Pre-seeded rows (email-only, no profile)
  // are reused by hitting the unique email index. We do this in three
  // steps — insert-on-conflict-do-nothing, then select — to stay portable
  // across D1's SQLite dialect without depending on `returning`.
  const db = getDb();
  const id = `user_${uuidv7()}`;
  await db
    .insert(schema.users)
    .values({ id, publicId: generateUserPublicId(), email, status: "pending" })
    .onConflictDoNothing({ target: schema.users.email });
  const userRow = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });
  if (!userRow) {
    throw new Error("User row not found after upsert (unexpected)");
  }

  const now = new Date();
  await db
    .insert(schema.profiles)
    .values({ userId: userRow.id, ...profileData, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.profiles.userId,
      set: { ...profileData, updatedAt: now },
    });

  // Replace emergency contacts: delete existing, then insert new set.
  await db
    .delete(schema.emergencyContacts)
    .where(eq(schema.emergencyContacts.userId, userRow.id));

  if (emergencyContacts.length > 0) {
    await db.insert(schema.emergencyContacts).values(
      emergencyContacts.map((ec) => ({
        id: `ec_${uuidv7()}`,
        userId: userRow.id,
        name: ec.name,
        phone: ec.phone,
        relationship: ec.relationship,
      })),
    );
  }

  if (userRow.status !== "approved") {
    await db
      .update(schema.users)
      .set({ status: "pending" })
      .where(eq(schema.users.id, userRow.id));
  }

  if (!principal) {
    await openSession(userRow.id);
    clearProofCookie();
  }

  return { ok: true };
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

  await db
    .update(schema.profiles)
    .set({ ...profileData, updatedAt: new Date() })
    .where(eq(schema.profiles.userId, principal.userId));

  await db
    .delete(schema.emergencyContacts)
    .where(eq(schema.emergencyContacts.userId, principal.userId));

  if (emergencyContacts.length > 0) {
    await db.insert(schema.emergencyContacts).values(
      emergencyContacts.map((ec) => ({
        id: `ec_${uuidv7()}`,
        userId: principal.userId,
        name: ec.name,
        phone: ec.phone,
        relationship: ec.relationship,
      })),
    );
  }

  return { ok: true };
}
