/**
 * Client-side CSV parser for the gear bulk-import sheet. Wraps PapaParse
 * so the bulk-import component sees a clean `{ rows, errors }` shape and
 * the parsing details stay testable in isolation.
 *
 * Supported columns (matched case-insensitively against the header row;
 * positional fallback if no header is detected):
 *
 *   - type           (required) — matches against either the type's name
 *                                  OR its prefix; case-insensitive
 *   - code           (optional) — freeform short identifier; left blank
 *                                  for unlabeled gear
 *   - description    (legacy) — read ONLY as a fallback product name
 *                                  for a sheet that predates the
 *                                  `model` column. Items carry no
 *                                  description of their own any more,
 *                                  so nothing is stored from it
 *   - acquired_at    (optional) — ISO date (YYYY-MM-DD); parsed to ms
 *   - cost / price / amount (optional) — **always interpreted as
 *                                  dollars**, integer or decimal. `60`
 *                                  and `60.00` both become 6000 cents.
 *                                  Non-numeric values flag the row.
 *   - manufacturer   (optional) — free-text brand
 *   - serial_number  (optional) — free-text serial
 *   - msrp / list_price (optional) — same always-dollars rule as `cost`
 *   - model / model_name (REQUIRED) — the product name. With the model
 *                                  layer, a row names its product and
 *                                  the import creates the model on
 *                                  demand; a CSV of forty draws lands
 *                                  on one model, not forty. A legacy
 *                                  sheet carrying only `description`
 *                                  still imports: that column becomes
 *                                  the model name, which is right for a
 *                                  pile of one-offs.
 *   - acquisition_kind (optional) — purchased|donated|found|
 *                                  warranty_replacement if present
 *   - tags           (optional) — comma-separated list of tag NAMES; the
 *                                  server resolves each to an existing
 *                                  tag (case-insensitive) and skips the
 *                                  whole row if any tag doesn't exist
 *
 * Rows whose `type` can't be resolved against the supplied
 * `typeLookup` map are surfaced as an error in `errors`; rows whose
 * type DOES match get their `typePublicId` filled in. The server is
 * the source of truth for code uniqueness AND tag-name resolution —
 * both are re-checked there.
 */
import Papa from "papaparse";

import type { GearAcquisitionKind } from "#/features/gear/server/gear-fns";

export interface ParsedGearRow {
  typePublicId: string;
  code: string | null;
  acquiredAt: number | null;
  acquisitionCostCents: number | null;
  msrpCents: number | null;
  manufacturer: string | null;
  serialNumber: string | null;
  modelName: string;
  acquisitionKind: GearAcquisitionKind | null;
  /** Tag names as written in the CSV. The server resolves these to
   *  IDs at import time. Empty array when the column is absent or
   *  blank for this row. */
  tagNames: string[];
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
// `model` is deliberately NOT a description alias any more: under the
// model layer it names the product, and reading it into both columns
// stamped the product name onto every item's distinguishing-marks
// field as well.
const DESCRIPTION_HEADERS = new Set(["description", "notes"]);
const ACQUIRED_AT_HEADERS = new Set([
  "acquired_at",
  "acquired at",
  "acquisition date",
  "acquired",
  "purchased",
  "date",
]);
const COST_HEADERS = new Set(["cost", "price", "amount"]);
const MSRP_HEADERS = new Set(["msrp", "list_price"]);
const MANUFACTURER_HEADERS = new Set(["manufacturer", "brand", "maker"]);
const SERIAL_HEADERS = new Set([
  "serial_number",
  "serial number",
  "serial",
  "serial_no",
]);
const MODEL_NAME_HEADERS = new Set([
  "model",
  "model_name",
  "model name",
  "product",
]);
// `status` is intentionally NOT an alias here — too generic, and it
// would collide with the item status column on other sheets.
const ACQUISITION_KIND_HEADERS = new Set([
  "acquisition_kind",
  "acquisition kind",
  "acquired_how",
  "source",
]);
const TAGS_HEADERS = new Set(["tags", "tag", "labels"]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const VALID_ACQUISITION_KINDS: readonly GearAcquisitionKind[] = [
  "purchased",
  "donated",
  "found",
  "warranty_replacement",
];

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

interface ColumnMap {
  type: number;
  code: number;
  description: number;
  acquiredAt: number;
  cost: number;
  msrp: number;
  manufacturer: number;
  serial: number;
  modelName: number;
  acquisitionKind: number;
  tags: number;
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
  const msrp = find(MSRP_HEADERS);
  const manufacturer = find(MANUFACTURER_HEADERS);
  const serial = find(SERIAL_HEADERS);
  const modelName = find(MODEL_NAME_HEADERS);
  const acquisitionKind = find(ACQUISITION_KIND_HEADERS);
  const tags = find(TAGS_HEADERS);
  if (type !== -1) {
    return {
      type,
      code,
      description,
      acquiredAt,
      cost,
      msrp,
      manufacturer,
      serial,
      modelName,
      acquisitionKind,
      tags,
      hasHeader: true,
    };
  }
  // Positional fallback: type, code, description, acquired_at, cost.
  // Only the original 5 columns are positional — extended fields
  // (manufacturer, msrp, etc.) are header-driven so sites that rely on
  // the positional fallback don't silently start picking up the wrong
  // cells if their sheet happens to have 6+ columns.
  return {
    type: 0,
    code: 1,
    description: 2,
    acquiredAt: 3,
    cost: 4,
    msrp: -1,
    manufacturer: -1,
    serial: -1,
    modelName: -1,
    acquisitionKind: -1,
    tags: -1,
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

function parseMoney(
  cell: string,
  label: string,
  line: number,
): {
  value: number | null;
  error?: string;
} {
  if (cell.length === 0) return { value: null };
  const cleaned = cell.replace(/[$,_\s]/g, "");
  if (cleaned.length === 0) return { value: null };
  // Always dollars, integer or decimal. `60` and `60.00` both become
  // 6000 cents. Officers reading from a spreadsheet think in dollars;
  // the old "integer = cents" heuristic was a footgun. Negatives are
  // rejected — the schema's z.number().int().min(0) would catch them
  // server-side, but failing here gives a per-line error message.
  const asNumber = Number(cleaned);
  if (!Number.isFinite(asNumber)) {
    return { value: null, error: `${label} is not a number (line ${line})` };
  }
  if (asNumber < 0) {
    return {
      value: null,
      error: `${label} must be non-negative (line ${line})`,
    };
  }
  return { value: Math.round(asNumber * 100) };
}

function parseAcquisitionKind(
  cell: string,
  line: number,
): {
  value: GearAcquisitionKind | null;
  error?: string;
} {
  if (cell.length === 0) return { value: null };
  const lower = cell.toLowerCase().replace(/[\s-]+/g, "_");
  const match = VALID_ACQUISITION_KINDS.find((k) => k === lower);
  if (!match) {
    return {
      value: null,
      error: `acquisition_kind must be purchased|donated|found|warranty_replacement (line ${line})`,
    };
  }
  return { value: match };
}

function parseTags(cell: string): string[] {
  if (cell.length === 0) return [];
  return cell
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
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
    const acquiredAtCell =
      cols.acquiredAt === -1 ? "" : normalize(row[cols.acquiredAt]);
    const costCell = cols.cost === -1 ? "" : normalize(row[cols.cost]);
    const msrpCell = cols.msrp === -1 ? "" : normalize(row[cols.msrp]);
    const manufacturerCell =
      cols.manufacturer === -1 ? "" : normalize(row[cols.manufacturer]);
    const serialCell = cols.serial === -1 ? "" : normalize(row[cols.serial]);
    const modelNameCell =
      cols.modelName === -1 ? "" : normalize(row[cols.modelName]);
    const acquisitionKindCell =
      cols.acquisitionKind === -1 ? "" : normalize(row[cols.acquisitionKind]);
    const tagsCell = cols.tags === -1 ? "" : normalize(row[cols.tags]);
    const acquired = parseAcquiredAt(acquiredAtCell, line);
    if (acquired.error) errors.push({ line, message: acquired.error });
    const cost = parseMoney(costCell, "cost", line);
    if (cost.error) errors.push({ line, message: cost.error });
    const msrp = parseMoney(msrpCell, "msrp", line);
    if (msrp.error) errors.push({ line, message: msrp.error });
    const acquisitionKind = parseAcquisitionKind(acquisitionKindCell, line);
    if (acquisitionKind.error) {
      errors.push({ line, message: acquisitionKind.error });
    }
    // The model name is what the import groups items under. Falling
    // back to the legacy `description` column keeps single-column
    // sheets importable: each distinct value becomes its own model,
    // which is exactly right for a pile of one-offs and harmless for a
    // fleet the officer can merge afterwards. Nothing else is read from
    // that column — items no longer store text of their own.
    const modelName = modelNameCell.length > 0 ? modelNameCell : description;
    // What a row cannot go without: it has to land on some product.
    if (modelName.length === 0) {
      errors.push({ line, message: "Missing model" });
      continue;
    }
    rows.push({
      typePublicId,
      code: code.length === 0 ? null : code,
      acquiredAt: acquired.value,
      acquisitionCostCents: cost.value,
      msrpCents: msrp.value,
      manufacturer: manufacturerCell.length === 0 ? null : manufacturerCell,
      serialNumber: serialCell.length === 0 ? null : serialCell,
      modelName,
      acquisitionKind: acquisitionKind.value,
      tagNames: parseTags(tagsCell),
    });
  }
  return { rows, errors };
}
