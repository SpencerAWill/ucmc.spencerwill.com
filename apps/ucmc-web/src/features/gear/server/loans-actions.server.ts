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

import { CLUB_TIME_ZONE } from "#/config/time";
import {
  computeDueAt,
  MAX_LOAN_DURATION_DAYS,
} from "#/features/gear/lib/loan-duration";
import {
  requireGearLoanManager,
  requireGearReader,
} from "#/features/gear/server/permissions.server";
import {
  getGearItemByPublicId,
  updateGearItemById,
} from "#/features/gear/server/repo.server";
import { liveHeldQuantityForModels } from "#/features/gear/server/holds-repo.server";
import {
  getGearModelByPublicId,
  listStockForModelIds,
} from "#/features/gear/server/models-repo.server";
import {
  extendLoanDueAt,
  getDeskModelByPublicId,
  getItemByCode,
  getLoanByPublicId,
  getActiveHoldForItem,
  getOpenLoanForItem,
  insertCountedLoanIfAvailable,
  insertLoans,
  listLoans,
  listLoansForMember,
  markLoanReturned,
  openLoanQuantityForModels,
  getApprovedMemberByPublicId,
  searchApprovedMembers,
  searchCountedModelsForDesk,
  searchItemsByCode,
} from "#/features/gear/server/loans-repo.server";
import { parseWeekdayList } from "#/lib/weekdays";
import { gearCaveStanding } from "#/server/gear/gear-cave-standing.server";
import type { GearCaveStanding } from "#/server/gear/gear-cave-standing.server";
import type {
  LoanSortDirection,
  LoanSortKey,
} from "#/features/gear/lib/loan-sort";
import type {
  CountedDeskModelRow,
  GearCodeSearchRow,
  InsertLoanRow,
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
  /** Null for a counted loan — there is no single unit to link to. */
  gearPublicId: string | null;
  code: string | null;
  gearName: string;
  /** How many units this loan covers, and how many are back. Always 1
   *  and 0 for a coded loan; for a counted one the quantity IS the
   *  loan — "six draws" — and the list surfaces had no way to say so. */
  quantity: number;
  quantityReturned: number;
  thumbnailKey: string | null;
  typeName: string;
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

export interface LoanDetail extends LoanSummary {
  /** Officer who ran the checkout (display-name snapshot from profile).
   *  Nullable for the rare case the officer's user/profile was deleted. */
  checkedOutByName: string | null;
  returnedByName: string | null;
}

function toSummary(row: LoanListRow): LoanSummary {
  return {
    publicId: row.publicId,
    gearPublicId: row.itemPublicId,
    code: row.code,
    gearName: row.name,
    quantity: row.quantity,
    quantityReturned: row.quantityReturned,
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

/** One row of a desk batch: a coded piece, or a quantity of a counted
 *  model. Per-row, so "a harness and six draws" is one checkout. */
export type CheckoutRowInput =
  | { kind: "coded"; gearPublicId: string; durationDays: number }
  | {
      kind: "counted";
      modelPublicId: string;
      quantity: number;
      durationDays: number;
    };

export interface CheckoutLoansInput {
  memberPublicId: string;
  items: CheckoutRowInput[];
  notes: string | null;
  /** Officer overrides, both `gear:manage`-gated and both audited. A
   *  non-manager passing either is ignored rather than rejected — the
   *  desk UI only offers them to a manager, so a request carrying one
   *  is a stale client, not an attack worth a distinct error. */
  overrideStanding?: boolean;
  overrideHolds?: boolean;
}

export type CheckoutSkipReason =
  | "not_found"
  | "retired"
  | "not_serviceable"
  | "already_on_loan"
  | "on_hold"
  | "member_blocked"
  /** A `ucmc-model:` row naming a model tracked unit by unit. */
  | "not_counted"
  /** Fewer serviceable units on the shelf than were asked for, holds
   *  aside. A hard stop: no override hands out draws that aren't there. */
  | "insufficient_stock";

export type CheckoutResult =
  | {
      ok: true;
      kind: "coded";
      gearPublicId: string;
      loanPublicId: string;
      code: string | null;
    }
  | {
      ok: true;
      kind: "counted";
      modelPublicId: string;
      loanPublicId: string;
      quantity: number;
    }
  | {
      ok: false;
      kind: "coded";
      gearPublicId: string;
      reason: CheckoutSkipReason;
    }
  | {
      ok: false;
      kind: "counted";
      modelPublicId: string;
      reason: CheckoutSkipReason;
      /** Units the desk could have handed out when this row was refused,
       *  so the message can say "only 4 left" rather than just "no". */
      available: number | null;
    };

export interface CheckoutLoansResult {
  results: CheckoutResult[];
}

function refuseRow(
  row: CheckoutRowInput,
  reason: CheckoutSkipReason,
  available: number | null = null,
): CheckoutResult {
  return row.kind === "coded"
    ? { ok: false, kind: "coded", gearPublicId: row.gearPublicId, reason }
    : {
        ok: false,
        kind: "counted",
        modelPublicId: row.modelPublicId,
        reason,
        available,
      };
}

function clampDuration(durationDays: number): number {
  return Math.min(
    MAX_LOAN_DURATION_DAYS,
    Math.max(0, Math.floor(durationDays)),
  );
}

interface CountedStockTerms {
  serviceable: number;
  onLoan: number;
  held: number;
}

/**
 * Serviceable stock, units outstanding on open loans, and the live held
 * quantity per counted model — the three terms of `takeable`. Read by
 * the desk lookups and to explain a refusal; the authoritative check is
 * the conditional insert, which recomputes them in SQL.
 */
async function countedStockTerms(
  modelIds: string[],
  now: Temporal.Instant,
): Promise<Map<string, CountedStockTerms>> {
  const [stock, onLoan, held] = await Promise.all([
    listStockForModelIds(modelIds),
    openLoanQuantityForModels(modelIds),
    liveHeldQuantityForModels(modelIds, now),
  ]);
  return new Map(
    modelIds.map((id) => [
      id,
      {
        serviceable:
          stock.get(id)?.find((s) => s.condition === "serviceable")?.quantity ??
          0,
        onLoan: onLoan.get(id) ?? 0,
        held: held.get(id) ?? 0,
      },
    ]),
  );
}

const NO_STOCK: CountedStockTerms = { serviceable: 0, onLoan: 0, held: 0 };

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

/** A row that passed its pre-check, carried to the insert and audit. */
interface PendingLoan {
  insert: InsertLoanRow;
  code: string | null;
  durationDays: number;
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
  const now = Temporal.Now.instant();

  // Cave standing is checked once per batch, not per item: it is a
  // property of the borrower, so a blocked member fails every row and
  // re-reading their overdue list ten times would just be ten queries
  // for the same answer.
  //
  // The officer override is deliberate and audited rather than silent —
  // `gear:manage` is the same grant that can retire gear, so someone
  // holding it deciding "let them take the rope anyway" is a judgement
  // the system should permit and record, not prevent.
  const standing = await gearCaveStanding({
    memberUserId: member.userId,
    now,
    timeZone: CLUB_TIME_ZONE,
  });
  //
  // Both flags are resolved through the same `gear:manage` check:
  // `requireGearLoanManager` above only asserts `gear:loan`, which is
  // deliberately delegable to a desk keeper who holds nothing else, so
  // reading either flag raw would hand that keeper the override.
  const canOverride = principal.permissions.includes("gear:manage");
  const overrideStanding = input.overrideStanding === true && canOverride;
  const overrideHolds = input.overrideHolds === true && canOverride;
  if (standing.standing === "blocked" && !overrideStanding) {
    return {
      results: input.items.map((row) => refuseRow(row, "member_blocked")),
    };
  }

  const results: CheckoutResult[] = [];
  const coded: Array<PendingLoan & { gearPublicId: string }> = [];
  const counted: Array<
    PendingLoan & {
      modelPublicId: string;
      modelId: string;
      quantity: number;
    }
  > = [];

  const pendingInsert = (
    durationDays: number,
    subject:
      { itemId: string; modelId: null } | { itemId: null; modelId: string },
    quantity: number,
  ): { insert: InsertLoanRow; durationDays: number } => {
    const duration = clampDuration(durationDays);
    return {
      insert: {
        id: `gl_${uuidv7()}`,
        publicId: generatePublicId(),
        ...subject,
        quantity,
        memberUserId: member.userId,
        checkedOutByUserId: principal.userId,
        checkedOutAt: now,
        dueAt: computeDueAt(now, duration),
        checkoutNotes: input.notes,
      },
      durationDays: duration,
    };
  };

  // Sequential pre-check: small N (typical batch ≤ 10), and we need
  // per-row resolution outcomes. The coded rows go in as one bulk
  // insert after the loop; counted rows each take a guarded insert.
  for (const row of input.items) {
    if (row.kind === "counted") {
      const model = await getGearModelByPublicId(row.modelPublicId);
      if (!model) {
        results.push(refuseRow(row, "not_found"));
        continue;
      }
      if (model.tracking !== "counted") {
        results.push(refuseRow(row, "not_counted"));
        continue;
      }
      counted.push({
        ...pendingInsert(
          row.durationDays,
          { itemId: null, modelId: model.id },
          Math.floor(row.quantity),
        ),
        code: null,
        modelPublicId: row.modelPublicId,
        modelId: model.id,
        quantity: Math.floor(row.quantity),
      });
      continue;
    }

    const gear = await getGearItemByPublicId(row.gearPublicId);
    if (!gear) {
      results.push(refuseRow(row, "not_found"));
      continue;
    }
    if (gear.status !== "active") {
      results.push(refuseRow(row, "retired"));
      continue;
    }
    if (gear.condition !== "serviceable") {
      results.push(refuseRow(row, "not_serviceable"));
      continue;
    }
    const existing = await getOpenLoanForItem(gear.id);
    if (existing) {
      results.push(refuseRow(row, "already_on_loan"));
      continue;
    }
    // A live hold blocks the desk the same way it blocks the member —
    // a warning nobody has to act on gets trampled, and then holds stop
    // being trusted. Officers pass `overrideHolds` to proceed.
    if (!overrideHolds) {
      const held = await getActiveHoldForItem(gear.id, now);
      if (held) {
        results.push(refuseRow(row, "on_hold"));
        continue;
      }
    }
    coded.push({
      // Coded checkout: one named item, quantity 1.
      ...pendingInsert(row.durationDays, { itemId: gear.id, modelId: null }, 1),
      code: gear.code,
      gearPublicId: row.gearPublicId,
    });
  }

  const landed: PendingLoan[] = [];
  const landCoded = (row: (typeof coded)[number]) => {
    landed.push(row);
    results.push({
      ok: true,
      kind: "coded",
      gearPublicId: row.gearPublicId,
      loanPublicId: row.insert.publicId,
      code: row.code,
    });
  };

  // Try the bulk insert first. The partial unique index is what wins
  // races between two officers checking out the same piece at the same
  // instant — pre-check above is a UX nicety, not authoritative.
  let codedRaced = false;
  if (coded.length > 0) {
    try {
      await insertLoans(coded.map((r) => r.insert));
      coded.forEach(landCoded);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      codedRaced = true;
    }
  }

  // Slow path (race): the bulk insert failed because at least one
  // piece was checked out by a concurrent officer. Replay row-by-row
  // so the winners still land and the loser is reported as skipped.
  if (codedRaced) {
    for (const row of coded) {
      try {
        await insertLoans([row.insert]);
        landCoded(row);
      } catch (innerErr) {
        if (!isUniqueViolation(innerErr)) throw innerErr;
        results.push({
          ok: false,
          kind: "coded",
          gearPublicId: row.gearPublicId,
          reason: "already_on_loan",
        });
      }
    }
  }

  // Counted rows, one guarded insert each. Sequential on purpose: two
  // rows for different models are independent, but the guard is only
  // as good as the statement order, and the zod boundary already
  // refuses two rows for one model.
  for (const row of counted) {
    const inserted = await insertCountedLoanIfAvailable(
      { ...row.insert, modelId: row.modelId },
      { now, respectHolds: !overrideHolds },
    );
    if (inserted) {
      landed.push(row);
      results.push({
        ok: true,
        kind: "counted",
        modelPublicId: row.modelPublicId,
        loanPublicId: row.insert.publicId,
        quantity: row.quantity,
      });
      continue;
    }
    // Refused. Read the terms back only to say WHY, and how many there
    // were: a hold is the officer's to override, an empty shelf is not.
    // This read can disagree with the statement that just refused (a
    // return may have landed in between), which costs a message that
    // is a beat stale — never a wrong loan.
    const terms =
      (await countedStockTerms([row.modelId], now)).get(row.modelId) ??
      NO_STOCK;
    const free = Math.max(0, terms.serviceable - terms.onLoan);
    const takeable = overrideHolds ? free : Math.max(0, free - terms.held);
    results.push({
      ok: false,
      kind: "counted",
      modelPublicId: row.modelPublicId,
      reason:
        !overrideHolds && free >= row.quantity
          ? "on_hold"
          : "insufficient_stock",
      available: takeable,
    });
  }

  await emitCheckoutAudits(principal.userId, member.userId, landed, {
    overrideStanding,
    overrideHolds,
  });
  return { results };
}

async function emitCheckoutAudits(
  actorUserId: string,
  memberUserId: string,
  rows: PendingLoan[],
  /** Recorded on every row of the batch. An override is a judgement an
   *  officer made about this checkout, so it belongs on the event the
   *  audit page shows, not only in the desk's memory. */
  overrides: { overrideStanding: boolean; overrideHolds: boolean },
): Promise<void> {
  if (rows.length === 0) return;
  await recordAuditEvents(
    rows.map((r) => ({
      actorUserId,
      action: "loan.checked_out" as const,
      targetType: "gear",
      targetId: r.insert.itemId ?? r.insert.modelId,
      metadata: {
        memberUserId,
        // `level` + `quantity` tell a six-draw loan from one harness.
        // Same vocabulary batch inspections already use, rather than a
        // second one for the same distinction.
        level: r.insert.itemId !== null ? "item" : "model",
        quantity: r.insert.quantity,
        itemId: r.insert.itemId,
        modelId: r.insert.modelId,
        dueAt: r.insert.dueAt.epochMilliseconds,
        code: r.code,
        durationDays: r.durationDays,
        bulk: true,
        overrideStanding: overrides.overrideStanding,
        overrideHolds: overrides.overrideHolds,
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
  const now = Temporal.Now.instant();
  const results: CheckinResult[] = [];
  const auditPayloads: Array<Parameters<typeof recordAuditEvents>[0][number]> =
    [];

  for (const item of input.items) {
    const gear = await getGearItemByPublicId(item.gearPublicId);
    if (!gear) {
      results.push({
        ok: false,
        gearPublicId: item.gearPublicId,
        reason: "not_found",
      });
      continue;
    }
    const loan = await getOpenLoanForItem(gear.id);
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
      // A coded loan is all-or-nothing: the single unit either came
      // back or it did not, and check-in here only ever means it did.
      quantityReturned: loan.quantity,
      quantityLost: 0,
    });

    // If the officer noted a condition change, update the gear too
    // and emit a separate `gear.updated` audit row so the change is
    // traceable separately from the loan event.
    if (
      item.conditionAtReturn !== null &&
      item.conditionAtReturn !== gear.condition
    ) {
      await updateGearItemById(gear.id, { condition: item.conditionAtReturn });
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

    const daysHeldMs =
      now.epochMilliseconds - loan.checkedOutAt.epochMilliseconds;
    const daysHeld = Math.round(daysHeldMs / (1000 * 60 * 60 * 24));
    const overdue = Temporal.Instant.compare(now, loan.dueAt) > 0;

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
      reason:
        | "not_found"
        | "loan_returned"
        | "due_before_now"
        | "overdue_requires_override";
    };

/**
 * Push a loan's due date out.
 *
 * **Extending an ALREADY-OVERDUE loan is an override, not routine.**
 * Standing is `daysOverdue(dueAt, now)`, so pushing the date out resets
 * it — a one-day extension on a rope that is thirty days late turns a
 * blocked member back into a good one. That made "extend" the silent
 * escape hatch from the whole overdue apparatus, which is exactly the
 * hole the reminder ladder would otherwise leak through.
 *
 * So it takes the same shape checkout already uses for blocked standing
 * and live holds: routine for a loan that is not yet due (`gear:loan`,
 * the delegable desk tier), an explicit, reasoned, audited override once
 * it is (`gear:manage`). The judgement is permitted and recorded rather
 * than prevented.
 *
 * Note what this deliberately does NOT do: there is still no cap on how
 * far out, or how many times, a not-yet-due loan can be extended.
 * `MAX_LOAN_DURATION_DAYS` remains checkout-only. That was a conscious
 * scoping call (#224) — the standing escape is the part that made the
 * ladder meaningless, and a length cap barely touches it.
 */
export async function extendLoanAction(input: {
  publicId: string;
  newDueAt: number;
  /** Requires `gear:manage`; ignored without it. */
  overrideOverdue?: boolean;
  /** Why the overdue loan was extended. Recorded in the audit row. */
  overrideReason?: string | null;
}): Promise<ExtendLoanResult> {
  const principal = await requireGearLoanManager();
  const loan = await getLoanByPublicId(input.publicId);
  if (!loan) return { ok: false, reason: "not_found" };
  if (loan.returnedAt !== null) return { ok: false, reason: "loan_returned" };
  const now = Temporal.Now.instant();
  const newDue = Temporal.Instant.fromEpochMilliseconds(input.newDueAt);
  if (Temporal.Instant.compare(newDue, now) <= 0)
    return { ok: false, reason: "due_before_now" };

  // Resolved through `gear:manage` on the REAL principal, like the
  // checkout overrides: `requireGearLoanManager` above only asserts
  // `gear:loan`, which is deliberately delegable to a desk keeper who
  // holds nothing else, so reading the flag raw would hand that keeper
  // the override. Role emulation can't fake it either, by design.
  const canOverride = principal.permissions.includes("gear:manage");
  const alreadyOverdue = Temporal.Instant.compare(now, loan.dueAt) > 0;
  const overrideOverdue = input.overrideOverdue === true && canOverride;
  if (alreadyOverdue && !overrideOverdue) {
    return { ok: false, reason: "overdue_requires_override" };
  }

  const priorDueAt = loan.dueAt.epochMilliseconds;
  const priorReminderStage = loan.reminderStage;
  await extendLoanDueAt({ id: loan.id, newDueAt: newDue });
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "loan.extended",
    targetType: "gear",
    targetId: loan.itemId ?? loan.modelId,
    metadata: {
      loanId: loan.id,
      priorDueAt,
      newDueAt: newDue.epochMilliseconds,
      daysAdded: Math.round(
        (newDue.epochMilliseconds - priorDueAt) / (1000 * 60 * 60 * 24),
      ),
      // Both recorded whether or not an override happened, so "how often
      // is this used" is answerable from the audit page rather than by
      // inference from the dates.
      wasOverdue: alreadyOverdue,
      overrideOverdue,
      overrideReason: input.overrideReason ?? null,
      // The ladder is reset by `extendLoanDueAt`; recording where it was
      // means an unexplained silence afterwards is traceable.
      priorReminderStage,
    },
  });
  return { ok: true, dueAt: newDue.epochMilliseconds };
}

// ── officer reads ───────────────────────────────────────────────────────

export interface LoanDefaults {
  defaultLoanDays: number;
  /**
   * ISO weekday numbers (Mon = 1 … Sun = 7) the cave is open, parsed from
   * `gear.caveOpenDays`. Empty means none configured, which the desk reads
   * as "prefill the plain loan length".
   */
  caveOpenWeekdays: number[];
}

/**
 * The desk's prefill values.
 *
 * `gear:loan`-gated rather than added to the public settings snapshot:
 * loan length is officer-facing configuration, and the public subset is
 * a curated allowlist that exists so a setting can't become public by
 * being reclassified into the wrong category.
 *
 * Both values are *prefill inputs only* — nothing here is applied to a
 * submitted checkout. The wire format stays `durationDays`, and the server
 * stores exactly what the officer sent.
 */
export async function getLoanDefaultsAction(): Promise<LoanDefaults> {
  await requireGearLoanManager();
  const { readSetting } =
    await import("#/server/settings/settings-repo.server");
  const [defaultLoanDays, caveOpenDays] = await Promise.all([
    readSetting("gear.defaultLoanDays"),
    readSetting("gear.caveOpenDays"),
  ]);
  return {
    defaultLoanDays,
    // `readSetting` is fail-open and the registry's refinement IS
    // `parseWeekdayList`, so anything reaching here already parses — a
    // garbage row falls back to the schema default before we see it.
    // The `?? []` is therefore unreachable, and kept only because the
    // parser's signature can't say so. Do not read it as a fallback
    // policy: "no open days" is a real configuration (the summer), and
    // silently adopting it on a bad read would be a different answer
    // from the one the fail-open path already gives.
    caveOpenWeekdays: parseWeekdayList(caveOpenDays) ?? [],
  };
}

export interface ListLoansActionInput {
  tab?: "active" | "history";
  memberPublicId?: string;
  q?: string;
  overdueOnly?: boolean;
  sort?: LoanSortKey;
  dir?: LoanSortDirection;
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
    dir: input.dir,
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

export interface MyLoansResult {
  active: LoanSummary[];
  history: LoanSummary[];
  /** The member's own cave standing. Bundled with the loans rather than
   *  fetched separately because the page renders them together and the
   *  two would otherwise be able to disagree across a refetch — a banner
   *  saying "you're blocked" above a list showing nothing overdue. */
  standing: {
    standing: GearCaveStanding;
    worstDaysOverdue: number;
    flagAfterDays: number;
    blockAfterDays: number;
  };
}

export async function listMyLoansAction(): Promise<MyLoansResult> {
  const principal = await requireGearReader();
  const { active, history } = await listLoansForMember(principal.userId);
  const standing = await gearCaveStanding({
    memberUserId: principal.userId,
    now: Temporal.Now.instant(),
    timeZone: CLUB_TIME_ZONE,
  });
  return {
    active: active.map(toSummary),
    history: history.map(toSummary),
    standing: {
      standing: standing.standing,
      worstDaysOverdue: standing.worstDaysOverdue,
      flagAfterDays: standing.flagAfterDays,
      blockAfterDays: standing.blockAfterDays,
    },
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

export async function searchItemsByCodeAction(input: {
  q: string;
}): Promise<GearLookupRow[]> {
  await requireGearLoanManager();
  return searchItemsByCode(input.q);
}

export async function getItemByCodeAction(input: {
  code: string;
}): Promise<GearLookupRow | null> {
  await requireGearLoanManager();
  return getItemByCode(input.code);
}

// ── counted stock at the desk ───────────────────────────────────────────

/** A counted model as the desk offers it: identity plus how many can go
 *  out right now. `held` is surfaced separately so the row can say "4
 *  available · 6 held for a trip" instead of a bare 4. */
export interface DeskCountedModel {
  publicId: string;
  name: string;
  typeName: string;
  imageKey: string | null;
  /** Serviceable − out on loan − held. What a checkout without an
   *  override can take. */
  takeable: number;
  held: number;
}

async function withTakeable(
  rows: CountedDeskModelRow[],
): Promise<DeskCountedModel[]> {
  const terms = await countedStockTerms(
    rows.map((r) => r.modelId),
    Temporal.Now.instant(),
  );
  return rows.map((r) => {
    const t = terms.get(r.modelId) ?? NO_STOCK;
    return {
      publicId: r.publicId,
      name: r.name,
      typeName: r.typeName,
      imageKey: r.imageKey,
      takeable: Math.max(0, t.serviceable - t.onLoan - t.held),
      held: t.held,
    };
  });
}

export async function searchCountedModelsForDeskAction(input: {
  q: string;
}): Promise<DeskCountedModel[]> {
  await requireGearLoanManager();
  return withTakeable(await searchCountedModelsForDesk(input.q));
}

export type DeskModelLookupResult =
  | { ok: true; model: DeskCountedModel }
  | { ok: false; reason: "not_found" | "not_counted" };

/** What a scanned `ucmc-model:` bin label resolves to at checkout. */
export async function getDeskModelAction(input: {
  publicId: string;
}): Promise<DeskModelLookupResult> {
  await requireGearLoanManager();
  const row = await getDeskModelByPublicId(input.publicId);
  if (!row) return { ok: false, reason: "not_found" };
  // A bin label is only ever printed for a counted model, but a model
  // can flip back to coded after its label went on the bin. Say so
  // rather than offering a quantity the checkout will refuse.
  if (row.tracking !== "counted") return { ok: false, reason: "not_counted" };
  const model = (await withTakeable([row])).at(0);
  if (!model) return { ok: false, reason: "not_found" };
  return { ok: true, model };
}
