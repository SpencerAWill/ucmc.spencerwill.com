/**
 * Client-side CSV parser for the bulk pre-add sheet's "Import from CSV"
 * affordance. Wraps PapaParse so the bulk-add component just sees a
 * clean `{ rows, errors }` shape and the parsing details stay
 * testable in isolation.
 *
 * The CSV is officer-pasted from a roster spreadsheet (Google Sheets,
 * Excel, Numbers). Constraints:
 *
 *   - Two relevant columns: name + email. Other columns are ignored.
 *   - Header row optional. If present, columns are matched
 *     case-insensitively against `name`/`full name` and
 *     `email`/`email address`. Otherwise column order is assumed
 *     `name, email`.
 *   - Empty rows are skipped silently.
 *   - Rows missing either field, or with a malformed email, are
 *     reported in `errors` (with their 1-based line number) so the UI
 *     can render a "X imported, Y skipped" summary.
 *   - Tolerant of BOM, mixed CRLF/LF line endings, and quoted commas
 *     inside name fields ("Smith, Jr.") — the reasons we use PapaParse
 *     instead of hand-rolling.
 */
import Papa from "papaparse";

export interface ParsedUnclaimedRow {
  name: string;
  email: string;
}

export interface ParseUnclaimedCsvError {
  /** 1-based line number from the source file, including any header row. */
  line: number;
  message: string;
}

export interface ParseUnclaimedCsvResult {
  rows: ParsedUnclaimedRow[];
  errors: ParseUnclaimedCsvError[];
}

const NAME_HEADERS = new Set([
  "name",
  "full name",
  "fullname",
  "full_name",
  "member name",
]);
const EMAIL_HEADERS = new Set([
  "email",
  "email address",
  "emailaddress",
  "email_address",
  "e-mail",
]);

// Lightweight RFC-5322-ish check — same shape the server validates with
// zod. The server is the source of truth; this only exists to flag bad
// rows in the UI summary before the request goes out.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normaliseCell(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

interface DetectedColumns {
  nameIdx: number;
  emailIdx: number;
  hasHeader: boolean;
}

function detectColumns(firstRow: string[]): DetectedColumns {
  const lowered = firstRow.map((cell) => cell.trim().toLowerCase());
  let nameIdx = -1;
  let emailIdx = -1;
  for (let i = 0; i < lowered.length; i += 1) {
    if (nameIdx === -1 && NAME_HEADERS.has(lowered[i])) {
      nameIdx = i;
    } else if (emailIdx === -1 && EMAIL_HEADERS.has(lowered[i])) {
      emailIdx = i;
    }
  }
  if (nameIdx !== -1 && emailIdx !== -1) {
    return { nameIdx, emailIdx, hasHeader: true };
  }
  // No usable header: fall back to positional. If the first row's second
  // cell is an email, assume `name, email` order; if the first cell is
  // an email, swap. Otherwise default to `name, email` and let the
  // first row fall into the row-error bucket if it doesn't actually
  // contain an address.
  if (firstRow.length >= 2 && looksLikeEmail(firstRow[0].trim())) {
    return { nameIdx: 1, emailIdx: 0, hasHeader: false };
  }
  return { nameIdx: 0, emailIdx: 1, hasHeader: false };
}

export async function parseUnclaimedCsv(
  source: File | string,
): Promise<ParseUnclaimedCsvResult> {
  const text = typeof source === "string" ? source : await source.text();

  // PapaParse with `header: false` returns string[][] — we do header
  // detection ourselves so we can fall back to positional when no
  // recognized columns are present.
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
    // PapaParse's default `","` delimiter handles tab, semicolon, etc.
    // when `delimiter` is left unset and the auto-detector kicks in.
  });

  const rawRows: string[][] = parsed.data;
  const errors: ParseUnclaimedCsvError[] = [];

  if (rawRows.length === 0) {
    return { rows: [], errors };
  }

  const firstRow = rawRows[0];
  const { nameIdx, emailIdx, hasHeader } = detectColumns(firstRow);
  const dataStart = hasHeader ? 1 : 0;

  const rows: ParsedUnclaimedRow[] = [];
  for (let i = dataStart; i < rawRows.length; i += 1) {
    const row = rawRows[i];
    const lineNumber = i + 1; // 1-based, includes header line
    const name = normaliseCell(row[nameIdx]);
    const email = normaliseCell(row[emailIdx]).toLowerCase();
    if (name.length === 0 && email.length === 0) {
      continue; // genuinely empty row — silently skip
    }
    if (name.length === 0) {
      errors.push({ line: lineNumber, message: "Missing name" });
      continue;
    }
    if (email.length === 0) {
      errors.push({ line: lineNumber, message: "Missing email" });
      continue;
    }
    if (!looksLikeEmail(email)) {
      errors.push({
        line: lineNumber,
        message: `Invalid email: ${email}`,
      });
      continue;
    }
    rows.push({ name, email });
  }

  return { rows, errors };
}
