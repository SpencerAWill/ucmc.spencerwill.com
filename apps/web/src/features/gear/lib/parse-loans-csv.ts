/**
 * Client-side CSV parser for the loan-backfill sheet. Mirrors the
 * structure of `parse-gear-csv.ts` — `Papa.parse` + flexible header
 * detection with a positional fallback — but resolves loans rather
 * than gear pieces.
 *
 * Supported columns (matched case-insensitively against the header
 * row; positional fallback if no header is detected):
 *
 *   - member_email (required) — primary email of the borrower
 *   - gear_code    (required) — laminated tag code (e.g. CH1)
 *   - checked_out_at (required) — ISO date YYYY-MM-DD
 *   - due_at      (optional) — ISO date YYYY-MM-DD; defaults at the
 *                              server to checked_out_at + 7 days
 *   - returned_at (optional) — ISO date YYYY-MM-DD; if present the
 *                              loan is recorded as already closed
 *   - condition_at_return (optional) — only honored if returned_at
 *                              is present; one of the GearCondition
 *                              enum values
 *   - checkout_notes (optional)
 *   - checkin_notes  (optional) — only honored if returned_at present
 *
 * The server is the source of truth for cross-row constraints
 * (members existing, gear existing, the partial unique index on
 * open loans). The parser only catches type-level / date-shape
 * errors here so the preview can render them without a round-trip.
 */
import Papa from "papaparse";

export type ParsedLoanCondition =
  | "serviceable"
  | "needs_repair"
  | "missing"
  | "lost";

export interface ParsedLoanRow {
  memberEmail: string;
  gearCode: string;
  /** ISO `YYYY-MM-DD`. */
  checkedOutAt: string;
  /** ISO `YYYY-MM-DD` or null. */
  dueAt: string | null;
  /** ISO `YYYY-MM-DD` or null. When non-null the row is a closed loan. */
  returnedAt: string | null;
  conditionAtReturn: ParsedLoanCondition | null;
  checkoutNotes: string | null;
  checkinNotes: string | null;
}

export interface ParseLoansCsvError {
  /** 1-based line number from the source file, including any header row. */
  line: number;
  message: string;
}

export interface ParseLoansCsvResult {
  rows: ParsedLoanRow[];
  errors: ParseLoansCsvError[];
}

const MEMBER_EMAIL_HEADERS = new Set([
  "member_email",
  "member email",
  "email",
  "borrower_email",
  "borrower email",
  "borrower",
]);
const GEAR_CODE_HEADERS = new Set([
  "gear_code",
  "gear code",
  "code",
  "tag",
  "asset",
  "asset_code",
]);
const CHECKED_OUT_HEADERS = new Set([
  "checked_out_at",
  "checked out at",
  "checkout",
  "checked_out",
  "checked out",
  "issued",
  "issued_at",
  "loaned_at",
  "out",
]);
const DUE_HEADERS = new Set([
  "due_at",
  "due at",
  "due",
  "due_date",
  "due date",
]);
const RETURNED_HEADERS = new Set([
  "returned_at",
  "returned at",
  "returned",
  "return",
  "return_date",
  "return date",
  "in",
]);
const CONDITION_HEADERS = new Set([
  "condition_at_return",
  "condition at return",
  "condition",
  "return_condition",
  "return condition",
]);
const CHECKOUT_NOTES_HEADERS = new Set([
  "checkout_notes",
  "checkout notes",
  "out_notes",
  "out notes",
  "notes",
]);
const CHECKIN_NOTES_HEADERS = new Set([
  "checkin_notes",
  "checkin notes",
  "check_in_notes",
  "check-in notes",
  "in_notes",
  "in notes",
  "return_notes",
  "return notes",
]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_CONDITIONS = new Set<ParsedLoanCondition>([
  "serviceable",
  "needs_repair",
  "missing",
  "lost",
]);

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

interface ColumnMap {
  memberEmail: number;
  gearCode: number;
  checkedOutAt: number;
  dueAt: number;
  returnedAt: number;
  condition: number;
  checkoutNotes: number;
  checkinNotes: number;
  hasHeader: boolean;
}

function detectColumns(firstRow: string[]): ColumnMap {
  const lowered = firstRow.map((c) => c.trim().toLowerCase());
  const find = (set: Set<string>) => lowered.findIndex((cell) => set.has(cell));
  const memberEmail = find(MEMBER_EMAIL_HEADERS);
  const gearCode = find(GEAR_CODE_HEADERS);
  const checkedOutAt = find(CHECKED_OUT_HEADERS);
  const dueAt = find(DUE_HEADERS);
  const returnedAt = find(RETURNED_HEADERS);
  const condition = find(CONDITION_HEADERS);
  const checkoutNotes = find(CHECKOUT_NOTES_HEADERS);
  const checkinNotes = find(CHECKIN_NOTES_HEADERS);
  // Treat any of the three required-ish headers as a positive header
  // signal. If none match, fall through to positional ordering.
  if (memberEmail !== -1 || gearCode !== -1 || checkedOutAt !== -1) {
    return {
      memberEmail,
      gearCode,
      checkedOutAt,
      dueAt,
      returnedAt,
      condition,
      checkoutNotes,
      checkinNotes,
      hasHeader: true,
    };
  }
  return {
    memberEmail: 0,
    gearCode: 1,
    checkedOutAt: 2,
    dueAt: 3,
    returnedAt: 4,
    condition: 5,
    checkoutNotes: 6,
    checkinNotes: 7,
    hasHeader: false,
  };
}

function parseIsoDate(
  cell: string,
  line: number,
  fieldLabel: string,
): { value: string | null; error?: string } {
  if (cell.length === 0) return { value: null };
  if (!ISO_DATE_RE.test(cell)) {
    return {
      value: null,
      error: `${fieldLabel} must be YYYY-MM-DD (line ${line})`,
    };
  }
  const ms = Date.parse(`${cell}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    return {
      value: null,
      error: `${fieldLabel} isn't a valid date (line ${line})`,
    };
  }
  return { value: cell };
}

function parseCondition(
  cell: string,
  line: number,
): { value: ParsedLoanCondition | null; error?: string } {
  if (cell.length === 0) return { value: null };
  const lower = cell.toLowerCase().replace(/[\s-]+/g, "_");
  if (VALID_CONDITIONS.has(lower as ParsedLoanCondition)) {
    return { value: lower as ParsedLoanCondition };
  }
  return {
    value: null,
    error: `condition_at_return must be one of serviceable, needs_repair, missing, lost (line ${line})`,
  };
}

export async function parseLoansCsv(
  source: File | string,
): Promise<ParseLoansCsvResult> {
  const text = typeof source === "string" ? source : await source.text();
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const errors: ParseLoansCsvError[] = [];
  const rows: ParsedLoanRow[] = [];
  if (parsed.data.length === 0) {
    return { rows, errors };
  }
  const cols = detectColumns(parsed.data[0]);
  const dataStart = cols.hasHeader ? 1 : 0;
  for (let i = dataStart; i < parsed.data.length; i += 1) {
    const row = parsed.data[i] ?? [];
    const line = i + 1;
    const memberEmail =
      cols.memberEmail === -1 ? "" : normalize(row[cols.memberEmail]);
    const gearCode = cols.gearCode === -1 ? "" : normalize(row[cols.gearCode]);
    const checkedOutCell =
      cols.checkedOutAt === -1 ? "" : normalize(row[cols.checkedOutAt]);

    if (memberEmail.length === 0) {
      errors.push({ line, message: "Missing member_email" });
      continue;
    }
    if (!EMAIL_RE.test(memberEmail)) {
      errors.push({
        line,
        message: `member_email isn't a valid address: ${memberEmail}`,
      });
      continue;
    }
    if (gearCode.length === 0) {
      errors.push({ line, message: "Missing gear_code" });
      continue;
    }
    if (checkedOutCell.length === 0) {
      errors.push({ line, message: "Missing checked_out_at" });
      continue;
    }

    const checkedOut = parseIsoDate(checkedOutCell, line, "checked_out_at");
    if (checkedOut.error || checkedOut.value === null) {
      errors.push({
        line,
        message:
          checkedOut.error ??
          `checked_out_at isn't a valid date (line ${line})`,
      });
      continue;
    }

    const dueCell = cols.dueAt === -1 ? "" : normalize(row[cols.dueAt]);
    const due = parseIsoDate(dueCell, line, "due_at");
    if (due.error) {
      errors.push({ line, message: due.error });
      continue;
    }
    const returnedCell =
      cols.returnedAt === -1 ? "" : normalize(row[cols.returnedAt]);
    const returned = parseIsoDate(returnedCell, line, "returned_at");
    if (returned.error) {
      errors.push({ line, message: returned.error });
      continue;
    }

    // Date-ordering sanity. Cheaper to catch client-side than at the
    // server, where the error would come back per-row inside the
    // result skip list.
    if (due.value !== null && due.value < checkedOut.value) {
      errors.push({
        line,
        message: `due_at is before checked_out_at (line ${line})`,
      });
      continue;
    }
    if (returned.value !== null && returned.value < checkedOut.value) {
      errors.push({
        line,
        message: `returned_at is before checked_out_at (line ${line})`,
      });
      continue;
    }

    const conditionCell =
      cols.condition === -1 ? "" : normalize(row[cols.condition]);
    const condition = parseCondition(conditionCell, line);
    if (condition.error) {
      errors.push({ line, message: condition.error });
      continue;
    }
    // condition_at_return only makes sense for closed loans. Silently
    // ignoring it on open rows would be sneaky; surface it as an error
    // so the officer notices the mis-mapped CSV.
    if (condition.value !== null && returned.value === null) {
      errors.push({
        line,
        message: `condition_at_return only applies to returned rows (line ${line})`,
      });
      continue;
    }

    const checkoutNotes =
      cols.checkoutNotes === -1 ? "" : normalize(row[cols.checkoutNotes]);
    const checkinNotes =
      cols.checkinNotes === -1 ? "" : normalize(row[cols.checkinNotes]);
    if (checkinNotes.length > 0 && returned.value === null) {
      errors.push({
        line,
        message: `checkin_notes only applies to returned rows (line ${line})`,
      });
      continue;
    }

    rows.push({
      memberEmail,
      gearCode,
      checkedOutAt: checkedOut.value,
      dueAt: due.value,
      returnedAt: returned.value,
      conditionAtReturn: condition.value,
      checkoutNotes: checkoutNotes.length === 0 ? null : checkoutNotes,
      checkinNotes: checkinNotes.length === 0 ? null : checkinNotes,
    });
  }
  return { rows, errors };
}
