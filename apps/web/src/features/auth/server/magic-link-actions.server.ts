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
