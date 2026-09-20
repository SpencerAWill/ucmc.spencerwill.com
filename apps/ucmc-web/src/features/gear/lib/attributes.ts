/**
 * Officer-defined attributes — the replacement for the old `size`
 * column, and before that the proposed `variant`.
 *
 * The lesson from both is that the cave's vocabulary is not ours to
 * guess: a harness has a size, a rope has a diameter and a length, a
 * stove has a fuel type, and a numbered column for each is a migration
 * per question anybody thinks to ask. Definitions are rows, so adding
 * "fuel type" is a form, not a deploy.
 *
 * Two levels, which is what keeps the data honest rather than merely
 * flexible:
 *
 *   - `model` — true of every unit of a model. Rope diameter is typed
 *     once for a fleet of forty.
 *   - `item` — varies unit to unit. Harness size is the reason this
 *     level exists at all.
 *
 * A counted model has no item rows, so only model-level values can
 * exist for it. That falls out of the shape and needs no rule.
 *
 * Pure and client-safe: the forms, the facets and the detail card all
 * read the same coercion and formatting rules, so a value written by
 * one surface reads back identically in the others.
 */
import type {
  GearAttributeKind,
  GearAttributeLevel,
} from "#/features/gear/server/gear-fns";

/**
 * A definition as every read path sees it. `typePublicIds` is the join
 * flattened in — a def attached to no type is defined but dormant, and
 * the manage UI says so rather than hiding it.
 */
export interface GearAttributeDefSummary {
  publicId: string;
  key: string;
  label: string;
  kind: GearAttributeKind;
  level: GearAttributeLevel;
  /** `select` only, **in display order**. Sorting sizes alphabetically
   *  yields L, M, S, XL, which reads as a bug. */
  options: string[] | null;
  /** `number` only — "m", "mm", "g". On the definition, never in the
   *  value: a value of "60m" is text and stops being range-filterable. */
  unit: string | null;
  required: boolean;
  position: number;
  /** Soft-deleted. Values survive, and the manage UI can offer it back. */
  archived: boolean;
  typePublicIds: string[];
}

/**
 * One answer. Carries enough of its definition to render standalone —
 * the detail card would otherwise need the whole def list to print
 * "Diameter 9.8 mm".
 */
export interface GearAttributeValueDto {
  defPublicId: string;
  key: string;
  label: string;
  kind: GearAttributeKind;
  unit: string | null;
  text: string | null;
  number: number | null;
}

/** What a form submits: the raw string a control produced, or `null`
 *  for "cleared". Coercion to columns happens once, here. */
export interface GearAttributeValueInput {
  defPublicId: string;
  value: string | null;
}

export type CoercedAttributeValue =
  | { ok: true; text: string | null; number: number | null }
  | { ok: false; reason: "required" | "not_a_number" | "not_an_option" };

/**
 * The single place a submitted string becomes the two storage columns.
 *
 * Numbers land in `value_number` so range filters and sorting work;
 * everything else lands in `value_text`. Booleans are the odd one out:
 * they go to `value_number` as 0/1, matching how every other boolean in
 * the schema is stored, at the cost of the boolean facet reading the
 * numeric column.
 */
export function coerceAttributeValue(
  def: Pick<GearAttributeDefSummary, "kind" | "options" | "required">,
  raw: string | null,
): CoercedAttributeValue {
  const trimmed = raw?.trim() ?? "";
  if (trimmed.length === 0) {
    if (def.required) {
      return { ok: false, reason: "required" };
    }
    return { ok: true, text: null, number: null };
  }
  switch (def.kind) {
    case "number": {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        return { ok: false, reason: "not_a_number" };
      }
      return { ok: true, text: null, number: n };
    }
    case "boolean":
      return {
        ok: true,
        text: null,
        number: trimmed === "true" || trimmed === "1" ? 1 : 0,
      };
    case "select":
      if (!def.options?.includes(trimmed)) {
        return { ok: false, reason: "not_an_option" };
      }
      return { ok: true, text: trimmed, number: null };
    case "text":
      return { ok: true, text: trimmed, number: null };
  }
}

/** Display string for a stored value, unit included. `null` means the
 *  attribute is simply unanswered, which is not an error. */
export function formatAttributeValue(
  value: Pick<GearAttributeValueDto, "kind" | "unit" | "text" | "number">,
): string | null {
  switch (value.kind) {
    case "number":
      if (value.number === null) return null;
      return value.unit ? `${value.number} ${value.unit}` : `${value.number}`;
    case "boolean":
      if (value.number === null) return null;
      return value.number === 1 ? "Yes" : "No";
    case "select":
    case "text":
      return value.text && value.text.length > 0 ? value.text : null;
  }
}

/** The value a form control should start with, inverting the coercion
 *  above so an edit round-trips without changing what is stored. */
export function attributeValueToFormValue(
  value: Pick<GearAttributeValueDto, "kind" | "text" | "number">,
): string {
  switch (value.kind) {
    case "number":
      return value.number === null ? "" : String(value.number);
    case "boolean":
      return value.number === null ? "" : value.number === 1 ? "true" : "false";
    case "select":
    case "text":
      return value.text ?? "";
  }
}

/**
 * Machine key from a label: "Rope diameter" → "rope_diameter". Keys are
 * globally unique and permanent, so they are derived once at create
 * time and never re-derived from a later relabel — renaming "Size" to
 * "Harness size" must not orphan every value answering it.
 */
export function attributeKeyFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Facet selections in the URL, as repeated `attr=<defPublicId>:<value>`
 * params.
 *
 * One flat repeated param rather than a nested object because that is
 * what survives a copied link, a browser Back, and TanStack Router's
 * search serialization without a custom codec. The separator is a colon
 * and only the first one splits, so a value containing a colon (a
 * "1:1 taper") round-trips intact.
 */
export function parseAttributeSearchParams(
  params: string[] | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const entry of params ?? []) {
    const separator = entry.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const defPublicId = entry.slice(0, separator);
    const value = entry.slice(separator + 1);
    if (value.length === 0) {
      continue;
    }
    out[defPublicId] = [...(out[defPublicId] ?? []), value];
  }
  return out;
}

export function toAttributeSearchParams(
  selections: Record<string, string[]>,
): string[] | undefined {
  const out = Object.entries(selections).flatMap(([defPublicId, values]) =>
    values.map((value) => `${defPublicId}:${value}`),
  );
  return out.length === 0 ? undefined : out;
}

/** The wire shape the list action takes. Empty facets are dropped so
 *  an untouched filter never reaches the query. */
export function toAttributeFacets(selections: Record<string, string[]>) {
  return Object.entries(selections)
    .filter(([, values]) => values.length > 0)
    .map(([defPublicId, values]) => ({ defPublicId, values }));
}
