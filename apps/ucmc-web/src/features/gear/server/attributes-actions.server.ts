/**
 * Action implementations for attribute-definition server fns.
 *
 * Definitions are officer-owned vocabulary, so every write is gated on
 * `gear:manage` and audited — a def is the shape of every answer given
 * against it, and "who added a required field" is a question that gets
 * asked. Reading is at the `gear:read` floor: members see the facets.
 *
 * Two rules are enforced here rather than in the schema, because both
 * are about intent rather than integrity:
 *
 *   - `kind` and `level` are immutable after creation. Flipping a
 *     select to a number leaves every stored answer in the wrong
 *     column, and moving model → item cannot say which item inherits
 *     the fleet's answer. Archive and redefine instead.
 *   - Deleting a def with answers against it is refused. Archiving is
 *     the reversible door, and it is one click away in the same UI.
 */
import { uuidv7 } from "uuidv7";

import {
  attributeKeyFromLabel,
  coerceAttributeValue,
  formatAttributeValue,
} from "#/features/gear/lib/attributes";
import type {
  GearAttributeDefSummary,
  GearAttributeValueDto,
  GearAttributeValueInput,
} from "#/features/gear/lib/attributes";
import {
  countValuesForDef,
  deleteGearAttributeDefById,
  getGearAttributeDefByPublicId,
  insertGearAttributeDef,
  listGearAttributeDefs,
  setGearAttributeDefTypes,
  updateGearAttributeDefById,
} from "#/features/gear/server/attributes-repo.server";
import type {
  AttributeValueWrite,
  GearAttributeDefRow,
  GearAttributeValueRow,
} from "#/features/gear/server/attributes-repo.server";
import {
  requireGearManager,
  requireGearReader,
} from "#/features/gear/server/permissions.server";
import { getGearTypesByPublicIds } from "#/features/gear/server/repo.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { isUniqueViolation } from "#/server/db";
import type { schema } from "#/server/db";

export type { GearAttributeDefSummary, GearAttributeValueDto };

export function toDefSummary(
  row: GearAttributeDefRow,
): GearAttributeDefSummary {
  return {
    publicId: row.publicId,
    key: row.key,
    label: row.label,
    kind: row.kind,
    level: row.level,
    options: row.options,
    unit: row.unit,
    required: row.required,
    position: row.position,
    archived: row.archivedAt !== null,
    typePublicIds: row.types.map((t) => t.publicId),
  };
}

export interface ListGearAttributeDefsActionInput {
  typePublicId?: string;
  level?: schema.GearAttributeLevel;
  includeArchived?: boolean;
}

export async function listGearAttributeDefsAction(
  input: ListGearAttributeDefsActionInput = {},
): Promise<GearAttributeDefSummary[]> {
  await requireGearReader();
  let typeId: string | undefined;
  if (input.typePublicId) {
    const types = await getGearTypesByPublicIds([input.typePublicId]);
    // An unknown type must return nothing, not everything: silently
    // dropping the filter would show a form every attribute in the club.
    if (types.length === 0) {
      return [];
    }
    typeId = types[0]?.id;
  }
  const rows = await listGearAttributeDefs({
    typeId,
    level: input.level,
    includeArchived: input.includeArchived === true,
  });
  return rows.map(toDefSummary);
}

/** Options are trimmed, emptied-out entries dropped, and duplicates
 *  collapsed — but order is preserved, because it is the display
 *  order and the officer typed it deliberately. */
function normalizeOptions(options: string[] | null): string[] | null {
  if (options === null) {
    return null;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of options) {
    const value = raw.trim();
    if (value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

export interface CreateGearAttributeDefInput {
  label: string;
  kind: schema.GearAttributeKind;
  level: schema.GearAttributeLevel;
  options: string[] | null;
  unit: string | null;
  required: boolean;
  typePublicIds: string[];
}

export type CreateGearAttributeDefResult =
  | { ok: true; publicId: string; key: string }
  | { ok: false; reason: "empty_label" | "key_in_use" | "needs_options" };

export async function createGearAttributeDefAction(
  input: CreateGearAttributeDefInput,
): Promise<CreateGearAttributeDefResult> {
  const principal = await requireGearManager();
  const label = input.label.trim();
  if (label.length === 0) {
    return { ok: false, reason: "empty_label" };
  }
  const key = attributeKeyFromLabel(label);
  if (key.length === 0) {
    return { ok: false, reason: "empty_label" };
  }
  const options =
    input.kind === "select" ? normalizeOptions(input.options) : null;
  // A select with no options is a control nobody can answer, and the
  // form would render an empty dropdown rather than an error.
  if (input.kind === "select" && (options === null || options.length === 0)) {
    return { ok: false, reason: "needs_options" };
  }
  const id = `gad_${uuidv7()}`;
  const publicId = generatePublicId();
  try {
    await insertGearAttributeDef({
      id,
      publicId,
      key,
      label,
      kind: input.kind,
      level: input.level,
      options,
      unit: input.kind === "number" ? input.unit?.trim() || null : null,
      required: input.required,
      position: 0,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, reason: "key_in_use" };
    }
    throw err;
  }
  const types = await getGearTypesByPublicIds(input.typePublicIds);
  await setGearAttributeDefTypes(
    id,
    types.map((t) => t.id),
  );
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_attribute.created",
    targetType: "gear_attribute",
    targetId: id,
    metadata: {
      key,
      label,
      kind: input.kind,
      level: input.level,
      required: input.required,
      optionCount: options?.length ?? 0,
      typeIds: types.map((t) => t.id),
    },
  });
  return { ok: true, publicId, key };
}

export interface UpdateGearAttributeDefInput {
  publicId: string;
  label?: string;
  options?: string[] | null;
  unit?: string | null;
  required?: boolean;
  position?: number;
  archived?: boolean;
  typePublicIds?: string[];
}

export type UpdateGearAttributeDefResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "empty_label" | "needs_options" };

export async function updateGearAttributeDefAction(
  input: UpdateGearAttributeDefInput,
): Promise<UpdateGearAttributeDefResult> {
  const principal = await requireGearManager();
  const existing = await getGearAttributeDefByPublicId(input.publicId);
  if (!existing) {
    return { ok: false, reason: "not_found" };
  }
  const patch: Parameters<typeof updateGearAttributeDefById>[1] = {};
  const changedFields: string[] = [];

  if (input.label !== undefined) {
    const label = input.label.trim();
    if (label.length === 0) {
      return { ok: false, reason: "empty_label" };
    }
    if (label !== existing.label) {
      // The key is deliberately not re-derived: it is what every stored
      // answer points at, and a relabel must not orphan them.
      patch.label = label;
      changedFields.push("label");
    }
  }
  if (input.options !== undefined && existing.kind === "select") {
    const options = normalizeOptions(input.options);
    if (options === null || options.length === 0) {
      return { ok: false, reason: "needs_options" };
    }
    patch.options = options;
    changedFields.push("options");
  }
  if (input.unit !== undefined && existing.kind === "number") {
    patch.unit = input.unit?.trim() || null;
    changedFields.push("unit");
  }
  if (input.required !== undefined && input.required !== existing.required) {
    patch.required = input.required;
    changedFields.push("required");
  }
  if (input.position !== undefined && input.position !== existing.position) {
    patch.position = input.position;
    changedFields.push("position");
  }
  if (input.archived !== undefined) {
    const isArchived = existing.archivedAt !== null;
    if (input.archived !== isArchived) {
      patch.archivedAt = input.archived ? Temporal.Now.instant() : null;
      changedFields.push("archived");
    }
  }

  if (Object.keys(patch).length > 0) {
    await updateGearAttributeDefById(existing.id, patch);
  }
  if (input.typePublicIds !== undefined) {
    const types = await getGearTypesByPublicIds(input.typePublicIds);
    const nextIds = types.map((t) => t.id);
    const priorIds = existing.types.map((t) => t.id);
    const same =
      nextIds.length === priorIds.length &&
      nextIds.every((id) => priorIds.includes(id));
    if (!same) {
      await setGearAttributeDefTypes(existing.id, nextIds);
      changedFields.push("types");
    }
  }
  if (changedFields.length === 0) {
    return { ok: true };
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_attribute.updated",
    targetType: "gear_attribute",
    targetId: existing.id,
    metadata: { key: existing.key, changedFields },
  });
  return { ok: true };
}

export type DeleteGearAttributeDefResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "has_values"; valueCount: number };

export async function deleteGearAttributeDefAction(input: {
  publicId: string;
}): Promise<DeleteGearAttributeDefResult> {
  const principal = await requireGearManager();
  const existing = await getGearAttributeDefByPublicId(input.publicId);
  if (!existing) {
    return { ok: false, reason: "not_found" };
  }
  // The FK cascades, so the database would happily take every answer
  // with it. Refusing and pointing at archive is the whole guard.
  const valueCount = await countValuesForDef(existing.id);
  if (valueCount > 0) {
    return { ok: false, reason: "has_values", valueCount };
  }
  await deleteGearAttributeDefById(existing.id);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_attribute.deleted",
    targetType: "gear_attribute",
    targetId: existing.id,
    metadata: { key: existing.key, label: existing.label },
  });
  return { ok: true };
}

// ── values ─────────────────────────────────────────────────────────────

export type ResolveAttributeWritesResult =
  | { ok: true; writes: AttributeValueWrite[] }
  | { ok: false; reason: "invalid_attribute"; label: string; message: string };

/**
 * Turns what a form submitted into what the value tables take, for one
 * owner at one level.
 *
 * Shared by the item and model actions because the rules are identical
 * and the failure messages should be too. Three behaviours worth
 * knowing:
 *
 *   - Definitions the caller did not mention are left alone. The item
 *     form renders item-level defs for one type; it must not wipe an
 *     answer belonging to a def it never showed.
 *   - Definitions the caller mentioned but that are not attached to
 *     this type (or are archived) are ignored rather than rejected. A
 *     form submitted moments after somebody detached a type is a stale
 *     form, not a bad request.
 *   - `required` is enforced here, so the refusal is the same whether
 *     the form forgot to mark the field or somebody posted around it.
 */
export async function resolveAttributeWrites(params: {
  typeId: string;
  level: schema.GearAttributeLevel;
  inputs: GearAttributeValueInput[];
}): Promise<ResolveAttributeWritesResult> {
  const defs = await listGearAttributeDefs({
    typeId: params.typeId,
    level: params.level,
  });
  if (defs.length === 0) {
    return { ok: true, writes: [] };
  }
  const byPublicId = new Map(defs.map((d) => [d.publicId, d]));
  const supplied = new Map(
    params.inputs.map((i) => [i.defPublicId, i.value] as const),
  );
  const writes: AttributeValueWrite[] = [];
  for (const [defPublicId, raw] of supplied) {
    const def = byPublicId.get(defPublicId);
    if (!def) {
      continue;
    }
    const coerced = coerceAttributeValue(
      { kind: def.kind, options: def.options, required: def.required },
      raw,
    );
    if (!coerced.ok) {
      return {
        ok: false,
        reason: "invalid_attribute",
        label: def.label,
        message:
          coerced.reason === "required"
            ? `${def.label} is required.`
            : coerced.reason === "not_a_number"
              ? `${def.label} must be a number.`
              : `That isn't one of the options for ${def.label}.`,
      };
    }
    writes.push({
      defId: def.id,
      valueText: coerced.text,
      valueNumber: coerced.number,
    });
  }
  // A required def the form never sent is the same refusal as one sent
  // blank — otherwise omitting the field is a way around the rule.
  for (const def of defs) {
    if (def.required && !supplied.has(def.publicId)) {
      return {
        ok: false,
        reason: "invalid_attribute",
        label: def.label,
        message: `${def.label} is required.`,
      };
    }
  }
  return { ok: true, writes };
}

/** Wire shape for a stored answer. Formatting stays on the client so
 *  the unit can be styled separately from the number. */
export function toValueDto(row: GearAttributeValueRow): GearAttributeValueDto {
  return {
    defPublicId: row.defPublicId,
    key: row.key,
    label: row.label,
    kind: row.kind,
    unit: row.unit,
    text: row.valueText,
    number: row.valueNumber,
  };
}

/** Answers with nothing recorded are dropped rather than rendered as
 *  an empty row — "Size —" reads as a data problem, and the absence is
 *  already visible from the field simply not being there. */
export function toValueDtos(
  rows: GearAttributeValueRow[] | undefined,
): GearAttributeValueDto[] {
  return (rows ?? [])
    .map(toValueDto)
    .filter((dto) => formatAttributeValue(dto) !== null);
}
