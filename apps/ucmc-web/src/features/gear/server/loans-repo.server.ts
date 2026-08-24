/**
 * Pure data access for gear loans. No auth, no business logic — the
 * action module is responsible for authorization and audit emission.
 *
 * `insertLoans` batches all rows into a single D1 round-trip via
 * Drizzle's multi-values insert. The partial unique index
 * `gear_loans_one_active_per_gear` is what actually wins races against
 * a concurrent second officer — the action layer's pre-check is just
 * for UX.
 */
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { getDb, likeContains, schema } from "#/server/db";

// ── shared row shapes ──────────────────────────────────────────────────

/** Wire-shape row for the officer loan list. Joins enough to render a
 *  card without a follow-up query. */
export interface LoanListRow {
  id: string;
  publicId: string;
  gearId: string;
  gearPublicId: string;
  code: string | null;
  description: string;
  thumbnailKey: string | null;
  typeName: string;
  memberUserId: string;
  memberPublicId: string;
  memberFullName: string;
  memberAvatarKey: string | null;
  checkedOutAt: Temporal.Instant;
  dueAt: Temporal.Instant;
  returnedAt: Temporal.Instant | null;
  checkoutNotes: string | null;
  checkinNotes: string | null;
  conditionAtReturn: schema.GearCondition | null;
}

// ── insert ─────────────────────────────────────────────────────────────

export interface InsertLoanRow {
  id: string;
  publicId: string;
  gearId: string;
  memberUserId: string;
  checkedOutByUserId: string;
  checkedOutAt: Temporal.Instant;
  dueAt: Temporal.Instant;
  checkoutNotes: string | null;
}

export async function insertLoans(rows: InsertLoanRow[]): Promise<void> {
  if (rows.length === 0) return;
  await getDb().insert(schema.gearLoans).values(rows);
}

// ── reads ──────────────────────────────────────────────────────────────

/**
 * Fetch the single open (un-returned) loan for a gear piece, or null.
 * Drives the eligibility check at checkout time and the "currently on
 * loan to X" surfacing on the gear detail page.
 */
export async function getOpenLoanForGear(
  gearId: string,
): Promise<schema.GearLoan | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.gearLoans)
    .where(
      and(
        eq(schema.gearLoans.gearId, gearId),
        isNull(schema.gearLoans.returnedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Bulk variant — for a set of gear ids, returns the open loan for
 * each (or omits the entry if none). Used by the bulk-retire and
 * bulk-import pre-checks to reject pieces that are mid-loan.
 */
export async function getOpenLoansForGearIds(
  gearIds: string[],
): Promise<Map<string, schema.GearLoan>> {
  const map = new Map<string, schema.GearLoan>();
  if (gearIds.length === 0) return map;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.gearLoans)
    .where(
      and(
        inArray(schema.gearLoans.gearId, gearIds),
        isNull(schema.gearLoans.returnedAt),
      ),
    );
  for (const row of rows) {
    map.set(row.gearId, row);
  }
  return map;
}

export async function getLoanByPublicId(
  publicId: string,
): Promise<LoanListRow | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.gearLoans.id,
      publicId: schema.gearLoans.publicId,
      gearId: schema.gearLoans.gearId,
      gearPublicId: schema.gear.publicId,
      code: schema.gear.code,
      description: schema.gear.description,
      thumbnailKey: schema.gear.thumbnailKey,
      typeName: schema.gearTypes.name,
      memberUserId: schema.gearLoans.memberUserId,
      memberPublicId: schema.users.publicId,
      memberFullName: schema.profiles.fullName,
      memberAvatarKey: schema.profiles.avatarKey,
      checkedOutAt: schema.gearLoans.checkedOutAt,
      dueAt: schema.gearLoans.dueAt,
      returnedAt: schema.gearLoans.returnedAt,
      checkoutNotes: schema.gearLoans.checkoutNotes,
      checkinNotes: schema.gearLoans.checkinNotes,
      conditionAtReturn: schema.gearLoans.conditionAtReturn,
    })
    .from(schema.gearLoans)
    .innerJoin(schema.gear, eq(schema.gear.id, schema.gearLoans.gearId))
    .innerJoin(schema.gearTypes, eq(schema.gearTypes.id, schema.gear.typeId))
    .innerJoin(schema.users, eq(schema.users.id, schema.gearLoans.memberUserId))
    .innerJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.gearLoans.memberUserId),
    )
    .where(eq(schema.gearLoans.publicId, publicId))
    .limit(1);
  return rows[0] ?? null;
}

export interface ListLoansFilters {
  /** "active" → returnedAt IS NULL. "history" → returnedAt IS NOT NULL. */
  tab?: "active" | "history";
  memberUserId?: string;
  /** Free-text against gear code, gear description, member full name,
   *  or member primary email (LIKE %q%). */
  q?: string;
  /** Active-only filter: due before now. */
  overdueOnly?: boolean;
}

export interface ListLoansOptions extends ListLoansFilters {
  sort?: "due_at" | "checked_out_at";
  page?: number;
  perPage?: number;
}

export interface ListLoansResult {
  rows: LoanListRow[];
  total: number;
  page: number;
  perPage: number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 250;

export async function listLoans(
  options: ListLoansOptions = {},
): Promise<ListLoansResult> {
  const db = getDb();
  const page = Math.max(1, options.page ?? DEFAULT_PAGE);
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, options.perPage ?? DEFAULT_PER_PAGE),
  );
  const clauses = [] as Parameters<typeof and>;
  if (options.tab === "active") {
    clauses.push(isNull(schema.gearLoans.returnedAt));
  } else if (options.tab === "history") {
    clauses.push(sql`${schema.gearLoans.returnedAt} IS NOT NULL`);
  }
  if (options.memberUserId) {
    clauses.push(eq(schema.gearLoans.memberUserId, options.memberUserId));
  }
  if (options.overdueOnly) {
    clauses.push(isNull(schema.gearLoans.returnedAt));
    clauses.push(sql`${schema.gearLoans.dueAt} < (unixepoch() * 1000)`);
  }
  if (options.q && options.q.trim().length > 0) {
    const q = options.q.trim();
    clauses.push(
      or(
        likeContains(schema.gear.code, q),
        likeContains(schema.gear.description, q),
        likeContains(schema.profiles.fullName, q),
        likeContains(schema.userEmails.email, q),
      ),
    );
  }
  const where = clauses.length === 0 ? undefined : and(...clauses);
  const sort =
    options.sort ?? (options.tab === "history" ? "checked_out_at" : "due_at");
  const orderBy =
    sort === "due_at"
      ? [asc(schema.gearLoans.dueAt)]
      : [desc(schema.gearLoans.checkedOutAt)];
  const rows = await db
    .select({
      id: schema.gearLoans.id,
      publicId: schema.gearLoans.publicId,
      gearId: schema.gearLoans.gearId,
      gearPublicId: schema.gear.publicId,
      code: schema.gear.code,
      description: schema.gear.description,
      thumbnailKey: schema.gear.thumbnailKey,
      typeName: schema.gearTypes.name,
      memberUserId: schema.gearLoans.memberUserId,
      memberPublicId: schema.users.publicId,
      memberFullName: schema.profiles.fullName,
      memberAvatarKey: schema.profiles.avatarKey,
      checkedOutAt: schema.gearLoans.checkedOutAt,
      dueAt: schema.gearLoans.dueAt,
      returnedAt: schema.gearLoans.returnedAt,
      checkoutNotes: schema.gearLoans.checkoutNotes,
      checkinNotes: schema.gearLoans.checkinNotes,
      conditionAtReturn: schema.gearLoans.conditionAtReturn,
    })
    .from(schema.gearLoans)
    .innerJoin(schema.gear, eq(schema.gear.id, schema.gearLoans.gearId))
    .innerJoin(schema.gearTypes, eq(schema.gearTypes.id, schema.gear.typeId))
    .innerJoin(schema.users, eq(schema.users.id, schema.gearLoans.memberUserId))
    .innerJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.gearLoans.memberUserId),
    )
    // Primary email join is INNER because every approved/unclaimed
    // borrower has exactly one primary row enforced by the partial
    // unique index `user_emails_one_primary_per_user`. Used by the
    // q-search OR clause; the COUNT below mirrors the join to keep
    // total + rows consistent.
    .innerJoin(
      schema.userEmails,
      and(
        eq(schema.userEmails.userId, schema.gearLoans.memberUserId),
        eq(schema.userEmails.isPrimary, true),
      ),
    )
    .where(where)
    .orderBy(...orderBy)
    .limit(perPage)
    .offset((page - 1) * perPage);
  const totalRow = await db
    .select({ value: sql<number>`COUNT(*)` })
    .from(schema.gearLoans)
    .innerJoin(schema.gear, eq(schema.gear.id, schema.gearLoans.gearId))
    .innerJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.gearLoans.memberUserId),
    )
    .innerJoin(
      schema.userEmails,
      and(
        eq(schema.userEmails.userId, schema.gearLoans.memberUserId),
        eq(schema.userEmails.isPrimary, true),
      ),
    )
    .where(where);
  const total = totalRow[0]?.value ?? 0;
  return { rows, total, page, perPage };
}

// ── mutations ──────────────────────────────────────────────────────────

export async function markLoanReturned(input: {
  id: string;
  returnedAt: Temporal.Instant;
  returnedToUserId: string;
  checkinNotes: string | null;
  conditionAtReturn: schema.GearCondition | null;
}): Promise<void> {
  await getDb()
    .update(schema.gearLoans)
    .set({
      returnedAt: input.returnedAt,
      returnedToUserId: input.returnedToUserId,
      checkinNotes: input.checkinNotes,
      conditionAtReturn: input.conditionAtReturn,
    })
    .where(eq(schema.gearLoans.id, input.id));
}

export async function extendLoanDueAt(input: {
  id: string;
  newDueAt: Temporal.Instant;
}): Promise<void> {
  await getDb()
    .update(schema.gearLoans)
    .set({ dueAt: input.newDueAt })
    .where(eq(schema.gearLoans.id, input.id));
}

// ── member-side ────────────────────────────────────────────────────────

/**
 * /my/gear reads — caller passes their own userId. Returns active and
 * history in one shot since both lists are small per-user.
 */
export async function listLoansForMember(
  memberUserId: string,
): Promise<{ active: LoanListRow[]; history: LoanListRow[] }> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.gearLoans.id,
      publicId: schema.gearLoans.publicId,
      gearId: schema.gearLoans.gearId,
      gearPublicId: schema.gear.publicId,
      code: schema.gear.code,
      description: schema.gear.description,
      thumbnailKey: schema.gear.thumbnailKey,
      typeName: schema.gearTypes.name,
      memberUserId: schema.gearLoans.memberUserId,
      memberPublicId: schema.users.publicId,
      memberFullName: schema.profiles.fullName,
      memberAvatarKey: schema.profiles.avatarKey,
      checkedOutAt: schema.gearLoans.checkedOutAt,
      dueAt: schema.gearLoans.dueAt,
      returnedAt: schema.gearLoans.returnedAt,
      checkoutNotes: schema.gearLoans.checkoutNotes,
      checkinNotes: schema.gearLoans.checkinNotes,
      conditionAtReturn: schema.gearLoans.conditionAtReturn,
    })
    .from(schema.gearLoans)
    .innerJoin(schema.gear, eq(schema.gear.id, schema.gearLoans.gearId))
    .innerJoin(schema.gearTypes, eq(schema.gearTypes.id, schema.gear.typeId))
    .innerJoin(schema.users, eq(schema.users.id, schema.gearLoans.memberUserId))
    .innerJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.gearLoans.memberUserId),
    )
    .where(eq(schema.gearLoans.memberUserId, memberUserId))
    .orderBy(asc(schema.gearLoans.dueAt));
  const active: LoanListRow[] = [];
  const history: LoanListRow[] = [];
  for (const row of rows) {
    if (row.returnedAt === null) active.push(row);
    else history.push(row);
  }
  // History sorted most-recently-returned first (overrides the
  // due-at ordering of the combined fetch).
  history.sort((a, b) => {
    const aReturned = a.returnedAt?.epochMilliseconds ?? 0;
    const bReturned = b.returnedAt?.epochMilliseconds ?? 0;
    return bReturned - aReturned;
  });
  return { active, history };
}

// ── search helpers (back the gear-desk lookups) ────────────────────────

export interface MemberSearchResult {
  userId: string;
  publicId: string;
  fullName: string;
  primaryEmail: string;
}

/**
 * Approved-member search keyed on name OR primary email. Used by the
 * checkout sheet's member combobox. Capped at 20 results; LIKE on
 * `profiles.fullName` and `user_emails.email`.
 */
export async function searchApprovedMembers(
  q: string,
  limit = 20,
): Promise<MemberSearchResult[]> {
  if (q.trim().length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      userId: schema.users.id,
      publicId: schema.users.publicId,
      fullName: schema.profiles.fullName,
      primaryEmail: schema.userEmails.email,
    })
    .from(schema.users)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .innerJoin(
      schema.userEmails,
      and(
        eq(schema.userEmails.userId, schema.users.id),
        eq(schema.userEmails.isPrimary, true),
      ),
    )
    .where(
      and(
        eq(schema.users.status, "approved"),
        or(
          likeContains(schema.profiles.fullName, q.trim()),
          likeContains(schema.userEmails.email, q.trim()),
        ),
      ),
    )
    .orderBy(asc(schema.profiles.fullName))
    .limit(limit);
  return rows;
}

/**
 * Resolve a single approved member by publicId. Used to hydrate the
 * loan-filter member chip on page refresh: the URL keeps only the
 * member's publicId; this fetches the display info (name + email) so
 * the filter combobox can render a populated chip without holding
 * the full object in browser state.
 */
export async function getApprovedMemberByPublicId(
  publicId: string,
): Promise<MemberSearchResult | null> {
  const db = getDb();
  const rows = await db
    .select({
      userId: schema.users.id,
      publicId: schema.users.publicId,
      fullName: schema.profiles.fullName,
      primaryEmail: schema.userEmails.email,
    })
    .from(schema.users)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
    .innerJoin(
      schema.userEmails,
      and(
        eq(schema.userEmails.userId, schema.users.id),
        eq(schema.userEmails.isPrimary, true),
      ),
    )
    .where(
      and(
        eq(schema.users.publicId, publicId),
        eq(schema.users.status, "approved"),
      ),
    )
    .limit(1);
  return rows.at(0) ?? null;
}

/**
 * Resolve a member for backfill. Accepts both `approved` and
 * `unclaimed` statuses (paper logbooks regularly involve members who
 * never finished claiming an account) but rejects `pending`,
 * `rejected`, and `deactivated` — those statuses shouldn't gain a
 * historical loan record retroactively. Lookups by email go through
 * the `user_emails` table so any verified or primary address on the
 * account matches.
 */
export interface BackfillMemberLookup {
  userId: string;
  publicId: string;
  status: "approved" | "unclaimed";
}

export async function lookupBackfillMemberByEmail(
  normalizedEmail: string,
): Promise<BackfillMemberLookup | null> {
  const db = getDb();
  const rows = await db
    .select({
      userId: schema.users.id,
      publicId: schema.users.publicId,
      status: schema.users.status,
    })
    .from(schema.userEmails)
    .innerJoin(schema.users, eq(schema.users.id, schema.userEmails.userId))
    .where(eq(schema.userEmails.email, normalizedEmail))
    .limit(1);
  const row = rows.at(0);
  if (!row) return null;
  if (row.status !== "approved" && row.status !== "unclaimed") return null;
  return {
    userId: row.userId,
    publicId: row.publicId,
    status: row.status,
  };
}

/**
 * Lookup gear by exact `code` for backfill. Returns the internal `id`
 * (needed for the FK on `gear_loans.gearId`) plus the publicId/code so
 * the caller can include it in the per-row result. Lifecycle /
 * condition are intentionally NOT filtered — a historical loan is
 * valid against gear that's retired today.
 */
export interface BackfillGearLookup {
  id: string;
  publicId: string;
  code: string;
}

export async function lookupBackfillGearByCode(
  code: string,
): Promise<BackfillGearLookup | null> {
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;
  const db = getDb();
  const rows = await db
    .select({
      id: schema.gear.id,
      publicId: schema.gear.publicId,
      code: schema.gear.code,
    })
    .from(schema.gear)
    .where(eq(schema.gear.code, trimmed))
    .limit(1);
  const row = rows.at(0);
  if (!row || row.code === null) return null;
  return { id: row.id, publicId: row.publicId, code: row.code };
}

/**
 * Joined shape used by the cart-hydration path. Same columns as
 * `GearCodeSearchRow` except `code` is nullable (the cart may
 * still hold a piece whose code was cleared by an officer post-add)
 * and the borrower display columns are dropped — cart UX doesn't
 * surface them, and dropping them keeps the query narrower.
 */
export interface GearCartHydrationRow {
  publicId: string;
  code: string | null;
  description: string;
  typeName: string;
  thumbnailKey: string | null;
  lifecycle: schema.GearLifecycle;
  condition: schema.GearCondition;
  hasOpenLoan: boolean;
}

/**
 * Batched lookup for cart hydration: one SQL round-trip resolves every
 * publicId to the joined `gear` ⨝ `gear_types` ⨝ (open `gear_loans`)
 * shape. Missing publicIds simply don't appear in the result; the
 * caller treats them as pruned-from-cart.
 *
 * The LEFT JOIN on `gear_loans WHERE returned_at IS NULL` is safe
 * because the `gear_loans_one_active_per_gear` partial unique index
 * guarantees ≤1 row per gear, so the JOIN can't fan-out the result.
 */
export async function getCartHydrationRowsByPublicIds(
  publicIds: string[],
): Promise<GearCartHydrationRow[]> {
  if (publicIds.length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      publicId: schema.gear.publicId,
      code: schema.gear.code,
      description: schema.gear.description,
      typeName: schema.gearTypes.name,
      thumbnailKey: schema.gear.thumbnailKey,
      lifecycle: schema.gear.lifecycle,
      condition: schema.gear.condition,
      // PK of the joined row is the only non-nullable column we can
      // use to detect a hit through the LEFT JOIN (`returnedAt` is
      // NULL both when there's no loan and when there's an open loan,
      // since the JOIN filter is `returnedAt IS NULL`).
      loanId: schema.gearLoans.id,
    })
    .from(schema.gear)
    .innerJoin(schema.gearTypes, eq(schema.gearTypes.id, schema.gear.typeId))
    .leftJoin(
      schema.gearLoans,
      and(
        eq(schema.gearLoans.gearId, schema.gear.id),
        isNull(schema.gearLoans.returnedAt),
      ),
    )
    .where(inArray(schema.gear.publicId, publicIds));
  return rows.map((r) => ({
    publicId: r.publicId,
    code: r.code,
    description: r.description,
    typeName: r.typeName,
    thumbnailKey: r.thumbnailKey,
    lifecycle: r.lifecycle,
    condition: r.condition,
    hasOpenLoan: r.loanId !== null,
  }));
}

/**
 * Gear search by code prefix. Returns rows shaped for the gear-desk
 * item picker — joined with gear_types for the type name and the open
 * loan (if any) so the picker can flag eligibility inline.
 */
export interface GearCodeSearchRow {
  publicId: string;
  code: string;
  description: string;
  typeName: string;
  thumbnailKey: string | null;
  lifecycle: schema.GearLifecycle;
  condition: schema.GearCondition;
  hasOpenLoan: boolean;
  openLoanMemberFullName: string | null;
  /** Borrower's R2 avatar key when an open loan exists — fuels the
   *  member-avatar column in the check-in pane. Null when no loan or
   *  the borrower hasn't uploaded a photo. */
  openLoanMemberAvatarKey: string | null;
}

export async function searchGearByCode(
  q: string,
  limit = 10,
): Promise<GearCodeSearchRow[]> {
  if (q.trim().length === 0) return [];
  const db = getDb();
  const rows = await db
    .select({
      publicId: schema.gear.publicId,
      code: schema.gear.code,
      description: schema.gear.description,
      typeName: schema.gearTypes.name,
      thumbnailKey: schema.gear.thumbnailKey,
      lifecycle: schema.gear.lifecycle,
      condition: schema.gear.condition,
      loanReturnedAt: schema.gearLoans.returnedAt,
      loanMemberFullName: schema.profiles.fullName,
      loanMemberAvatarKey: schema.profiles.avatarKey,
    })
    .from(schema.gear)
    .innerJoin(schema.gearTypes, eq(schema.gearTypes.id, schema.gear.typeId))
    .leftJoin(
      schema.gearLoans,
      and(
        eq(schema.gearLoans.gearId, schema.gear.id),
        isNull(schema.gearLoans.returnedAt),
      ),
    )
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.gearLoans.memberUserId),
    )
    .where(
      and(
        likeContains(schema.gear.code, q.trim()),
        sql`${schema.gear.code} IS NOT NULL`,
      ),
    )
    .orderBy(asc(schema.gear.code))
    .limit(limit);
  return rows.flatMap((r) => {
    if (r.code === null) return [];
    return [
      {
        publicId: r.publicId,
        code: r.code,
        description: r.description,
        typeName: r.typeName,
        thumbnailKey: r.thumbnailKey,
        lifecycle: r.lifecycle,
        condition: r.condition,
        hasOpenLoan: r.loanReturnedAt === null && r.loanMemberFullName !== null,
        openLoanMemberFullName: r.loanMemberFullName,
        openLoanMemberAvatarKey: r.loanMemberAvatarKey,
      },
    ];
  });
}

/**
 * Exact-match lookup used by the barcode scanner. Returns the same
 * row shape as `searchGearByCode` for callsite consistency. One row
 * max thanks to the unique constraint on `gear.code`.
 */
export async function getGearByCode(
  code: string,
): Promise<GearCodeSearchRow | null> {
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;
  const db = getDb();
  const rows = await db
    .select({
      publicId: schema.gear.publicId,
      code: schema.gear.code,
      description: schema.gear.description,
      typeName: schema.gearTypes.name,
      thumbnailKey: schema.gear.thumbnailKey,
      lifecycle: schema.gear.lifecycle,
      condition: schema.gear.condition,
      loanReturnedAt: schema.gearLoans.returnedAt,
      loanMemberFullName: schema.profiles.fullName,
      loanMemberAvatarKey: schema.profiles.avatarKey,
    })
    .from(schema.gear)
    .innerJoin(schema.gearTypes, eq(schema.gearTypes.id, schema.gear.typeId))
    .leftJoin(
      schema.gearLoans,
      and(
        eq(schema.gearLoans.gearId, schema.gear.id),
        isNull(schema.gearLoans.returnedAt),
      ),
    )
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.gearLoans.memberUserId),
    )
    .where(eq(schema.gear.code, trimmed))
    .limit(1);
  const r = rows.at(0);
  if (!r || r.code === null) return null;
  return {
    publicId: r.publicId,
    code: r.code,
    description: r.description,
    typeName: r.typeName,
    thumbnailKey: r.thumbnailKey,
    lifecycle: r.lifecycle,
    condition: r.condition,
    hasOpenLoan: r.loanReturnedAt === null && r.loanMemberFullName !== null,
    openLoanMemberFullName: r.loanMemberFullName,
    openLoanMemberAvatarKey: r.loanMemberAvatarKey,
  };
}
