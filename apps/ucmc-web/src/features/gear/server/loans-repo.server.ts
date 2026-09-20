/**
 * Pure data access for gear loans. No auth, no business logic — the
 * action module is responsible for authorization and audit emission.
 *
 * **Dual shape.** A loan names either a coded item (`itemId`) or a
 * counted model with a quantity (`modelId` + `quantity`, "six draws").
 * A CHECK constraint enforces exactly one. Every read path therefore
 * LEFT JOINs items and resolves the model through
 * `coalesce(loans.model_id, items.model_id)` — which is why the joins
 * below look heavier than the old single `innerJoin(gear)`.
 *
 * `insertLoans` batches all rows into a single D1 round-trip via
 * Drizzle's multi-values insert. The partial unique index
 * `gear_loans_one_active_per_item` is what actually wins races against
 * a concurrent second officer — the action layer's pre-check is just
 * for UX. Counted stock has no such index: it is guarded by an
 * available-quantity read-then-write that can over-lend by one under a
 * true tie, which the cave prefers to taking a lock.
 */
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { getDb, likeContains, schema } from "#/server/db";

// ── shared row shapes ──────────────────────────────────────────────────

/** Wire-shape row for the officer loan list. Joins enough to render a
 *  card without a follow-up query. */
export interface LoanListRow {
  id: string;
  publicId: string;
  /** Null for a counted loan — there is no single unit to point at. */
  itemId: string | null;
  itemPublicId: string | null;
  code: string | null;
  modelId: string;
  modelPublicId: string;
  modelName: string;
  manufacturer: string | null;
  /** What to show as the loan's subject: the item's own distinguishing
   *  note when it has one, otherwise the product name. */
  description: string;
  thumbnailKey: string | null;
  typeName: string;
  quantity: number;
  quantityReturned: number;
  quantityLost: number;
  /** True when this is a counted loan. Cheaper at every call site than
   *  re-deriving it from which id happens to be null. */
  isCounted: boolean;
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

/**
 * Columns every loan read selects. The model is reached through
 * `coalesce` so one shape serves both kinds of loan; the raw values are
 * folded into `LoanListRow` by `toLoanRow` rather than coalesced in SQL,
 * so the precedence lives in one readable place.
 */
const LOAN_COLUMNS = {
  id: schema.gearLoans.id,
  publicId: schema.gearLoans.publicId,
  itemId: schema.gearLoans.itemId,
  itemPublicId: schema.gearItems.publicId,
  code: schema.gearItems.code,
  itemDescription: schema.gearItems.description,
  itemThumbnailKey: schema.gearItems.thumbnailKey,
  modelId: schema.gearModels.id,
  modelPublicId: schema.gearModels.publicId,
  modelName: schema.gearModels.name,
  manufacturer: schema.gearModels.manufacturer,
  modelImageKey: schema.gearModels.imageKey,
  typeName: schema.gearTypes.name,
  quantity: schema.gearLoans.quantity,
  quantityReturned: schema.gearLoans.quantityReturned,
  quantityLost: schema.gearLoans.quantityLost,
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
} as const;

/**
 * What drizzle hands back for `LOAN_COLUMNS`. Written out rather than
 * inferred because the model and type joins are INNER (so those columns
 * are non-null) while the item join is LEFT — a distinction a mapped
 * type over the column map would lose.
 */
interface RawLoanRow {
  id: string;
  publicId: string;
  itemId: string | null;
  itemPublicId: string | null;
  code: string | null;
  itemDescription: string | null;
  itemThumbnailKey: string | null;
  modelId: string;
  modelPublicId: string;
  modelName: string;
  manufacturer: string | null;
  modelImageKey: string | null;
  typeName: string;
  quantity: number;
  quantityReturned: number;
  quantityLost: number;
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

function toLoanRow(r: RawLoanRow): LoanListRow {
  return {
    id: r.id,
    publicId: r.publicId,
    itemId: r.itemId,
    itemPublicId: r.itemPublicId,
    code: r.code,
    modelId: r.modelId,
    modelPublicId: r.modelPublicId,
    modelName: r.modelName,
    manufacturer: r.manufacturer,
    description: r.itemDescription ?? r.modelName,
    thumbnailKey: r.itemThumbnailKey ?? r.modelImageKey,
    typeName: r.typeName,
    quantity: r.quantity,
    quantityReturned: r.quantityReturned,
    quantityLost: r.quantityLost,
    isCounted: r.itemId === null,
    memberUserId: r.memberUserId,
    memberPublicId: r.memberPublicId,
    memberFullName: r.memberFullName,
    memberAvatarKey: r.memberAvatarKey,
    checkedOutAt: r.checkedOutAt,
    dueAt: r.dueAt,
    returnedAt: r.returnedAt,
    checkoutNotes: r.checkoutNotes,
    checkinNotes: r.checkinNotes,
    conditionAtReturn: r.conditionAtReturn,
  };
}

/** `gear_models.id = coalesce(loans.model_id, items.model_id)` — the one
 *  join condition that makes a single query serve both loan kinds. */
const MODEL_VIA_LOAN_OR_ITEM = sql`${schema.gearModels.id} = coalesce(${schema.gearLoans.modelId}, ${schema.gearItems.modelId})`;

// ── insert ─────────────────────────────────────────────────────────────

export interface InsertLoanRow {
  id: string;
  publicId: string;
  /** Exactly one of `itemId` / `modelId` — the CHECK constraint rejects
   *  both-or-neither at the DB layer. */
  itemId: string | null;
  modelId: string | null;
  quantity: number;
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
 * Fetch the single open (un-returned) loan for a coded item, or null.
 * Drives the eligibility check at checkout time and the "currently on
 * loan to X" surfacing on the item detail page.
 */
export async function getOpenLoanForItem(
  itemId: string,
): Promise<schema.GearLoan | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.gearLoans)
    .where(
      and(
        eq(schema.gearLoans.itemId, itemId),
        isNull(schema.gearLoans.returnedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Bulk variant — for a set of item ids, returns the open loan for each
 * (or omits the entry if none). Used by the bulk-deactivate and
 * bulk-import pre-checks to reject items that are mid-loan.
 */
export async function getOpenLoansForItemIds(
  itemIds: string[],
): Promise<Map<string, schema.GearLoan>> {
  const map = new Map<string, schema.GearLoan>();
  if (itemIds.length === 0) return map;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.gearLoans)
    .where(
      and(
        inArray(schema.gearLoans.itemId, itemIds),
        isNull(schema.gearLoans.returnedAt),
      ),
    );
  for (const row of rows) {
    if (row.itemId !== null) map.set(row.itemId, row);
  }
  return map;
}

/**
 * Units of a counted model currently out on loan, summed across every
 * open loan. `quantity - quantityReturned` rather than `quantity`, so a
 * partially-returned loan releases the units that actually came back.
 *
 * This is the read half of the availability check for counted stock —
 * and the reason available quantity is computed rather than stored.
 */
export async function openLoanQuantityForModels(
  modelIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (modelIds.length === 0) return map;
  const rows = await getDb()
    .select({
      modelId: schema.gearLoans.modelId,
      outstanding: sql<number>`sum(${schema.gearLoans.quantity} - ${schema.gearLoans.quantityReturned})`,
    })
    .from(schema.gearLoans)
    .where(
      and(
        inArray(schema.gearLoans.modelId, modelIds),
        isNull(schema.gearLoans.returnedAt),
      ),
    )
    .groupBy(schema.gearLoans.modelId);
  for (const row of rows) {
    if (row.modelId !== null) map.set(row.modelId, Number(row.outstanding));
  }
  return map;
}

export async function getLoanByPublicId(
  publicId: string,
): Promise<LoanListRow | null> {
  const db = getDb();
  const rows = await db
    .select(LOAN_COLUMNS)
    .from(schema.gearLoans)
    .leftJoin(
      schema.gearItems,
      eq(schema.gearItems.id, schema.gearLoans.itemId),
    )
    .innerJoin(schema.gearModels, MODEL_VIA_LOAN_OR_ITEM)
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearModels.typeId),
    )
    .innerJoin(schema.users, eq(schema.users.id, schema.gearLoans.memberUserId))
    .innerJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.gearLoans.memberUserId),
    )
    .where(eq(schema.gearLoans.publicId, publicId))
    .limit(1);
  const row = rows.at(0);
  return row ? toLoanRow(row) : null;
}

export interface ListLoansFilters {
  /** "active" → returnedAt IS NULL. "history" → returnedAt IS NOT NULL. */
  tab?: "active" | "history";
  memberUserId?: string;
  /** Free-text against item code, item description, model name, member
   *  full name, or member primary email (LIKE %q%). */
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
        likeContains(schema.gearItems.code, q),
        likeContains(schema.gearItems.description, q),
        likeContains(schema.gearModels.name, q),
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
    .select(LOAN_COLUMNS)
    .from(schema.gearLoans)
    .leftJoin(
      schema.gearItems,
      eq(schema.gearItems.id, schema.gearLoans.itemId),
    )
    .innerJoin(schema.gearModels, MODEL_VIA_LOAN_OR_ITEM)
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearModels.typeId),
    )
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
    .leftJoin(
      schema.gearItems,
      eq(schema.gearItems.id, schema.gearLoans.itemId),
    )
    .innerJoin(schema.gearModels, MODEL_VIA_LOAN_OR_ITEM)
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
  return { rows: rows.map(toLoanRow), total, page, perPage };
}

// ── mutations ──────────────────────────────────────────────────────────

export async function markLoanReturned(input: {
  id: string;
  returnedAt: Temporal.Instant;
  returnedToUserId: string;
  checkinNotes: string | null;
  conditionAtReturn: schema.GearCondition | null;
  /** Units handed back. Coded loans pass 1; a counted loan may close
   *  short, and the shortfall lands in `quantityLost`. */
  quantityReturned: number;
  quantityLost: number;
}): Promise<void> {
  await getDb()
    .update(schema.gearLoans)
    .set({
      returnedAt: input.returnedAt,
      returnedToUserId: input.returnedToUserId,
      checkinNotes: input.checkinNotes,
      conditionAtReturn: input.conditionAtReturn,
      quantityReturned: input.quantityReturned,
      quantityLost: input.quantityLost,
    })
    .where(eq(schema.gearLoans.id, input.id));
}

/**
 * Partial return on a counted loan: some draws come back, the loan stays
 * open for the rest. Leaves `returnedAt` null on purpose — the loan is
 * closed by `markLoanReturned` when the last unit lands or an officer
 * writes off the shortfall.
 */
export async function recordPartialReturn(input: {
  id: string;
  quantityReturned: number;
}): Promise<void> {
  await getDb()
    .update(schema.gearLoans)
    .set({ quantityReturned: input.quantityReturned })
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
  const raw = await db
    .select(LOAN_COLUMNS)
    .from(schema.gearLoans)
    .leftJoin(
      schema.gearItems,
      eq(schema.gearItems.id, schema.gearLoans.itemId),
    )
    .innerJoin(schema.gearModels, MODEL_VIA_LOAN_OR_ITEM)
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearModels.typeId),
    )
    .innerJoin(schema.users, eq(schema.users.id, schema.gearLoans.memberUserId))
    .innerJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.gearLoans.memberUserId),
    )
    .where(eq(schema.gearLoans.memberUserId, memberUserId))
    .orderBy(asc(schema.gearLoans.dueAt));
  const rows = raw.map(toLoanRow);
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

/**
 * Open loans that are past due for one member, newest-overdue first.
 * Backs the member-standing check — see
 * `src/server/gear/gear-cave-standing.server.ts`, which owns the
 * flag/block thresholds.
 */
export async function listOverdueLoansForMember(
  memberUserId: string,
  now: Temporal.Instant,
): Promise<Array<{ publicId: string; dueAt: Temporal.Instant }>> {
  return getDb()
    .select({
      publicId: schema.gearLoans.publicId,
      dueAt: schema.gearLoans.dueAt,
    })
    .from(schema.gearLoans)
    .where(
      and(
        eq(schema.gearLoans.memberUserId, memberUserId),
        isNull(schema.gearLoans.returnedAt),
        sql`${schema.gearLoans.dueAt} < ${now.epochMilliseconds}`,
      ),
    )
    .orderBy(asc(schema.gearLoans.dueAt));
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
    .from(schema.users)
    .innerJoin(schema.userEmails, eq(schema.userEmails.userId, schema.users.id))
    .where(
      and(
        eq(schema.userEmails.email, normalizedEmail),
        inArray(schema.users.status, ["approved", "unclaimed"]),
      ),
    )
    .limit(1);
  const row = rows.at(0);
  if (!row) return null;
  if (row.status !== "approved" && row.status !== "unclaimed") return null;
  return { userId: row.userId, publicId: row.publicId, status: row.status };
}

/**
 * Resolve an item by code for backfill, returning its internal id so
 * the caller can include it in the per-row result. Status and condition
 * are intentionally NOT filtered — a historical loan is valid against
 * gear that's retired today.
 */
export interface BackfillGearLookup {
  id: string;
  publicId: string;
  code: string;
}

export async function lookupBackfillItemByCode(
  code: string,
): Promise<BackfillGearLookup | null> {
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;
  const db = getDb();
  const rows = await db
    .select({
      id: schema.gearItems.id,
      publicId: schema.gearItems.publicId,
      code: schema.gearItems.code,
    })
    .from(schema.gearItems)
    .where(eq(schema.gearItems.code, trimmed))
    .limit(1);
  const row = rows.at(0);
  if (!row || row.code === null) return null;
  return { id: row.id, publicId: row.publicId, code: row.code };
}

/**
 * Joined shape used by the cart-hydration path. Same columns as
 * `GearCodeSearchRow` except `code` is nullable (the cart may still hold
 * an item whose code was released by an officer post-add) and the
 * borrower display columns are dropped — cart UX doesn't surface them,
 * and dropping them keeps the query narrower.
 */
export interface GearCartHydrationRow {
  publicId: string;
  code: string | null;
  description: string;
  typeName: string;
  thumbnailKey: string | null;
  status: schema.GearStatus;
  condition: schema.GearCondition;
  whereabouts: schema.GearWhereabouts;
  hasOpenLoan: boolean;
  hasActiveHold: boolean;
}

/**
 * Batched lookup for cart hydration: one SQL round-trip resolves every
 * publicId to the joined item ⨝ model ⨝ type ⨝ (open loan) shape.
 * Missing publicIds simply don't appear in the result; the caller treats
 * them as pruned-from-cart.
 *
 * The LEFT JOIN on `gear_loans WHERE returned_at IS NULL` is safe
 * because the `gear_loans_one_active_per_item` partial unique index
 * guarantees ≤1 row per item, so the JOIN can't fan-out the result.
 */
export async function getCartHydrationRowsByPublicIds(
  publicIds: string[],
  now: Temporal.Instant,
): Promise<GearCartHydrationRow[]> {
  if (publicIds.length === 0) return [];
  const db = getDb();
  const nowMs = now.epochMilliseconds;
  const rows = await db
    .select({
      publicId: schema.gearItems.publicId,
      code: schema.gearItems.code,
      itemDescription: schema.gearItems.description,
      modelName: schema.gearModels.name,
      typeName: schema.gearTypes.name,
      itemThumbnailKey: schema.gearItems.thumbnailKey,
      modelImageKey: schema.gearModels.imageKey,
      status: schema.gearItems.status,
      condition: schema.gearItems.condition,
      whereabouts: schema.gearItems.whereabouts,
      // PK of the joined row is the only non-nullable column we can
      // use to detect a hit through the LEFT JOIN (`returnedAt` is
      // NULL both when there's no loan and when there's an open loan,
      // since the JOIN filter is `returnedAt IS NULL`).
      loanId: schema.gearLoans.id,
      // Correlated EXISTS rather than a second LEFT JOIN: two
      // overlapping holds on one item would fan the row out, and the
      // cart only needs the boolean. Mirrors `liveWhere` in
      // holds-repo.server.ts — unreleased and inside its window.
      hasActiveHold: sql<number>`EXISTS (
        SELECT 1 FROM ${schema.gearHolds}
        WHERE ${schema.gearHolds.itemId} = ${schema.gearItems.id}
          AND ${schema.gearHolds.releasedAt} IS NULL
          AND ${schema.gearHolds.startsAt} <= ${nowMs}
          AND ${schema.gearHolds.endsAt} > ${nowMs}
      )`,
    })
    .from(schema.gearItems)
    .innerJoin(
      schema.gearModels,
      eq(schema.gearModels.id, schema.gearItems.modelId),
    )
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearModels.typeId),
    )
    .leftJoin(
      schema.gearLoans,
      and(
        eq(schema.gearLoans.itemId, schema.gearItems.id),
        isNull(schema.gearLoans.returnedAt),
      ),
    )
    .where(inArray(schema.gearItems.publicId, publicIds));
  return rows.map((r) => ({
    publicId: r.publicId,
    code: r.code,
    description: r.itemDescription ?? r.modelName,
    typeName: r.typeName,
    thumbnailKey: r.itemThumbnailKey ?? r.modelImageKey,
    status: r.status,
    condition: r.condition,
    whereabouts: r.whereabouts,
    hasOpenLoan: r.loanId !== null,
    hasActiveHold: r.hasActiveHold === 1,
  }));
}

/**
 * Item search by code prefix. Returns rows shaped for the gear-desk
 * picker — joined through the model for the product and type names, and
 * with the open loan (if any) so the picker can flag eligibility inline.
 *
 * Deactivated items are deliberately included: scanning a retired
 * harness should say "retired, do not loan", which is more useful than
 * "not found". The caller renders them ineligible.
 */
export interface GearCodeSearchRow {
  publicId: string;
  code: string;
  description: string;
  typeName: string;
  thumbnailKey: string | null;
  status: schema.GearStatus;
  condition: schema.GearCondition;
  hasOpenLoan: boolean;
  openLoanMemberFullName: string | null;
  /** Borrower's R2 avatar key when an open loan exists — fuels the
   *  member-avatar column in the check-in pane. Null when no loan or
   *  the borrower hasn't uploaded a photo. */
  openLoanMemberAvatarKey: string | null;
}

const CODE_SEARCH_COLUMNS = {
  publicId: schema.gearItems.publicId,
  code: schema.gearItems.code,
  itemDescription: schema.gearItems.description,
  modelName: schema.gearModels.name,
  typeName: schema.gearTypes.name,
  itemThumbnailKey: schema.gearItems.thumbnailKey,
  modelImageKey: schema.gearModels.imageKey,
  status: schema.gearItems.status,
  condition: schema.gearItems.condition,
  loanReturnedAt: schema.gearLoans.returnedAt,
  loanMemberFullName: schema.profiles.fullName,
  loanMemberAvatarKey: schema.profiles.avatarKey,
} as const;

function toCodeSearchRow(r: {
  publicId: string;
  code: string | null;
  itemDescription: string | null;
  modelName: string;
  typeName: string;
  itemThumbnailKey: string | null;
  modelImageKey: string | null;
  status: schema.GearStatus;
  condition: schema.GearCondition;
  loanReturnedAt: Temporal.Instant | null;
  loanMemberFullName: string | null;
  loanMemberAvatarKey: string | null;
}): GearCodeSearchRow | null {
  if (r.code === null) return null;
  return {
    publicId: r.publicId,
    code: r.code,
    description: r.itemDescription ?? r.modelName,
    typeName: r.typeName,
    thumbnailKey: r.itemThumbnailKey ?? r.modelImageKey,
    status: r.status,
    condition: r.condition,
    hasOpenLoan: r.loanReturnedAt === null && r.loanMemberFullName !== null,
    openLoanMemberFullName: r.loanMemberFullName,
    openLoanMemberAvatarKey: r.loanMemberAvatarKey,
  };
}

export async function searchItemsByCode(
  q: string,
  limit = 10,
): Promise<GearCodeSearchRow[]> {
  if (q.trim().length === 0) return [];
  const db = getDb();
  const rows = await db
    .select(CODE_SEARCH_COLUMNS)
    .from(schema.gearItems)
    .innerJoin(
      schema.gearModels,
      eq(schema.gearModels.id, schema.gearItems.modelId),
    )
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearModels.typeId),
    )
    .leftJoin(
      schema.gearLoans,
      and(
        eq(schema.gearLoans.itemId, schema.gearItems.id),
        isNull(schema.gearLoans.returnedAt),
      ),
    )
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.gearLoans.memberUserId),
    )
    .where(
      and(
        likeContains(schema.gearItems.code, q.trim()),
        sql`${schema.gearItems.code} IS NOT NULL`,
      ),
    )
    .orderBy(asc(schema.gearItems.code))
    .limit(limit);
  return rows.flatMap((r) => {
    const mapped = toCodeSearchRow(r);
    return mapped ? [mapped] : [];
  });
}

/**
 * Exact-match lookup used by the barcode scanner. Returns the same row
 * shape as `searchItemsByCode` for callsite consistency. One row max
 * thanks to the unique constraint on `gear_items.code`.
 */
export async function getItemByCode(
  code: string,
): Promise<GearCodeSearchRow | null> {
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;
  const db = getDb();
  const rows = await db
    .select(CODE_SEARCH_COLUMNS)
    .from(schema.gearItems)
    .innerJoin(
      schema.gearModels,
      eq(schema.gearModels.id, schema.gearItems.modelId),
    )
    .innerJoin(
      schema.gearTypes,
      eq(schema.gearTypes.id, schema.gearModels.typeId),
    )
    .leftJoin(
      schema.gearLoans,
      and(
        eq(schema.gearLoans.itemId, schema.gearItems.id),
        isNull(schema.gearLoans.returnedAt),
      ),
    )
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.userId, schema.gearLoans.memberUserId),
    )
    .where(eq(schema.gearItems.code, trimmed))
    .limit(1);
  const r = rows.at(0);
  return r ? toCodeSearchRow(r) : null;
}

/**
 * The live hold on an item, if any — unreleased and with `now` inside
 * its window. Holds auto-release by expiry rather than by a cron, so
 * "live" is evaluated at read time against the clock.
 *
 * Returns the earliest-ending one when several overlap: that is the
 * hold a checkout would collide with first, and it is the one the desk
 * should name when it refuses.
 */
export async function getActiveHoldForItem(
  itemId: string,
  now: Temporal.Instant,
): Promise<schema.GearHold | null> {
  const rows = await getDb()
    .select()
    .from(schema.gearHolds)
    .where(
      and(
        eq(schema.gearHolds.itemId, itemId),
        isNull(schema.gearHolds.releasedAt),
        sql`${schema.gearHolds.startsAt} <= ${now.epochMilliseconds}`,
        sql`${schema.gearHolds.endsAt} > ${now.epochMilliseconds}`,
      ),
    )
    .orderBy(asc(schema.gearHolds.endsAt))
    .limit(1);
  return rows.at(0) ?? null;
}
