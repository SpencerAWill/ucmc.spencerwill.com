/**
 * Action implementations for the gear-loans feature. The shells in
 * `gear-fns.ts` dynamic-import this module from inside each
 * createServerFn handler so server-only code stays off the client.
 *
 * Authorization happens here: every officer-side action calls
 * `requireGearLoanManager`. `listMyLoansAction` only requires
 * `requireGearReader` because it's the member-self read path. The
 * privacy guarantee for `/my/gear` is enforced by filtering on
 * `memberUserId === principal.userId` inside the action itself.
 *
 * Audit emission is co-located with the data write. The checkout
 * batch emits N `loan.checked_out` events with `bulk: true` in
 * metadata so the audit page filters remain per-target; group by
 * `actor_user_id + checked_out_at` on read if you want to reconstruct
 * the original batch.
 */
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import {
  computeDueAt,
  MAX_LOAN_DURATION_DAYS,
} from "#/features/gear/lib/loan-duration";
import {
  requireGearLoanManager,
  requireGearReader,
} from "#/features/gear/server/permissions.server";
import {
  getGearByPublicId,
  updateGearById,
} from "#/features/gear/server/repo.server";
import {
  extendLoanDueAt,
  getGearByCode,
  getLoanByPublicId,
  getOpenLoanForGear,
  insertLoans,
  listLoans,
  listLoansForMember,
  markLoanReturned,
  getApprovedMemberByPublicId,
  searchApprovedMembers,
  searchGearByCode,
} from "#/features/gear/server/loans-repo.server";
import type {
  GearCodeSearchRow,
  LoanListRow,
  ListLoansOptions,
  ListLoansResult,
  MemberSearchResult,
} from "#/features/gear/server/loans-repo.server";
import {
  recordAuditEvent,
  recordAuditEvents,
} from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { getDb, isUniqueViolation, schema } from "#/server/db";

// ── public types ────────────────────────────────────────────────────────

export interface LoanSummary {
  publicId: string;
  gearPublicId: string;
  code: string | null;
  gearDescription: string;
  thumbnailKey: string | null;
  typeName: string;
  memberPublicId: string;
  memberFullName: string;
  memberAvatarKey: string | null;
  checkedOutAt: Date;
  dueAt: Date;
  returnedAt: Date | null;
  checkoutNotes: string | null;
  checkinNotes: string | null;
  conditionAtReturn: schema.GearCondition | null;
}

export interface LoanDetail extends LoanSummary {
  /** Officer who ran the checkout (display-name snapshot from profile).
   *  Nullable for the rare case the officer's user/profile was deleted. */
  checkedOutByName: string | null;
  returnedByName: string | null;
}

function toSummary(row: LoanListRow): LoanSummary {
  return {
    publicId: row.publicId,
    gearPublicId: row.gearPublicId,
    code: row.code,
    gearDescription: row.description,
    thumbnailKey: row.thumbnailKey,
    typeName: row.typeName,
    memberPublicId: row.memberPublicId,
    memberFullName: row.memberFullName,
    memberAvatarKey: row.memberAvatarKey,
    checkedOutAt: row.checkedOutAt,
    dueAt: row.dueAt,
    returnedAt: row.returnedAt,
    checkoutNotes: row.checkoutNotes,
    checkinNotes: row.checkinNotes,
    conditionAtReturn: row.conditionAtReturn,
  };
}

// ── checkout ────────────────────────────────────────────────────────────

export interface CheckoutLoansInput {
  memberPublicId: string;
  items: Array<{ gearPublicId: string; durationDays: number }>;
  notes: string | null;
}

export type CheckoutSkipReason =
  | "not_found"
  | "retired"
  | "not_serviceable"
  | "already_on_loan";

export type CheckoutResult =
  | {
      ok: true;
      gearPublicId: string;
      loanPublicId: string;
      code: string | null;
    }
  | { ok: false; gearPublicId: string; reason: CheckoutSkipReason };

export interface CheckoutLoansResult {
  results: CheckoutResult[];
}

async function resolveMember(memberPublicId: string): Promise<{
  userId: string;
} | null> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.users.id, status: schema.users.status })
    .from(schema.users)
    .where(eq(schema.users.publicId, memberPublicId))
    .limit(1);
  const row = rows.at(0);
  if (!row) return null;
  // Only approved members can borrow. Unclaimed/pending/rejected/
  // deactivated all fail closed.
  if (row.status !== "approved") return null;
  return { userId: row.id };
}

export async function checkoutLoansAction(
  input: CheckoutLoansInput,
): Promise<CheckoutLoansResult> {
  const principal = await requireGearLoanManager();
  const member = await resolveMember(input.memberPublicId);
  if (!member) {
    // Surface the same error shape as any other "not found" via
    // throwing; the client form validated the member before submit.
    throw new Error("Member not found or not approved");
  }
  const now = new Date();
  const results: CheckoutResult[] = [];
  const validRows: Array<{
    insert: Parameters<typeof insertLoans>[0][number];
    /** Carried through from the input so the success/skip result keeps
     *  the caller's original publicId for UI display. */
    gearPublicId: string;
    gearId: string;
    code: string | null;
    durationDays: number;
    dueAt: Date;
  }> = [];

  // Sequential pre-check: small N (typical batch ≤ 10), and we need
  // per-row resolution outcomes. The bulk insert + audit fan-out
  // happens after the loop in two D1 round-trips.
  for (const item of input.items) {
    const gear = await getGearByPublicId(item.gearPublicId);
    if (!gear) {
      results.push({
        ok: false,
        gearPublicId: item.gearPublicId,
        reason: "not_found",
      });
      continue;
    }
    if (gear.lifecycle === "retired") {
      results.push({
        ok: false,
        gearPublicId: item.gearPublicId,
        reason: "retired",
      });
      continue;
    }
    if (gear.condition !== "serviceable") {
      results.push({
        ok: false,
        gearPublicId: item.gearPublicId,
        reason: "not_serviceable",
      });
      continue;
    }
    const existing = await getOpenLoanForGear(gear.id);
    if (existing) {
      results.push({
        ok: false,
        gearPublicId: item.gearPublicId,
        reason: "already_on_loan",
      });
      continue;
    }
    const duration = Math.min(
      MAX_LOAN_DURATION_DAYS,
      Math.max(0, Math.floor(item.durationDays)),
    );
    const dueAt = computeDueAt(now, duration);
    const id = `gl_${uuidv7()}`;
    const publicId = generatePublicId();
    validRows.push({
      insert: {
        id,
        publicId,
        gearId: gear.id,
        memberUserId: member.userId,
        checkedOutByUserId: principal.userId,
        checkedOutAt: now,
        dueAt,
        checkoutNotes: input.notes,
      },
      gearPublicId: item.gearPublicId,
      gearId: gear.id,
      code: gear.code,
      durationDays: duration,
      dueAt,
    });
  }

  if (validRows.length === 0) {
    return { results };
  }

  // Try the bulk insert first. The partial unique index is what wins
  // races between two officers checking out the same piece at the same
  // instant — pre-check above is a UX nicety, not authoritative.
  try {
    await insertLoans(validRows.map((r) => r.insert));
    for (const row of validRows) {
      results.push({
        ok: true,
        gearPublicId: row.gearPublicId,
        loanPublicId: row.insert.publicId,
        code: row.code,
      });
    }
    await emitCheckoutAudits(principal.userId, member.userId, validRows);
    return { results };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  // Slow path (race): the bulk insert failed because at least one
  // piece was checked out by a concurrent officer. Replay row-by-row
  // so the winners still land and the loser is reported as skipped.
  const survivors: typeof validRows = [];
  for (const row of validRows) {
    try {
      await insertLoans([row.insert]);
      survivors.push(row);
      results.push({
        ok: true,
        gearPublicId: row.gearPublicId,
        loanPublicId: row.insert.publicId,
        code: row.code,
      });
    } catch (innerErr) {
      if (isUniqueViolation(innerErr)) {
        results.push({
          ok: false,
          gearPublicId: row.gearPublicId,
          reason: "already_on_loan",
        });
        continue;
      }
      throw innerErr;
    }
  }
  await emitCheckoutAudits(principal.userId, member.userId, survivors);
  return { results };
}

async function emitCheckoutAudits(
  actorUserId: string,
  memberUserId: string,
  rows: Array<{
    insert: { gearId: string; dueAt: Date };
    code: string | null;
    durationDays: number;
  }>,
): Promise<void> {
  await recordAuditEvents(
    rows.map((r) => ({
      actorUserId,
      action: "loan.checked_out" as const,
      targetType: "gear",
      targetId: r.insert.gearId,
      metadata: {
        memberUserId,
        gearId: r.insert.gearId,
        dueAt: r.insert.dueAt.getTime(),
        code: r.code,
        durationDays: r.durationDays,
        bulk: true,
      },
    })),
  );
}

// ── check-in ────────────────────────────────────────────────────────────

export interface CheckinLoansInput {
  items: Array<{
    gearPublicId: string;
    conditionAtReturn: schema.GearCondition | null;
    notes: string | null;
  }>;
}

export type CheckinSkipReason = "not_found" | "no_open_loan";

export type CheckinResult =
  | {
      ok: true;
      gearPublicId: string;
      loanPublicId: string;
      memberPublicId: string;
      memberFullName: string;
      overdue: boolean;
    }
  | { ok: false; gearPublicId: string; reason: CheckinSkipReason };

export interface CheckinLoansResult {
  results: CheckinResult[];
}

export async function checkinLoansAction(
  input: CheckinLoansInput,
): Promise<CheckinLoansResult> {
  const principal = await requireGearLoanManager();
  const now = new Date();
  const results: CheckinResult[] = [];
  const auditPayloads: Array<Parameters<typeof recordAuditEvents>[0][number]> =
    [];

  for (const item of input.items) {
    const gear = await getGearByPublicId(item.gearPublicId);
    if (!gear) {
      results.push({
        ok: false,
        gearPublicId: item.gearPublicId,
        reason: "not_found",
      });
      continue;
    }
    const loan = await getOpenLoanForGear(gear.id);
    if (!loan) {
      results.push({
        ok: false,
        gearPublicId: item.gearPublicId,
        reason: "no_open_loan",
      });
      continue;
    }
    await markLoanReturned({
      id: loan.id,
      returnedAt: now,
      returnedToUserId: principal.userId,
      checkinNotes: item.notes,
      conditionAtReturn: item.conditionAtReturn,
    });

    // If the officer noted a condition change, update the gear too
    // and emit a separate `gear.updated` audit row so the change is
    // traceable separately from the loan event.
    if (
      item.conditionAtReturn !== null &&
      item.conditionAtReturn !== gear.condition
    ) {
      await updateGearById(gear.id, { condition: item.conditionAtReturn });
      auditPayloads.push({
        actorUserId: principal.userId,
        action: "gear.updated",
        targetType: "gear",
        targetId: gear.id,
        metadata: {
          changedFields: ["condition"],
          condition: item.conditionAtReturn,
          priorCondition: gear.condition,
          reason: "checkin",
        },
      });
    }

    // Resolve the member's display info for the result + audit.
    const memberRows = await getDb()
      .select({
        publicId: schema.users.publicId,
        fullName: schema.profiles.fullName,
      })
      .from(schema.users)
      .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.users.id))
      .where(eq(schema.users.id, loan.memberUserId))
      .limit(1);
    const memberRow = memberRows.at(0);

    const daysHeldMs = now.getTime() - loan.checkedOutAt.getTime();
    const daysHeld = Math.round(daysHeldMs / (1000 * 60 * 60 * 24));
    const overdue = now.getTime() > loan.dueAt.getTime();

    auditPayloads.push({
      actorUserId: principal.userId,
      action: "loan.checked_in" as const,
      targetType: "gear",
      targetId: gear.id,
      metadata: {
        memberUserId: loan.memberUserId,
        gearId: gear.id,
        code: gear.code,
        conditionAtReturn: item.conditionAtReturn,
        daysHeld,
        overdue,
      },
    });

    results.push({
      ok: true,
      gearPublicId: item.gearPublicId,
      loanPublicId: loan.publicId,
      memberPublicId: memberRow?.publicId ?? "",
      memberFullName: memberRow?.fullName ?? "Unknown",
      overdue,
    });
  }

  if (auditPayloads.length > 0) {
    await recordAuditEvents(auditPayloads);
  }
  return { results };
}

// ── extend ──────────────────────────────────────────────────────────────

export type ExtendLoanResult =
  | { ok: true; dueAt: number }
  | {
      ok: false;
      reason: "not_found" | "loan_returned" | "due_before_now";
    };

export async function extendLoanAction(input: {
  publicId: string;
  newDueAt: number;
}): Promise<ExtendLoanResult> {
  const principal = await requireGearLoanManager();
  const loan = await getLoanByPublicId(input.publicId);
  if (!loan) return { ok: false, reason: "not_found" };
  if (loan.returnedAt !== null) return { ok: false, reason: "loan_returned" };
  const newDue = new Date(input.newDueAt);
  if (newDue.getTime() <= Date.now())
    return { ok: false, reason: "due_before_now" };

  const priorDueAt = loan.dueAt.getTime();
  await extendLoanDueAt({ id: loan.id, newDueAt: newDue });
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "loan.extended",
    targetType: "gear",
    targetId: loan.gearId,
    metadata: {
      loanId: loan.id,
      priorDueAt,
      newDueAt: newDue.getTime(),
      daysAdded: Math.round(
        (newDue.getTime() - priorDueAt) / (1000 * 60 * 60 * 24),
      ),
    },
  });
  return { ok: true, dueAt: newDue.getTime() };
}

// ── officer reads ───────────────────────────────────────────────────────

export interface ListLoansActionInput {
  tab?: "active" | "history";
  memberPublicId?: string;
  q?: string;
  overdueOnly?: boolean;
  sort?: "due_at" | "checked_out_at";
  page?: number;
  perPage?: number;
}

export interface ListLoansActionResult {
  rows: LoanSummary[];
  total: number;
  page: number;
  perPage: number;
}

export async function listLoansAction(
  input: ListLoansActionInput,
): Promise<ListLoansActionResult> {
  await requireGearLoanManager();
  const opts: ListLoansOptions = {
    tab: input.tab,
    q: input.q,
    overdueOnly: input.overdueOnly,
    sort: input.sort,
    page: input.page,
    perPage: input.perPage,
  };
  if (input.memberPublicId) {
    const memberRows = await getDb()
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.publicId, input.memberPublicId))
      .limit(1);
    const m = memberRows.at(0);
    if (!m) {
      return {
        rows: [],
        total: 0,
        page: input.page ?? 1,
        perPage: input.perPage ?? 50,
      };
    }
    opts.memberUserId = m.id;
  }
  const result: ListLoansResult = await listLoans(opts);
  return {
    rows: result.rows.map(toSummary),
    total: result.total,
    page: result.page,
    perPage: result.perPage,
  };
}

export async function getLoanDetailAction(input: {
  publicId: string;
}): Promise<LoanDetail> {
  await requireGearLoanManager();
  const loan = await getLoanByPublicId(input.publicId);
  if (!loan) throw new Error("Loan not found");
  const summary = toSummary(loan);
  // Officer display-name lookups for the audit-context fields on the
  // detail page. Best-effort — null when the user/profile was deleted.
  const db = getDb();
  const [outRow, inRow] = await db.batch([
    db
      .select({ fullName: schema.profiles.fullName })
      .from(schema.gearLoans)
      .leftJoin(
        schema.profiles,
        eq(schema.profiles.userId, schema.gearLoans.checkedOutByUserId),
      )
      .where(eq(schema.gearLoans.id, loan.id))
      .limit(1),
    db
      .select({ fullName: schema.profiles.fullName })
      .from(schema.gearLoans)
      .leftJoin(
        schema.profiles,
        eq(schema.profiles.userId, schema.gearLoans.returnedToUserId),
      )
      .where(eq(schema.gearLoans.id, loan.id))
      .limit(1),
  ]);
  return {
    ...summary,
    checkedOutByName: outRow[0]?.fullName ?? null,
    returnedByName: inRow[0]?.fullName ?? null,
  };
}

// ── member-side read ────────────────────────────────────────────────────

export async function listMyLoansAction(): Promise<{
  active: LoanSummary[];
  history: LoanSummary[];
}> {
  const principal = await requireGearReader();
  const { active, history } = await listLoansForMember(principal.userId);
  return {
    active: active.map(toSummary),
    history: history.map(toSummary),
  };
}

// ── search helpers (gear-desk pickers) ──────────────────────────────────

export async function searchMembersForLoanAction(input: {
  q: string;
}): Promise<MemberSearchResult[]> {
  await requireGearLoanManager();
  return searchApprovedMembers(input.q);
}

export async function getMemberForLoanAction(input: {
  publicId: string;
}): Promise<MemberSearchResult | null> {
  await requireGearLoanManager();
  return getApprovedMemberByPublicId(input.publicId);
}

export type GearLookupRow = GearCodeSearchRow;

export async function searchGearByCodeAction(input: {
  q: string;
}): Promise<GearLookupRow[]> {
  await requireGearLoanManager();
  return searchGearByCode(input.q);
}

export async function getGearByCodeAction(input: {
  code: string;
}): Promise<GearLookupRow | null> {
  await requireGearLoanManager();
  return getGearByCode(input.code);
}
