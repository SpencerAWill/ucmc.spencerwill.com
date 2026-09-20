/**
 * Action implementations for inventory sweeps.
 *
 * A sweep is the cave's periodic count: several officers scan into one
 * open sweep at a time, then somebody closes it. **Presence is
 * recorded; absence is inferred at close** — that inference is the only
 * thing in the system that can decide a piece is `missing`, and it is
 * why `whereabouts_as_of` exists.
 *
 * `gear:manage`, like every other officer surface here. Only one sweep
 * is open at a time, cave-wide: two concurrent counts would each infer
 * absence from the other's sightings and mark half the cave missing.
 */
import { uuidv7 } from "uuidv7";

import {
  requireGearManager,
  requireGearReader,
} from "#/features/gear/server/permissions.server";
import {
  getGearItemByCode,
  getGearItemByPublicId,
} from "#/features/gear/server/repo.server";
import { getGearModelByPublicId } from "#/features/gear/server/models-repo.server";
import {
  countSweepEntries,
  getOpenSweep,
  getSweepByPublicId,
  insertSweep,
  listSweepEntries,
  listSweeps,
  listUncodedActiveItems,
  listUnseenActiveItems,
  markItemsMissing,
  markSweepClosed,
  reconcileCountedModels,
  upsertSweepEntry,
} from "#/features/gear/server/sweeps-repo.server";
import type {
  CountedReconciliationRow,
  UncodedItemRow,
} from "#/features/gear/server/sweeps-repo.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";

export interface GearSweepSummary {
  publicId: string;
  startedAt: Temporal.Instant;
  closedAt: Temporal.Instant | null;
  notes: string | null;
  entryCount: number;
}

export interface GearSweepEntrySummary {
  itemPublicId: string | null;
  itemCode: string | null;
  modelName: string | null;
  quantityCounted: number;
  seenAt: Temporal.Instant;
}

export interface GearSweepDetail extends GearSweepSummary {
  entries: GearSweepEntrySummary[];
}

/**
 * The untagged pieces an officer can log by hand during the open sweep.
 *
 * Empty when no sweep is running: there is nothing to log into.
 */
export async function listUncodedSweepCandidatesAction(): Promise<
  UncodedItemRow[]
> {
  await requireGearManager();
  const sweep = await getOpenSweep();
  if (!sweep) {
    return [];
  }
  return listUncodedActiveItems(sweep.id);
}

export async function getOpenSweepAction(): Promise<GearSweepDetail | null> {
  await requireGearReader();
  const sweep = await getOpenSweep();
  if (!sweep) {
    return null;
  }
  const entries = await listSweepEntries(sweep.id);
  return {
    publicId: sweep.publicId,
    startedAt: sweep.startedAt,
    closedAt: sweep.closedAt,
    notes: sweep.notes,
    entryCount: entries.length,
    entries: entries.map((e) => ({
      itemPublicId: e.itemPublicId,
      itemCode: e.itemCode,
      modelName: e.modelName,
      quantityCounted: e.quantityCounted,
      seenAt: e.seenAt,
    })),
  };
}

export async function listSweepsAction(): Promise<GearSweepSummary[]> {
  await requireGearReader();
  const sweeps = await listSweeps();
  return Promise.all(
    sweeps.map(async (sweep) => ({
      publicId: sweep.publicId,
      startedAt: sweep.startedAt,
      closedAt: sweep.closedAt,
      notes: sweep.notes,
      entryCount: await countSweepEntries(sweep.id),
    })),
  );
}

export type StartSweepResult =
  | { ok: true; publicId: string }
  | { ok: false; reason: "already_open"; publicId: string };

export async function startSweepAction(): Promise<StartSweepResult> {
  const principal = await requireGearManager();
  // Returning the open one rather than erroring: two officers both
  // tapping "Start" is the normal way a sweep begins, and the second
  // tap should join the count, not fail.
  const open = await getOpenSweep();
  if (open) {
    return { ok: false, reason: "already_open", publicId: open.publicId };
  }
  const id = `gsw_${uuidv7()}`;
  const publicId = generatePublicId();
  await insertSweep({ id, publicId, startedByUserId: principal.userId });
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_sweep.started",
    targetType: "gear",
    targetId: id,
    metadata: {},
  });
  return { ok: true, publicId };
}

export interface RecordSweepEntryInput {
  /** Exactly one: a coded piece by the code on its tag, an untagged
   *  piece picked from the list, or a counted model with the number
   *  found in the bin. */
  gearCode?: string;
  /** An unlabelled piece, chosen rather than typed — it has no code to
   *  scan, which used to make it unloggable and therefore missing at
   *  every close. */
  itemPublicId?: string;
  modelPublicId?: string;
  quantityCounted?: number;
}

export type RecordSweepEntryResult =
  | { ok: true; label: string }
  | {
      ok: false;
      reason:
        | "no_open_sweep"
        | "subject_required"
        | "not_found"
        | "not_counted"
        | "item_not_active";
    };

export async function recordSweepEntryAction(
  input: RecordSweepEntryInput,
): Promise<RecordSweepEntryResult> {
  const principal = await requireGearManager();
  const sweep = await getOpenSweep();
  if (!sweep) {
    return { ok: false, reason: "no_open_sweep" };
  }
  const names = [
    input.gearCode,
    input.itemPublicId,
    input.modelPublicId,
  ].filter((v) => v !== undefined && v.length > 0);
  if (names.length !== 1) {
    return { ok: false, reason: "subject_required" };
  }

  if (input.itemPublicId) {
    const item = await getGearItemByPublicId(input.itemPublicId);
    if (!item) {
      return { ok: false, reason: "not_found" };
    }
    if (item.status !== "active") {
      return { ok: false, reason: "item_not_active" };
    }
    await upsertSweepEntry({
      sweepId: sweep.id,
      itemId: item.id,
      modelId: null,
      quantityCounted: 1,
      seenByUserId: principal.userId,
    });
    return { ok: true, label: item.code ?? item.modelName };
  }

  if (input.gearCode) {
    const item = await getGearItemByCode(input.gearCode);
    if (!item) {
      return { ok: false, reason: "not_found" };
    }
    // Scanning a retired piece is worth saying out loud — it is in the
    // cave and the records say it shouldn't be — but it isn't a
    // sighting the close logic should reason about.
    if (item.status !== "active") {
      return { ok: false, reason: "item_not_active" };
    }
    await upsertSweepEntry({
      sweepId: sweep.id,
      itemId: item.id,
      modelId: null,
      quantityCounted: 1,
      seenByUserId: principal.userId,
    });
    return { ok: true, label: item.code ?? item.modelName };
  }

  const model = await getGearModelByPublicId(input.modelPublicId ?? "");
  if (!model) {
    return { ok: false, reason: "not_found" };
  }
  if (model.tracking !== "counted") {
    // A coded model's units are logged one at a time, by code. A bulk
    // number against it would claim a count the item rows contradict.
    return { ok: false, reason: "not_counted" };
  }
  await upsertSweepEntry({
    sweepId: sweep.id,
    itemId: null,
    modelId: model.id,
    quantityCounted: Math.max(0, input.quantityCounted ?? 0),
    seenByUserId: principal.userId,
  });
  return { ok: true, label: model.name };
}

export interface SweepCloseReport {
  /** Coded pieces nobody logged, now marked missing. */
  markedMissing: Array<{
    publicId: string;
    code: string | null;
    modelName: string;
  }>;
  /** Counted models whose numbers don't add up. Reported only —
   *  nothing is written off automatically. */
  shortfalls: Array<CountedReconciliationRow & { shortfall: number }>;
}

export type CloseSweepResult =
  | ({ ok: true } & SweepCloseReport)
  | { ok: false; reason: "no_open_sweep" };

export async function closeSweepAction(
  input: {
    notes?: string | null;
  } = {},
): Promise<CloseSweepResult> {
  const principal = await requireGearManager();
  const sweep = await getOpenSweep();
  if (!sweep) {
    return { ok: false, reason: "no_open_sweep" };
  }
  const now = Temporal.Now.instant();

  // This is the only inference in the system that can decide a piece is
  // missing, which is why the sweep is an entity rather than a
  // per-item checkbox: the close stamps *when* the cave was looked at.
  const unseen = await listUnseenActiveItems(sweep.id, now);
  await markItemsMissing(
    unseen.map((item) => item.id),
    now,
  );

  const reconciliation = await reconcileCountedModels(sweep.id);
  const shortfalls = reconciliation
    .map((row) => ({
      ...row,
      shortfall: row.expected - (row.counted + row.onLoan),
    }))
    // A surplus is reported as nothing: it means somebody miscounted
    // upward or stock is stale, and neither is a loss to chase.
    .filter((row) => row.shortfall > 0);

  await markSweepClosed({
    id: sweep.id,
    closedByUserId: principal.userId,
    notes: input.notes?.trim() || null,
  });
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gear_sweep.closed",
    targetType: "gear",
    targetId: sweep.id,
    metadata: {
      seen: await countSweepEntries(sweep.id),
      markedMissing: unseen.length,
      shortfallModels: shortfalls.length,
    },
  });
  return {
    ok: true,
    markedMissing: unseen.map((item) => ({
      publicId: item.publicId,
      code: item.code,
      modelName: item.modelName,
    })),
    shortfalls,
  };
}

export async function getSweepAction(input: {
  publicId: string;
}): Promise<GearSweepDetail | null> {
  await requireGearReader();
  const sweep = await getSweepByPublicId(input.publicId);
  if (!sweep) {
    return null;
  }
  const entries = await listSweepEntries(sweep.id);
  return {
    publicId: sweep.publicId,
    startedAt: sweep.startedAt,
    closedAt: sweep.closedAt,
    notes: sweep.notes,
    entryCount: entries.length,
    entries: entries.map((e) => ({
      itemPublicId: e.itemPublicId,
      itemCode: e.itemCode,
      modelName: e.modelName,
      quantityCounted: e.quantityCounted,
      seenAt: e.seenAt,
    })),
  };
}
