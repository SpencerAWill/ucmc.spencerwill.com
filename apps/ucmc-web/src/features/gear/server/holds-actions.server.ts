/**
 * Action implementations for gear holds.
 *
 * A hold reserves gear ahead of a trip without creating a loan: nobody
 * has taken it, but the desk should stop handing it out. It rides on
 * `gear:manage` — same officer surface as the items it covers, and a
 * permission of its own would cost a migration plus a seed plus a role
 * grant for a surface nobody can be delegated separately.
 *
 * Holds are **self-expiring**. Nothing sweeps them: every read filters
 * on the window, so an officer who forgets to release one after the
 * trip costs the cave nothing. Releasing early is the explicit action,
 * and it is audited, because "who freed the trip gear" gets asked.
 */
import { uuidv7 } from "uuidv7";

import {
  getGearHoldByPublicId,
  insertGearHold,
  listGearHolds,
  markGearHoldReleased,
} from "#/features/gear/server/holds-repo.server";
import type { GearHoldRow } from "#/features/gear/server/holds-repo.server";
import {
  requireGearManager,
  requireGearReader,
} from "#/features/gear/server/permissions.server";
import {
  getGearItemByCode,
  getGearItemByPublicId,
} from "#/features/gear/server/repo.server";
import { getGearModelByPublicId } from "#/features/gear/server/models-repo.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";

export interface GearHoldSummary {
  publicId: string;
  /** Null for a counted hold — there is no item page to open, the same
   *  way a counted loan has no subject link. */
  itemPublicId: string | null;
  itemCode: string | null;
  modelPublicId: string;
  modelName: string;
  manufacturer: string | null;
  typeName: string;
  quantity: number;
  reason: string;
  startsAt: Temporal.Instant;
  endsAt: Temporal.Instant;
  releasedAt: Temporal.Instant | null;
  /** Derived, not stored: unreleased and inside its window. Computed
   *  server-side so the badge can't disagree with the filter. */
  isLive: boolean;
}

function toSummary(row: GearHoldRow, now: Temporal.Instant): GearHoldSummary {
  return {
    publicId: row.publicId,
    itemPublicId: row.itemPublicId,
    itemCode: row.itemCode,
    modelPublicId: row.modelPublicId,
    modelName: row.modelName,
    manufacturer: row.manufacturer,
    typeName: row.typeName,
    quantity: row.quantity,
    reason: row.reason,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    releasedAt: row.releasedAt,
    isLive:
      row.releasedAt === null &&
      Temporal.Instant.compare(row.startsAt, now) <= 0 &&
      Temporal.Instant.compare(row.endsAt, now) > 0,
  };
}

export interface ListGearHoldsActionInput {
  liveOnly?: boolean;
  gearPublicId?: string;
  modelPublicId?: string;
}

export async function listGearHoldsAction(
  input: ListGearHoldsActionInput = {},
): Promise<GearHoldSummary[]> {
  // Members see holds: "held for the Red River trip" is a better
  // answer than an unexplained missing piece, and the reason text is
  // written by officers for exactly that audience.
  await requireGearReader();
  const now = Temporal.Now.instant();
  const options: Parameters<typeof listGearHolds>[0] = {
    now,
    liveOnly: input.liveOnly,
  };
  if (input.gearPublicId) {
    const item = await getGearItemByPublicId(input.gearPublicId);
    if (!item) {
      return [];
    }
    options.itemId = item.id;
  }
  if (input.modelPublicId) {
    const model = await getGearModelByPublicId(input.modelPublicId);
    if (!model) {
      return [];
    }
    options.modelId = model.id;
  }
  const rows = await listGearHolds(options);
  return rows.map((row) => toSummary(row, now));
}

export interface PlaceGearHoldInput {
  /** Exactly one subject. A coded piece is held by its code — which is
   *  how the cave names pieces, so "hold CH93" is what an officer is
   *  already thinking — or by publicId when a page already has one. A
   *  counted model is held by quantity. */
  gearPublicId?: string;
  gearCode?: string;
  modelPublicId?: string;
  quantity?: number;
  reason: string;
  startsAtMs: number;
  endsAtMs: number;
}

export type PlaceGearHoldResult =
  | { ok: true; publicId: string }
  | {
      ok: false;
      reason:
        | "subject_required"
        | "not_found"
        | "empty_reason"
        | "bad_window"
        | "not_counted"
        | "item_not_active";
    };

export async function placeGearHoldAction(
  input: PlaceGearHoldInput,
): Promise<PlaceGearHoldResult> {
  const principal = await requireGearManager();
  // XOR is a CHECK constraint in the schema; catching it here turns a
  // constraint error into something the form can render.
  const names = [
    input.gearPublicId,
    input.gearCode,
    input.modelPublicId,
  ].filter((v) => v !== undefined && v.length > 0);
  if (names.length !== 1) {
    return { ok: false, reason: "subject_required" };
  }
  const reason = input.reason.trim();
  if (reason.length === 0) {
    // The reason is the whole point: a member looking at a held piece
    // should read "Red River trip, back Monday", not "unavailable".
    return { ok: false, reason: "empty_reason" };
  }
  const startsAt = Temporal.Instant.fromEpochMilliseconds(input.startsAtMs);
  const endsAt = Temporal.Instant.fromEpochMilliseconds(input.endsAtMs);
  if (Temporal.Instant.compare(endsAt, startsAt) <= 0) {
    return { ok: false, reason: "bad_window" };
  }

  let itemId: string | null = null;
  let modelId: string | null = null;
  let quantity = 1;
  if (input.gearPublicId || input.gearCode) {
    const item = input.gearPublicId
      ? await getGearItemByPublicId(input.gearPublicId)
      : await getGearItemByCode(input.gearCode ?? "");
    if (!item) {
      return { ok: false, reason: "not_found" };
    }
    // Holding a retired piece would show a live hold on something that
    // can never be handed out either way.
    if (item.status !== "active") {
      return { ok: false, reason: "item_not_active" };
    }
    itemId = item.id;
  } else {
    const model = await getGearModelByPublicId(input.modelPublicId ?? "");
    if (!model) {
      return { ok: false, reason: "not_found" };
    }
    // A coded model has item rows; holding it by quantity would pick
    // no particular piece and block nothing the rollup can see.
    if (model.tracking !== "counted") {
      return { ok: false, reason: "not_counted" };
    }
    modelId = model.id;
    quantity = Math.max(1, input.quantity ?? 1);
  }

  const id = `gh_${uuidv7()}`;
  const publicId = generatePublicId();
  await insertGearHold({
    id,
    publicId,
    itemId,
    modelId,
    quantity,
    reason,
    startsAt,
    endsAt,
    heldByUserId: principal.userId,
  });
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_hold.placed",
    targetType: "gear",
    targetId: itemId ?? modelId ?? id,
    metadata: {
      holdId: id,
      quantity,
      reason,
      startsAt: startsAt.epochMilliseconds,
      endsAt: endsAt.epochMilliseconds,
    },
  });
  return { ok: true, publicId };
}

export type ReleaseGearHoldResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_released" };

export async function releaseGearHoldAction(input: {
  publicId: string;
}): Promise<ReleaseGearHoldResult> {
  const principal = await requireGearManager();
  const hold = await getGearHoldByPublicId(input.publicId);
  if (!hold) {
    return { ok: false, reason: "not_found" };
  }
  if (hold.releasedAt !== null) {
    return { ok: false, reason: "already_released" };
  }
  // An expired hold may still be released: it changes nothing about
  // availability, but it is how an officer says "this trip is over"
  // rather than leaving a row that looks merely lapsed.
  await markGearHoldReleased(hold.id, principal.userId);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_hold.released",
    targetType: "gear",
    targetId: hold.itemId ?? hold.modelId,
    metadata: { holdId: hold.id, reason: hold.reason },
  });
  return { ok: true };
}
