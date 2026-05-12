/**
 * Client-side CSV parser for the gear bulk-import sheet. Wraps PapaParse
 * so the bulk-import component sees a clean `{ rows, errors }` shape and
 * the parsing details stay testable in isolation.
 *
 * Supported columns (matched case-insensitively against the header row;
 * positional fallback if no header is detected):
 *
 *   - type     (required) — matches against either the type's name OR
 *                            its prefix, in that order; case-insensitive
 *   - code     (optional) — freeform short identifier; left blank for
 *                            unlabeled gear
 *   - description (required) — primary heading on the gear card
 *   - acquired_at (optional) — ISO date (YYYY-MM-DD); parsed to ms
 *   - cost_cents (optional) — integer; non-numeric values flag the row
 *
 * Rows whose `type` can't be resolved against the supplied
 * `typeLookup` map are surfaced as an error in `errors`; rows whose
 * type DOES match get their `typePublicId` filled in. The server is
 * the source of truth for code uniqueness — duplicates are caught
 * there.
 */
import Papa from "papaparse";

export interface ParsedGearRow {
  typePublicId: string;
  code: string | null;
  description: string;
  acquiredAt: number | null;
  acquisitionCostCents: number | null;
}

export interface ParseGearCsvError {
  /** 1-based line number from the source file, including any header row. */
  line: number;
  message: string;
}

export interface ParseGearCsvResult {
  rows: ParsedGearRow[];
  errors: ParseGearCsvError[];
}

export interface GearTypeLookupEntry {
  publicId: string;
  name: string;
  prefix: string | null;
}

const TYPE_HEADERS = new Set(["type", "gear type", "kind"]);
const CODE_HEADERS = new Set(["code", "short id", "short_id", "id", "tag"]);
const DESCRIPTION_HEADERS = new Set(["description", "model", "notes"]);
const ACQUIRED_AT_HEADERS = new Set([
  "acquired_at",
  "acquired at",
  "acquisition date",
  "acquired",
  "purchased",
  "date",
]);
const COST_HEADERS = new Set([
  "cost",
  "cost_cents",
  "cost cents",
  "price",
  "amount",
]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

interface ColumnMap {
  type: number;
  code: number;
  description: number;
  acquiredAt: number;
  cost: number;
  hasHeader: boolean;
}

function detectColumns(firstRow: string[]): ColumnMap {
  const lowered = firstRow.map((c) => c.trim().toLowerCase());
  const find = (set: Set<string>) => lowered.findIndex((cell) => set.has(cell));
  const type = find(TYPE_HEADERS);
  const code = find(CODE_HEADERS);
  const description = find(DESCRIPTION_HEADERS);
  const acquiredAt = find(ACQUIRED_AT_HEADERS);
  const cost = find(COST_HEADERS);
  if (type !== -1) {
    return {
      type,
      code,
      description,
      acquiredAt,
      cost,
      hasHeader: true,
    };
  }
  // Positional fallback: type, code, description, acquired_at, cost_cents.
  return {
    type: 0,
    code: 1,
    description: 2,
    acquiredAt: 3,
    cost: 4,
    hasHeader: false,
  };
}

function resolveType(
  cell: string,
  lookup: Map<string, GearTypeLookupEntry>,
): string | null {
  const lower = cell.trim().toLowerCase();
  if (lower.length === 0) return null;
  return lookup.get(lower)?.publicId ?? null;
}

function buildLookup(
  types: GearTypeLookupEntry[],
): Map<string, GearTypeLookupEntry> {
  // Index by lowercased name AND lowercased prefix so officers can write
  // either "Climbing Harness" or "CH" in the CSV's type column.
  const map = new Map<string, GearTypeLookupEntry>();
  for (const t of types) {
    map.set(t.name.toLowerCase(), t);
    if (t.prefix && t.prefix.trim().length > 0) {
      map.set(t.prefix.toLowerCase(), t);
    }
  }
  return map;
}

function parseAcquiredAt(
  cell: string,
  line: number,
): {
  value: number | null;
  error?: string;
} {
  if (cell.length === 0) return { value: null };
  if (!ISO_DATE_RE.test(cell)) {
    return {
      value: null,
      error: `acquired_at must be YYYY-MM-DD (line ${line})`,
    };
  }
  const ms = Date.parse(`${cell}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    return {
      value: null,
      error: `acquired_at not a valid date (line ${line})`,
    };
  }
  return { value: ms };
}

function parseCost(
  cell: string,
  line: number,
): {
  value: number | null;
  error?: string;
} {
  if (cell.length === 0) return { value: null };
  const cleaned = cell.replace(/[$,_\s]/g, "");
  if (cleaned.length === 0) return { value: null };
  // Accept either dollar amounts (with optional decimal) or raw cents.
  // The header set distinguishes "cost" / "price" (dollars) from
  // "cost_cents" / "amount" (cents). Keep it lenient — multiply by 100
  // if the value has a decimal point regardless.
  const asNumber = Number(cleaned);
  if (!Number.isFinite(asNumber)) {
    return { value: null, error: `cost is not a number (line ${line})` };
  }
  if (cleaned.includes(".")) {
    return { value: Math.round(asNumber * 100) };
  }
  return { value: Math.round(asNumber) };
}

export async function parseGearCsv(
  source: File | string,
  types: GearTypeLookupEntry[],
): Promise<ParseGearCsvResult> {
  const text = typeof source === "string" ? source : await source.text();
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const lookup = buildLookup(types);
  const errors: ParseGearCsvError[] = [];
  const rows: ParsedGearRow[] = [];
  if (parsed.data.length === 0) {
    return { rows, errors };
  }
  const cols = detectColumns(parsed.data[0]);
  const dataStart = cols.hasHeader ? 1 : 0;
  for (let i = dataStart; i < parsed.data.length; i += 1) {
    const row = parsed.data[i] ?? [];
    const line = i + 1;
    const typeCell = normalize(row[cols.type]);
    if (typeCell.length === 0) {
      errors.push({ line, message: "Missing type" });
      continue;
    }
    const typePublicId = resolveType(typeCell, lookup);
    if (typePublicId === null) {
      errors.push({
        line,
        message: `Unknown type: ${typeCell}`,
      });
      continue;
    }
    const code = cols.code === -1 ? "" : normalize(row[cols.code]);
    const description =
      cols.description === -1 ? "" : normalize(row[cols.description]);
    if (description.length === 0) {
      errors.push({ line, message: "Missing description" });
      continue;
    }
    const acquiredAtCell =
      cols.acquiredAt === -1 ? "" : normalize(row[cols.acquiredAt]);
    const costCell = cols.cost === -1 ? "" : normalize(row[cols.cost]);
    const acquired = parseAcquiredAt(acquiredAtCell, line);
    if (acquired.error) errors.push({ line, message: acquired.error });
    const cost = parseCost(costCell, line);
    if (cost.error) errors.push({ line, message: cost.error });
    rows.push({
      typePublicId,
      code: code.length === 0 ? null : code,
      description,
      acquiredAt: acquired.value,
      acquisitionCostCents: cost.value,
    });
  }
  return { rows, errors };
}
