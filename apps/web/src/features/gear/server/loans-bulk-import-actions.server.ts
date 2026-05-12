/**
 * Bulk backfill of historical gear loans. Officers use this to migrate
 * a paper logbook (or a spreadsheet from a prior tool) into the
 * platform after the fact. Distinct from `checkoutLoansAction` /
 * `checkinLoansAction` in three ways:
 *
 *   1. Per-row member resolution by primary email, gear resolution by
 *      laminated `code`. Real-time checkout uses publicIds, but a
 *      paper-logbook CSV won't carry those.
 *   2. Eligibility checks (gear.lifecycle, gear.condition) are
 *      relaxed. A piece that's retired TODAY may have been serviceable
 *      when loaned years ago. The historical fact still records.
 *   3. Already-returned rows (CSV's `returned_at` is set) close the
 *      loan in the same insert — no follow-up check-in is needed.
 *      Open backfill rows are still subject to the
 *      `gear_loans_one_active_per_gear` partial unique index, which
 *      surfaces as a per-row `already_on_loan` skip.
 *
 * Inserts run sequentially because audit emission is one event per
 * row and we want the same per-row skip surfacing as
 * `bulkImportGearAction` — a single batch failure on row 7 would
 * roll back the first 6 too. The zod schema caps batches at 500 rows
 * (mirrored by the sheet's `MAX_ROWS`); per-row round-trips are fine
 * at that scale for a one-time backfill flow.
 *
 * **Audit emission is per-row and not in the same transaction as the
 * loan insert.** Same trade-off as the gear bulk import — accept the
 * theoretical missed audit row over the complexity of batching audit
 * + insert at unbounded scale.
 */
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { computeDueAt } from "#/features/gear/lib/loan-duration";
import {
  insertLoans,
  lookupBackfillGearByCode,
  lookupBackfillMemberByEmail,
  getOpenLoanForGear,
} from "#/features/gear/server/loans-repo.server";
import { requireGearLoanManager } from "#/features/gear/server/permissions.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { normalizeEmail } from "#/server/auth/email-normalize";
import { generatePublicId } from "#/server/auth/ids";
import { getDb, isUniqueViolation, schema } from "#/server/db";

export interface BulkImportLoanRow {
  memberEmail: string;
  gearCode: string;
  /** ISO date `YYYY-MM-DD`. Required. */
  checkedOutAt: string;
  /** ISO date `YYYY-MM-DD`. Defaults at the server to
   *  `checkedOutAt + DEFAULT_LOAN_DURATION_DAYS` (7) if absent. */
  dueAt: string | null;
  /** ISO date `YYYY-MM-DD`. When non-null, the row records a closed
   *  loan; the action sets `returnedAt`, `returnedToUserId`, optional
   *  `conditionAtReturn`, and `checkinNotes` in the same insert. */
  returnedAt: string | null;
  conditionAtReturn: schema.GearCondition | null;
  checkoutNotes: string | null;
  checkinNotes: string | null;
}

export interface BulkImportLoansInput {
  rows: BulkImportLoanRow[];
}

export interface BulkImportLoanCreated {
  rowIndex: number;
  loanPublicId: string;
  gearCode: string;
  memberEmail: string;
  /** `true` when the row also closed the loan in the same insert. */
  alreadyReturned: boolean;
}

export type BulkImportLoanSkipReason =
  | "member_not_found"
  | "gear_not_found"
  | "already_on_loan"
  | "invalid_dates"
  | "duplicate_in_import";

export interface BulkImportLoanSkipped {
  rowIndex: number;
  reason: BulkImportLoanSkipReason;
  memberEmail: string;
  gearCode: string;
}

export interface BulkImportLoansResult {
  created: BulkImportLoanCreated[];
  skipped: BulkImportLoanSkipped[];
}

function parseIso(date: string): Date | null {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

export async function bulkImportLoansAction(
  input: BulkImportLoansInput,
): Promise<BulkImportLoansResult> {
  const principal = await requireGearLoanManager();
  const created: BulkImportLoanCreated[] = [];
  const skipped: BulkImportLoanSkipped[] = [];

  // Per-import dedupe set: two OPEN backfill rows on the same gear in
  // one import would race against the partial unique index. Catch it
  // before sending the second insert so the officer sees a clear
  // `duplicate_in_import` reason rather than the generic
  // `already_on_loan` race-loser surface.
  const seenOpenGearIds = new Set<string>();

  // Small per-call caches. Officers re-import the same member or gear
  // across many rows; caching avoids re-querying.
  const memberCache = new Map<
    string,
    Awaited<ReturnType<typeof lookupBackfillMemberByEmail>>
  >();
  const gearCache = new Map<
    string,
    Awaited<ReturnType<typeof lookupBackfillGearByCode>>
  >();

  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i];
    const normalizedEmail = normalizeEmail(row.memberEmail);
    const trimmedCode = row.gearCode.trim();

    let member = memberCache.get(normalizedEmail);
    if (member === undefined) {
      member = await lookupBackfillMemberByEmail(normalizedEmail);
      memberCache.set(normalizedEmail, member);
    }
    if (!member) {
      skipped.push({
        rowIndex: i,
        reason: "member_not_found",
        memberEmail: row.memberEmail,
        gearCode: row.gearCode,
      });
      continue;
    }

    let gear = gearCache.get(trimmedCode);
    if (gear === undefined) {
      gear = await lookupBackfillGearByCode(trimmedCode);
      gearCache.set(trimmedCode, gear);
    }
    if (!gear) {
      skipped.push({
        rowIndex: i,
        reason: "gear_not_found",
        memberEmail: row.memberEmail,
        gearCode: row.gearCode,
      });
      continue;
    }

    const checkedOutAt = parseIso(row.checkedOutAt);
    if (!checkedOutAt) {
      skipped.push({
        rowIndex: i,
        reason: "invalid_dates",
        memberEmail: row.memberEmail,
        gearCode: row.gearCode,
      });
      continue;
    }
    const dueAt =
      row.dueAt === null ? computeDueAt(checkedOutAt, 7) : parseIso(row.dueAt);
    const returnedAt =
      row.returnedAt === null ? null : parseIso(row.returnedAt);
    if (
      dueAt === null ||
      (row.returnedAt !== null && returnedAt === null) ||
      dueAt.getTime() < checkedOutAt.getTime() ||
      (returnedAt !== null && returnedAt.getTime() < checkedOutAt.getTime())
    ) {
      skipped.push({
        rowIndex: i,
        reason: "invalid_dates",
        memberEmail: row.memberEmail,
        gearCode: row.gearCode,
      });
      continue;
    }

    // Per-import dedupe for OPEN rows on the same gear.
    if (returnedAt === null) {
      if (seenOpenGearIds.has(gear.id)) {
        skipped.push({
          rowIndex: i,
          reason: "duplicate_in_import",
          memberEmail: row.memberEmail,
          gearCode: row.gearCode,
        });
        continue;
      }
      // Cross-batch dedupe: a real open loan already in the DB (either
      // pre-existing, or from a prior row in THIS import that already
      // landed) blocks adding another open one. Returned rows skip
      // this check — they don't touch the partial unique index.
      const existingOpen = await getOpenLoanForGear(gear.id);
      if (existingOpen) {
        skipped.push({
          rowIndex: i,
          reason: "already_on_loan",
          memberEmail: row.memberEmail,
          gearCode: row.gearCode,
        });
        continue;
      }
      seenOpenGearIds.add(gear.id);
    }

    const loanId = `gl_${uuidv7()}`;
    const loanPublicId = generatePublicId();
    try {
      await insertLoans([
        {
          id: loanId,
          publicId: loanPublicId,
          gearId: gear.id,
          memberUserId: member.userId,
          checkedOutByUserId: principal.userId,
          checkedOutAt,
          dueAt,
          checkoutNotes: row.checkoutNotes,
        },
      ]);
    } catch (err) {
      // Race against the partial unique index — surfaces only on open
      // rows. Same skip reason as the pre-check above.
      if (isUniqueViolation(err)) {
        skipped.push({
          rowIndex: i,
          reason: "already_on_loan",
          memberEmail: row.memberEmail,
          gearCode: row.gearCode,
        });
        seenOpenGearIds.delete(gear.id);
        continue;
      }
      throw err;
    }

    // For pre-returned rows, close the loan in a follow-up UPDATE.
    // Doing this after the insert keeps `insertLoans` consumers
    // (real-time checkout) free of the optional close-out columns and
    // lets the partial unique index keep its straightforward shape.
    if (returnedAt !== null) {
      await getDb()
        .update(schema.gearLoans)
        .set({
          returnedAt,
          returnedToUserId: principal.userId,
          checkinNotes: row.checkinNotes,
          conditionAtReturn: row.conditionAtReturn,
        })
        .where(eq(schema.gearLoans.id, loanId));
    }

    // Audit chain: always emit `loan.checked_out`. For pre-returned
    // rows, also emit `loan.checked_in` so the audit log reflects the
    // full lifecycle the way it would for real-time flows.
    await recordAuditEvent({
      actorUserId: principal.userId,
      action: "loan.checked_out",
      targetType: "gear",
      targetId: gear.id,
      metadata: {
        memberUserId: member.userId,
        gearId: gear.id,
        dueAt: dueAt.getTime(),
        code: gear.code,
        bulk: true,
        backfill: true,
        checkedOutAt: checkedOutAt.getTime(),
      },
    });
    if (returnedAt !== null) {
      await recordAuditEvent({
        actorUserId: principal.userId,
        action: "loan.checked_in",
        targetType: "gear",
        targetId: gear.id,
        metadata: {
          memberUserId: member.userId,
          gearId: gear.id,
          code: gear.code,
          conditionAtReturn: row.conditionAtReturn,
          bulk: true,
          backfill: true,
          returnedAt: returnedAt.getTime(),
        },
      });
    }

    created.push({
      rowIndex: i,
      loanPublicId,
      gearCode: gear.code,
      memberEmail: row.memberEmail,
      alreadyReturned: returnedAt !== null,
    });
  }

  return { created, skipped };
}
