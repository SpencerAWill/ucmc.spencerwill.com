import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// `currentSeason()` reads `Temporal.Now`, which the app installs in
// its own entrypoints (`src/router.tsx`, `src/server-entry.ts`). Nothing
// installs it in the Playwright process, so the fixture does.
import "temporal-polyfill/global";

import { WAIVER_VERSION } from "#/config/legal";
import { currentSeason } from "#/config/club-season";

const WEB_DIR = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * Miniflare keeps each D1 database as a plain SQLite file under the
 * `D1DatabaseObject` Durable Object's persist directory, named for the
 * derived object id.
 *
 * These seeds used to reach it through `pnpm exec wrangler d1 execute
 * --local`, which is itself just another process opening this same
 * file — the CLI boot was the entire cost, measured at **1.5-2.5 s per
 * call** against **1.4-4 ms** for the equivalent `node:sqlite` open +
 * statement. With ~25 seed call sites across the suite that is minutes
 * per CI run spent starting wrangler, not running SQL.
 *
 * Writing the file directly is sound for the same reason the CLI was:
 * the dev server does not hold an exclusive lock. The database is in
 * WAL mode (verified), so an external writer and the running worker
 * coexist — `busyTimeout` below covers the moments they overlap.
 */
const D1_STATE_DIR = join(
  WEB_DIR,
  ".wrangler",
  "state",
  "v3",
  "d1",
  "miniflare-D1DatabaseObject",
);

/**
 * The filename is a hash Miniflare derives internally, so it is
 * discovered rather than recomputed: reimplementing that derivation
 * would couple these fixtures to a private detail that a miniflare
 * bump can change silently, and the failure would look like an empty
 * database rather than a broken fixture.
 *
 * `metadata.sqlite` is Miniflare's own bookkeeping, never a database.
 * More than one real candidate means a second D1 binding was added and
 * this helper genuinely cannot guess — so it says so rather than
 * picking one.
 */
function resolveDatabaseFile(): string {
  let entries: string[];
  try {
    entries = readdirSync(D1_STATE_DIR);
  } catch {
    throw new Error(
      `No local D1 state at ${D1_STATE_DIR}. Run \`pnpm --filter ucmc-web db:migrate:local\` first.`,
    );
  }
  const candidates = entries.filter(
    (name) => name.endsWith(".sqlite") && name !== "metadata.sqlite",
  );
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one D1 database file in ${D1_STATE_DIR}, found ${
        candidates.length
      }: [${candidates.join(", ")}]`,
    );
  }
  return join(D1_STATE_DIR, candidates[0]);
}

let connection: DatabaseSync | undefined;

/**
 * One connection per Playwright worker process, opened on first use.
 *
 * Reads are never stale despite the connection being long-lived: in
 * WAL mode each autocommit statement takes a fresh read snapshot, so a
 * query here sees writes the dev server committed a moment ago.
 */
function db(): DatabaseSync {
  if (!connection) {
    connection = new DatabaseSync(resolveDatabaseFile(), {
      // The running dev server writes the same file. Without a busy
      // timeout an overlapping write fails outright with SQLITE_BUSY,
      // which would read as a flaky seed.
      timeout: 5_000,
    });
  }
  return connection;
}

/** Run `fn`'s statements as one unit, so a concurrent reader (the dev
 *  server) never observes a seed's delete-then-insert half-applied. */
function withTransaction(fn: (handle: DatabaseSync) => void): void {
  const handle = db();
  handle.exec("BEGIN IMMEDIATE");
  try {
    fn(handle);
    handle.exec("COMMIT");
  } catch (error) {
    handle.exec("ROLLBACK");
    throw error;
  }
}

export interface SeededUserOptions {
  /** Roles to assign. Defaults to `["role_member"]`. Pass
   *  `["role_system_admin"]` for an officer with the role-bypass that
   *  grants every permission, including `members:manage`. */
  roles?: string[];
  /**
   * Whether to also write a current-cycle waiver attestation.
   * **Defaults to `true`**, and the default is the point.
   *
   * The officer queue (`listMembersNeedingAttestationAction`) is every
   * `status='approved'` user anti-joined against the holders of a live
   * attestation, so an approved member seeded *without* one lands in
   * that queue and stays there forever. Nothing cleans it up, so the
   * local database had accumulated 487 such rows — enough that
   * `boundingBox()` started returning null for rows `isVisible()`
   * reported as visible, which is a false positive that looks exactly
   * like a layout bug.
   *
   * It is also the realistic state: an approved member has handed in a
   * signed waiver. Seeding one without an attestation models a member
   * who was approved and then never signed, which is a specific case,
   * not the default one.
   *
   * Pass `false` deliberately when the queue row IS the fixture —
   * `mobile-waiver-queue.spec.ts` is the only such spec today.
   */
  attested?: boolean;
}

interface InsertUserOptions {
  email: string;
  status: string;
  /** Epoch ms, or null for an address that was never verified. */
  verifiedAt: number | null;
  approvedAt?: number | null;
  placeholderName?: string | null;
  unclaimedAt?: number | null;
  profile?: {
    fullName: string;
    preferredName: string;
    phone: string;
  } | null;
  /** Role ids from the seeded catalog. A role id that doesn't exist
   *  silently no-ops at the FK layer and the test then fails somewhere
   *  confusing — keep the list to ids seeded by 0001_rbac_seed /
   *  0016_officer_roles_seed. */
  roles?: string[];
  /** Write a live attestation for the current cycle. See
   *  {@link SeededUserOptions.attested}. */
  attested?: boolean;
  deactivatedAt?: number | null;
  rejectedAt?: number | null;
}

/**
 * The one place a seeded user is written. Every exported seed below is
 * this with different column values, which is deliberate: a spec that
 * hand-rolls its own INSERT drifts from the schema silently. The
 * original copy of one still wrote `users.email`, a column migration
 * 0025 removed, so it failed at seed time with `table users has no
 * column named email` long before reaching its assertion. Routing them
 * all through here means a schema change breaks them together and gets
 * fixed once.
 *
 * Values are bound, not interpolated. The previous implementation had
 * to hand-escape every string into a SQL literal because it shipped
 * the statement to a CLI as text; a prepared statement removes that
 * whole class of mistake.
 */
function insertUser(options: InsertUserOptions): string {
  const userId = `user_${randomUUID()}`;
  // Public ID format mirrors generateUserPublicId() in
  // src/server/auth/ids.ts: 12 alphanumeric chars, no prefix. Test rows
  // don't need cryptographic uniqueness — uniqueness across runs comes
  // from the random uuid.
  const publicId = randomUUID().replace(/-/g, "").slice(0, 12);
  const nowMs = Date.now();

  withTransaction((handle) => {
    // `users` cascades through profiles, user_emails, sessions,
    // user_roles, passkeys (ON DELETE cascade, verified against the
    // live schema), so this one delete clears every prior row for the
    // address and re-runs against a reused dev server land in a
    // deterministic state.
    handle
      .prepare(
        "DELETE FROM users WHERE id IN (SELECT user_id FROM user_emails WHERE email = ?)",
      )
      .run(options.email);

    handle
      .prepare(
        `INSERT INTO users (id, public_id, status, approved_at, placeholder_name, unclaimed_at, deactivated_at, rejected_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        publicId,
        options.status,
        options.approvedAt ?? null,
        options.placeholderName ?? null,
        options.unclaimedAt ?? null,
        options.deactivatedAt ?? null,
        options.rejectedAt ?? null,
        nowMs,
      );

    handle
      .prepare(
        `INSERT INTO user_emails (id, user_id, email, is_primary, verified_at, created_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .run(
        `uem_${randomUUID()}`,
        userId,
        options.email,
        options.verifiedAt,
        nowMs,
      );

    if (options.profile) {
      handle
        .prepare(
          `INSERT INTO profiles (user_id, full_name, preferred_name, phone, uc_affiliation, updated_at)
           VALUES (?, ?, ?, ?, 'student', ?)`,
        )
        .run(
          userId,
          options.profile.fullName,
          options.profile.preferredName,
          options.profile.phone,
          nowMs,
        );
    }

    const roleInsert = handle.prepare(
      "INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)",
    );
    for (const roleId of options.roles ?? []) {
      roleInsert.run(userId, roleId);
    }

    if (options.attested) {
      // `cycle` and `version` are imported, never recomputed: the match
      // in `currentAttestationFilter` is `(cycle, version, revoked_at IS
      // NULL)`, so a fixture that hard-coded either would silently stop
      // satisfying the queue's anti-join after the Aug 1 rollover or a
      // `WAIVER_VERSION` bump — and the symptom would be a slow return
      // of the queue pollution this exists to prevent. (CLAUDE.md also
      // forbids deriving the club year ad-hoc.)
      //
      // `attested_by` is null on purpose: no officer attested this, and
      // the column is nullable precisely so an attestation can outlive
      // its attestor.
      handle
        .prepare(
          `INSERT INTO waiver_attestations (id, user_id, cycle, version, attested_at, attested_by)
           VALUES (?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          `wa_${randomUUID()}`,
          userId,
          currentSeason(),
          WAIVER_VERSION,
          nowMs,
        );
    }
  });

  return userId;
}

/**
 * Insert a user with status='approved', a verified primary email, and a
 * filled-in profile on the local Miniflare D1 so e2e tests that need a
 * fully-registered user can sign in immediately and skip both the
 * registration form and admin approval.
 *
 * Pass a unique-per-test email (`${prefix}-${Date.now()}@…`) so two
 * tests in the same run don't stomp on each other — `user_emails.email`
 * carries a global UNIQUE.
 *
 * Schema note: `users` no longer carries an `email` column (migration
 * 0025); the verified address lives in `user_emails` with
 * `is_primary = 1` and `verified_at` non-null.
 */
export function ensureApprovedUser(
  email: string,
  options: SeededUserOptions = {},
): void {
  const nowMs = Date.now();
  insertUser({
    email,
    status: "approved",
    approvedAt: nowMs,
    verifiedAt: nowMs,
    profile: {
      fullName: "E2E Tester",
      preferredName: "E2E",
      phone: "+15555550100",
    },
    roles: options.roles ?? ["role_member"],
    attested: options.attested ?? true,
  });
}

/**
 * Insert a `users` row with `status='unclaimed'` plus a primary
 * `user_emails` row with `verified_at = NULL` — the same shape that
 * `preAddUnclaimedMembersAction` produces in production. Used by e2e
 * specs that exercise the user-side claim flow without going through
 * the officer pre-add UI first.
 */
export function seedUnclaimedUser(
  email: string,
  options: { placeholderName?: string } = {},
): void {
  insertUser({
    email,
    status: "unclaimed",
    verifiedAt: null,
    placeholderName: options.placeholderName ?? "E2E Stub",
    unclaimedAt: Date.now(),
  });
}

/**
 * Insert a `users` row with `status='pending'`, a verified primary
 * email, **and** a `profiles` row — a member who finished
 * `/register/profile` and is now sitting in the approval queue.
 *
 * That is the one state `/register/pending` actually renders: the
 * route redirects an approved principal to `/my/profile` and a
 * profile-less one back to `/register/profile`, so neither
 * `ensureApprovedUser` nor `seedUserWithoutProfile` can reach it.
 */
export function seedPendingUserWithProfile(email: string): void {
  insertUser({
    email,
    status: "pending",
    verifiedAt: Date.now(),
    profile: {
      fullName: "E2E Pending",
      preferredName: "Pending",
      phone: "+15555550101",
    },
  });
}

/**
 * Insert a `users` row with a verified primary email and **no
 * `profiles` row** — the half-registered state the magic-link
 * callback's "user without profile" branch has to handle.
 *
 * `status` is `pending` because that mirrors a real
 * registered-but-not-yet-approved account; the route under test gates
 * on the missing profile, not on status.
 */
export function seedUserWithoutProfile(email: string): void {
  insertUser({ email, status: "pending", verifiedAt: Date.now() });
}

/**
 * Insert a user in a terminal management state — `approved`,
 * `deactivated` or `rejected` — with a verified primary email and a
 * profile, bypassing the registration flow so the member-management
 * tabs can be driven directly.
 *
 * The status timestamp matches what `deactivateMembersAction` /
 * `rejectRegistrationsAction` would write, so the management page's
 * queries treat the row identically to one that took the real path.
 *
 * This lives here rather than in `management.spec.ts`, which had its
 * own copy: that copy re-derived the `users` column list, hand-escaped
 * its own SQL literals, and — once `ensureApprovedUser` started
 * attesting — was the one remaining path that still dropped approved
 * members into the waiver queue. A seed that knows the schema belongs
 * with the other seeds that know the schema.
 */
export function seedUserWithStatus(
  email: string,
  status: "approved" | "deactivated" | "rejected",
): void {
  const nowMs = Date.now();
  insertUser({
    email,
    status,
    verifiedAt: nowMs,
    approvedAt: status === "approved" ? nowMs : null,
    deactivatedAt: status === "deactivated" ? nowMs : null,
    rejectedAt: status === "rejected" ? nowMs : null,
    // Only an approved member can sit in the officer queue, so only an
    // approved one needs the attestation that keeps them out of it.
    attested: status === "approved",
    profile: {
      fullName: "E2E Tester",
      preferredName: "E2E",
      phone: "+15555550100",
    },
  });
}

/**
 * Run an arbitrary SQL block on the local Miniflare D1. Used by specs
 * that need a custom seed beyond what the helpers above support.
 *
 * Accepts multiple semicolon-separated statements. Use `queryD1` when
 * you need the rows back.
 */
export function execD1(sql: string): void {
  db().exec(sql);
}

/**
 * Run a single SELECT against the local Miniflare D1 and return its
 * rows, with `params` bound to the statement's `?` placeholders.
 *
 * This replaces reading `wrangler d1 execute --json` stdout and
 * digging through its `[{ results: [...] }]` envelope — callers get
 * plain rows, and a malformed query now throws instead of being
 * swallowed by a `JSON.parse` that returns null for both "no rows" and
 * "the query was broken".
 */
export function queryD1<T>(
  sql: string,
  ...params: (string | number | null)[]
): T[] {
  return db()
    .prepare(sql)
    .all(...params) as T[];
}

/**
 * Insert a live session row for the user owning `email` and return its
 * id — which IS the value of the `ucmc_session` cookie, since the
 * session cookie holds the opaque session id and nothing derived from
 * it (see `src/server/auth/session-cookie.server.ts`).
 *
 * Lets a spec arrive signed-in without a magic-link round-trip, and so
 * without Mailpit. Use it when the spec is about something *after*
 * authentication; a spec whose subject is the sign-in flow itself must
 * still go through the real magic link.
 */
export function seedSession(email: string): string {
  // uuidv7-shaped, matching `insertSessionRow`. The format isn't load-
  // bearing — the column is an opaque primary key — but staying close
  // to production keeps a debugging session from chasing a red herring.
  const sid = randomUUID();
  const nowMs = Date.now();
  const expiresMs = nowMs + 30 * 24 * 60 * 60 * 1000; // SESSION_TTL_MS
  db()
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
       SELECT ?, user_id, ?, ?, ? FROM user_emails WHERE email = ? AND is_primary = 1`,
    )
    .run(sid, nowMs, nowMs, expiresMs, email);
  return sid;
}

/** Cookie name for the seeded session over plain http (the `__Host-`
 *  prefix is only used when APP_BASE_URL is https). */
export const SESSION_COOKIE_NAME = "ucmc_session";

/**
 * Domain every e2e seed addresses. RFC 2606 reserves `example.com` for
 * documentation and testing, so no address under it can belong to a
 * real person — which is what makes {@link sweepSeededUsers} safe to
 * run against a developer's local database.
 */
export const E2E_EMAIL_DOMAIN = "example.com";

/**
 * Read `SEED_ADMIN_EMAIL` out of `.env.local`.
 *
 * `drizzle/seed.ts` promotes that address to sysadmin for local dev,
 * and the sweep below must never delete it. Vite loads `.env.local`
 * for the dev server, but nothing loads it for the Playwright process,
 * so `process.env` alone would miss it — and the one case that matters
 * is precisely a developer who pointed it at an `@example.com`
 * address.
 */
function seedAdminEmail(): string | undefined {
  const fromEnv = process.env.SEED_ADMIN_EMAIL?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  try {
    const match = /^\s*SEED_ADMIN_EMAIL\s*=\s*(.+)$/m.exec(
      readFileSync(join(WEB_DIR, ".env.local"), "utf8"),
    );
    return match?.[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

/**
 * Delete every user seeded by a previous e2e run, and report how many
 * went.
 *
 * **Why this has to exist.** Seeds key on a unique per-run address
 * (`${prefix}-${Date.now()}@example.com`), which keeps runs from
 * colliding but means every run leaves its users behind permanently.
 * Nothing ever removed them: the local database had reached 523 users,
 * 487 of them approved. That is not merely untidy — a long enough
 * waiver queue makes `boundingBox()` return null for rows
 * `isVisible()` reports as visible, and `mobile-waiver-queue.spec.ts`
 * has already produced one false positive that way.
 *
 * Attesting by default (see {@link SeededUserOptions.attested}) stops
 * the *queue* from growing, but not the user table; the pending,
 * unclaimed and profile-less seeds leave rows regardless of waivers.
 * This is the half that bounds the rest.
 *
 * **Why the whole domain rather than known prefixes.** The prefixes
 * are not a convention anybody enforces. The accumulated rows carry
 * `mobile-overflow-`, `waiver-shift-`, `waiver-inert-`, `e2e-` and a
 * tail of one-off debugging ones (`dbg-`, `scratch-`, `hyd-`, `ux-`,
 * `shot-`); a prefix list would have left roughly 40% of them behind
 * and would silently miss whatever the next spec invents. The domain
 * is the real invariant, and it cannot name a live mailbox.
 *
 * The one address under it that might not be disposable is a seed
 * admin pointed at `example.com`, which is excluded explicitly.
 *
 * **Deleted in chunks, and that is not premature tuning.** The first
 * run of this against the accumulated backlog is a 500-user cascading
 * delete, and the dev server is already serving by the time global
 * setup runs. One statement that size holds SQLite's write lock long
 * enough to starve workerd, which has no busy timeout of its own and
 * fails the request outright — observed as
 * `database is locked: SQLITE_BUSY` in the worker log, taking an
 * unrelated spec down with it. Chunking bounds each lock hold; steady
 * state is one short transaction.
 */
export function sweepSeededUsers(): number {
  const protectedEmail = seedAdminEmail() ?? "";
  const handle = db();

  const ids = handle
    .prepare(
      "SELECT user_id FROM user_emails WHERE email LIKE ? AND email <> ?",
    )
    .all(`%@${E2E_EMAIL_DOMAIN}`, protectedEmail)
    .map((row) => (row as { user_id: string }).user_id);

  let removed = 0;
  const CHUNK_SIZE = 50;
  for (let start = 0; start < ids.length; start += CHUNK_SIZE) {
    const chunk = ids.slice(start, start + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    withTransaction((h) => {
      // `gear_loans.member_user_id` is ON DELETE RESTRICT — the one FK
      // to `users` that does not cascade, because production must not
      // lose the record of who has a piece of gear out. It therefore
      // blocks the delete, and the loan rows have to go first. Nothing
      // references `gear_loans` in turn, so this is the only step the
      // cascade can't do for us.
      h.prepare(
        `DELETE FROM gear_loans WHERE member_user_id IN (${placeholders})`,
      ).run(...chunk);
      removed += Number(
        h
          .prepare(`DELETE FROM users WHERE id IN (${placeholders})`)
          .run(...chunk).changes,
      );
    });
  }
  return removed;
}
