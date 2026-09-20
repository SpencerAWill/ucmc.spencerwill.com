/**
 * Route-facing shells for gear server fns. Each handler body is a
 * one-line dynamic import of the action it delegates to, keeping
 * server-only code (DB access, audit recorder) off the client bundle.
 *
 * Input schemas use zod and are referenced by route loaders for
 * validateSearch / queryOptions input typing.
 */
import { createServerFn } from "@tanstack/react-start";

import { GEAR_AVAILABILITY } from "#/features/gear/lib/availability";
import { z } from "zod";
import type {
  GearModelBrowseDto,
  CreateGearModelResult,
  DeleteGearModelResult,
  GearModelSummaryDto,
  UpdateGearModelResult,
} from "#/features/gear/server/models-actions.server";
import type {
  BulkImportInput,
  BulkImportResult,
  BulkImportSkipped,
} from "#/features/gear/server/gear-bulk-import-actions.server";
import type {
  BulkImportLoanRow,
  BulkImportLoansInput,
  BulkImportLoansResult,
  BulkImportLoanCreated,
  BulkImportLoanSkipped,
  BulkImportLoanSkipReason,
} from "#/features/gear/server/loans-bulk-import-actions.server";
import type {
  CreateGearInput,
  CreateGearResult,
  EditGearInput,
  EditGearResult,
  GearDetail,
  GearLabel,
  GearSummary,
  GearTagSummary,
  GearTypeSummary,
  ListGearActionInput,
  ListGearActionResult,
  DeactivateGearResult,
  ReleaseCodeResult,
} from "#/features/gear/server/gear-actions.server";
import type {
  CreateGearTypeInput,
  CreateGearTypeResult,
  DeleteGearTypeResult,
  EditGearTypeInput,
  EditGearTypeResult,
} from "#/features/gear/server/gear-types-actions.server";
import type {
  CloseSweepResult,
  GearSweepDetail,
  GearSweepSummary,
  RecordSweepEntryInput,
  RecordSweepEntryResult,
  StartSweepResult,
} from "#/features/gear/server/sweeps-actions.server";
import type {
  GearHoldSummary,
  ListGearHoldsActionInput,
  PlaceGearHoldInput,
  PlaceGearHoldResult,
  ReleaseGearHoldResult,
} from "#/features/gear/server/holds-actions.server";
import type {
  CreateGearAttributeDefInput,
  CreateGearAttributeDefResult,
  DeleteGearAttributeDefResult,
  GearAttributeDefSummary,
  ListGearAttributeDefsActionInput,
  UpdateGearAttributeDefInput,
  UpdateGearAttributeDefResult,
} from "#/features/gear/server/attributes-actions.server";
import type {
  CreateGearTagInput,
  CreateGearTagResult,
  EditGearTagInput,
  EditGearTagResult,
} from "#/features/gear/server/gear-tags-actions.server";
import type {
  GearInspectionSummary,
  RecordGearInspectionInput,
  RecordGearInspectionResult,
} from "#/features/gear/server/gear-inspections-actions.server";
import type {
  CheckinLoansInput,
  CheckinLoansResult,
  CheckoutLoansInput,
  CheckoutLoansResult,
  CheckoutSkipReason,
  ExtendLoanResult,
  GearLookupRow,
  ListLoansActionInput,
  ListLoansActionResult,
  LoanDetail,
  LoanSummary,
  MyLoansResult,
} from "#/features/gear/server/loans-actions.server";
import type {
  AddToCartResult,
  CartItemAvailability,
  CartItemRow,
  MintCartTokenResult,
  MyCartResult,
  ResolveCartTokenResult,
  ResolvedCart,
} from "#/features/gear/server/cart-actions.server";
import type { MemberSearchResult } from "#/features/gear/server/loans-repo.server";

// ── bulk multi-select handlers ─────────────────────────────────────────

import type { BulkResult } from "#/features/gear/server/gear-bulk-actions.server";

// Mirror of the gear enums in `drizzle/schema.ts`. Re-declared here so
// route loaders and form components can validate filter / submit shapes
// without pulling the whole schema file into the client bundle. Keep in
// sync with `drizzle/schema.ts` — the schema is the database-side
// source of truth.
export const GEAR_STATUS_VALUES = [
  "active",
  "retired",
  "lost",
  "disposed",
] as const;
export type GearStatus = (typeof GEAR_STATUS_VALUES)[number];

export const GEAR_CONDITION_VALUES = [
  "serviceable",
  "needs_repair",
  "unsafe",
] as const;
export type GearCondition = (typeof GEAR_CONDITION_VALUES)[number];

export const GEAR_WHEREABOUTS_VALUES = [
  "cave",
  "repair",
  "officer",
  "missing",
] as const;
export type GearWhereabouts = (typeof GEAR_WHEREABOUTS_VALUES)[number];

export const GEAR_TRACKING_VALUES = ["coded", "counted"] as const;
export type GearTracking = (typeof GEAR_TRACKING_VALUES)[number];

export const GEAR_ACQUISITION_KIND_VALUES = [
  "purchased",
  "donated",
  "found",
  "warranty_replacement",
] as const;
export type GearAcquisitionKind = (typeof GEAR_ACQUISITION_KIND_VALUES)[number];

export const GEAR_ATTRIBUTE_KIND_VALUES = [
  "text",
  "number",
  "select",
  "boolean",
] as const;
export type GearAttributeKind = (typeof GEAR_ATTRIBUTE_KIND_VALUES)[number];

export const GEAR_ATTRIBUTE_LEVEL_VALUES = ["model", "item"] as const;
export type GearAttributeLevel = (typeof GEAR_ATTRIBUTE_LEVEL_VALUES)[number];

export const GEAR_INSPECTION_RESULT_VALUES = [
  "pass",
  "fail",
  "advisory",
] as const;
export type GearInspectionResultValue =
  (typeof GEAR_INSPECTION_RESULT_VALUES)[number];

export type {
  AddToCartResult,
  BulkImportInput,
  BulkImportResult,
  BulkImportSkipped,
  CartItemAvailability,
  CartItemRow,
  MintCartTokenResult,
  MyCartResult,
  ResolveCartTokenResult,
  ResolvedCart,
  BulkImportLoanRow,
  BulkImportLoansInput,
  BulkImportLoansResult,
  BulkImportLoanCreated,
  BulkImportLoanSkipped,
  BulkImportLoanSkipReason,
  CreateGearInput,
  CreateGearResult,
  CreateGearTagInput,
  CreateGearTagResult,
  EditGearTagInput,
  EditGearTagResult,
  CreateGearTypeInput,
  CreateGearTypeResult,
  DeleteGearTypeResult,
  EditGearInput,
  EditGearResult,
  EditGearTypeInput,
  EditGearTypeResult,
  GearDetail,
  GearInspectionSummary,
  GearLabel,
  GearSummary,
  GearTagSummary,
  GearTypeSummary,
  ListGearActionInput,
  ListGearActionResult,
  CheckinLoansInput,
  CheckinLoansResult,
  CheckoutLoansInput,
  CheckoutLoansResult,
  CheckoutSkipReason,
  ExtendLoanResult,
  GearLookupRow,
  ListLoansActionInput,
  ListLoansActionResult,
  LoanDetail,
  LoanSummary,
  MemberSearchResult,
  RecordGearInspectionInput,
  RecordGearInspectionResult,
  DeactivateGearResult,
  ReleaseCodeResult,
};

// ── input schemas ───────────────────────────────────────────────────────

// Dates ride the wire as ms-since-epoch numbers (or null) and the
// action converts at the boundary. Keeping the schema input shape
// JSON-native — no `.transform()` — means `createServerFn`'s `data`
// type stays serializable, which is what client-side hooks consume.
//
// Floored at 0 (Unix epoch) and capped at 2100-01-01 UTC to catch
// obvious typos in the bulk-import CSV (e.g. `20240101` instead of
// `2024-01-01`, which `Date.parse` happily turns into ms-since-epoch
// well past year 2100). Not a security boundary — just a sanity net.
const ACQUIRED_AT_MAX_MS = Date.UTC(2100, 0, 1);
const acquiredAtSchema = z
  .number()
  .int()
  .min(0)
  .max(ACQUIRED_AT_MAX_MS)
  .nullable();

export const listGearInputSchema = z.object({
  typePublicId: z.string().min(1).optional(),
  modelPublicId: z.string().min(1).optional(),
  tagPublicIds: z.array(z.string().min(1)).optional(),
  status: z.enum(GEAR_STATUS_VALUES).optional(),
  condition: z.enum(GEAR_CONDITION_VALUES).optional(),
  whereabouts: z.enum(GEAR_WHEREABOUTS_VALUES).optional(),
  availability: z.enum(GEAR_AVAILABILITY).optional(),
  attributes: z
    .array(
      z.object({
        defPublicId: z.string().min(1),
        values: z.array(z.string().min(1).max(500)).min(1).max(50),
      }),
    )
    .max(20)
    .optional(),
  inspection: z.enum(["overdue", "due_soon", "never"]).optional(),
  serviceLife: z.enum(["expired", "expiring", "unknown"]).optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(["code", "created_at", "updated_at", "model"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(1).max(250).optional(),
});

// Thumbnail data URL — capped at ~600 KB so the encoded base64 fits
// inside the worker request budget (~1 MiB) even with overhead.
const thumbnailDataUrlSchema = z
  .string()
  .max(600 * 1024)
  .regex(/^data:image\/(webp|jpeg|png);base64,/, "Invalid image data URL");

/** Answers to officer-defined attributes. The value is the raw string
 *  the control produced; `null` clears it. Coercion into the two
 *  storage columns happens once, server-side. */
const attributeValueInputSchema = z
  .array(
    z.object({
      defPublicId: z.string().min(1),
      value: z.string().max(500).nullable(),
    }),
  )
  .max(100);

export const createGearInputSchema = z.object({
  // The product this unit is. Manufacturer, MSRP and service life come
  // from the model now, so they are no longer per-item fields.
  modelPublicId: z.string().min(1),
  code: z.string().max(64).nullable(),
  // Distinguishing marks for this unit, e.g. "blue tape on the spine".
  // Optional: the model supplies the name, so most items have nothing
  // to say here.
  description: z.string().trim().max(500).nullable(),
  // null = no thumbnail (omit on create); falls back to the model's
  // product shot at render time.
  thumbnailDataUrl: thumbnailDataUrlSchema.nullable(),
  acquiredAt: acquiredAtSchema,
  manufacturedAt: acquiredAtSchema.optional(),
  acquisitionCostCents: z.number().int().min(0).nullable(),
  acquisitionKind: z.enum(GEAR_ACQUISITION_KIND_VALUES).nullable().optional(),
  // Optional on the wire — omit means "unknown / not provided" on
  // create, and "no change" on edit. The action normalizes undefined
  // to null at the boundary.
  serialNumber: z.string().trim().max(100).nullable().optional(),
  notesMarkdown: z.string().max(10_000).nullable(),
  condition: z.enum(GEAR_CONDITION_VALUES),
  whereabouts: z.enum(GEAR_WHEREABOUTS_VALUES).optional(),
  whereaboutsNote: z.string().trim().max(500).nullable().optional(),
  tagPublicIds: z.array(z.string().min(1)),
  attributes: attributeValueInputSchema.optional(),
});

const editGearInputSchema = createGearInputSchema
  .omit({ thumbnailDataUrl: true })
  .extend({
    publicId: z.string().min(1),
    // Three-state on edit:
    //   - omitted: keep existing thumbnail
    //   - null:    remove the thumbnail
    //   - data URL: replace with the new image
    thumbnailDataUrl: thumbnailDataUrlSchema.nullable().optional(),
  });

const deactivateGearInputSchema = z.object({
  publicId: z.string().min(1),
  status: z.enum(["retired", "lost", "disposed"]),
  reason: z.string().max(500).nullable(),
});

const reactivateGearInputSchema = z.object({
  publicId: z.string().min(1),
});

const gearTypeInputSchema = z.object({
  name: z.string().min(1).max(80),
  prefix: z.string().max(8).nullable(),
  description: z.string().max(500).nullable(),
  inspectionIntervalDays: z.number().int().min(1).max(3650).nullable(),
});

const editGearTypeInputSchema = gearTypeInputSchema.extend({
  publicId: z.string().min(1),
});

const deleteGearTypeInputSchema = z.object({
  publicId: z.string().min(1),
});

const GEAR_TAG_VISIBILITY_VALUES = ["public", "internal"] as const;

const gearTagInputSchema = z.object({
  name: z.string().min(1).max(40),
  visibility: z.enum(GEAR_TAG_VISIBILITY_VALUES),
});

const editGearTagInputSchema = z.object({
  publicId: z.string().min(1),
  name: z.string().min(1).max(40),
  visibility: z.enum(GEAR_TAG_VISIBILITY_VALUES),
});

const deleteGearTagInputSchema = z.object({
  publicId: z.string().min(1),
});

const listGearModelBrowseInputSchema = z.object({
  typePublicId: z.string().min(1).optional(),
  q: z.string().max(200).optional(),
});

// ── sweeps ─────────────────────────────────────────────────────────────

const recordSweepEntryInputSchema = z.object({
  gearCode: z.string().trim().min(1).max(64).optional(),
  modelPublicId: z.string().min(1).optional(),
  quantityCounted: z.number().int().min(0).max(9999).optional(),
});

const closeSweepInputSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
});

const getSweepInputSchema = z.object({
  publicId: z.string().min(1),
});

// ── holds ──────────────────────────────────────────────────────────────

const listGearHoldsInputSchema = z.object({
  liveOnly: z.boolean().optional(),
  gearPublicId: z.string().min(1).optional(),
  modelPublicId: z.string().min(1).optional(),
});

const placeGearHoldInputSchema = z.object({
  gearPublicId: z.string().min(1).optional(),
  gearCode: z.string().trim().min(1).max(64).optional(),
  modelPublicId: z.string().min(1).optional(),
  quantity: z.number().int().min(1).max(999).optional(),
  reason: z.string().trim().min(1).max(300),
  startsAtMs: z.number().int(),
  endsAtMs: z.number().int(),
});

const releaseGearHoldInputSchema = z.object({
  publicId: z.string().min(1),
});

// ── attribute definitions ──────────────────────────────────────────────

const listGearAttributeDefsInputSchema = z.object({
  typePublicId: z.string().min(1).optional(),
  level: z.enum(GEAR_ATTRIBUTE_LEVEL_VALUES).optional(),
  includeArchived: z.boolean().optional(),
});

const createGearAttributeDefInputSchema = z.object({
  label: z.string().min(1).max(60),
  kind: z.enum(GEAR_ATTRIBUTE_KIND_VALUES),
  level: z.enum(GEAR_ATTRIBUTE_LEVEL_VALUES),
  options: z.array(z.string().min(1).max(60)).max(50).nullable(),
  unit: z.string().max(12).nullable(),
  required: z.boolean(),
  typePublicIds: z.array(z.string().min(1)).max(100),
});

const updateGearAttributeDefInputSchema = z.object({
  publicId: z.string().min(1),
  label: z.string().min(1).max(60).optional(),
  options: z.array(z.string().min(1).max(60)).max(50).nullable().optional(),
  unit: z.string().max(12).nullable().optional(),
  required: z.boolean().optional(),
  position: z.number().int().min(0).max(1000).optional(),
  archived: z.boolean().optional(),
  typePublicIds: z.array(z.string().min(1)).max(100).optional(),
});

const deleteGearAttributeDefInputSchema = z.object({
  publicId: z.string().min(1),
});

// ── multi-select bulk-action input schemas ─────────────────────────────

const publicIdArraySchema = z.array(z.string().min(1)).min(1).max(500);

const bulkDeactivateInputSchema = z.object({
  publicIds: publicIdArraySchema,
  status: z.enum(["retired", "lost", "disposed"]),
  reason: z.string().max(500).nullable(),
});

const bulkReactivateInputSchema = z.object({
  publicIds: publicIdArraySchema,
});

const bulkSetConditionInputSchema = z.object({
  publicIds: publicIdArraySchema,
  condition: z.enum(GEAR_CONDITION_VALUES),
});

const bulkAddTagsInputSchema = z.object({
  publicIds: publicIdArraySchema,
  tagPublicIds: z.array(z.string().min(1)).min(1).max(50),
});

const bulkImportInputSchema = z.object({
  rows: z
    .array(
      z.object({
        // The import addresses a type + product by name and creates
        // the model on demand, because a CSV of forty draws shouldn't
        // require the officer to pre-create the model by hand.
        typePublicId: z.string().min(1),
        modelName: z.string().trim().min(1).max(200),
        manufacturer: z.string().trim().max(100).nullable().optional(),
        code: z.string().max(64).nullable(),
        description: z.string().max(500).nullable().optional(),
        acquiredAt: acquiredAtSchema,
        manufacturedAt: acquiredAtSchema.optional(),
        acquisitionCostCents: z.number().int().min(0).nullable(),
        acquisitionKind: z
          .enum(GEAR_ACQUISITION_KIND_VALUES)
          .nullable()
          .optional(),
        // Optional passthroughs — see BulkImportRow.
        msrpCents: z.number().int().min(0).nullable().optional(),
        serialNumber: z.string().trim().max(100).nullable().optional(),
        tagNames: z.array(z.string().min(1).max(40)).max(50).optional(),
      }),
    )
    .min(1)
    .max(500),
});

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

const conditionSchema = z.enum(GEAR_CONDITION_VALUES);

const bulkImportLoansInputSchema = z.object({
  rows: z
    .array(
      z.object({
        memberEmail: z.string().email().max(254),
        gearCode: z.string().min(1).max(64),
        checkedOutAt: isoDateSchema,
        dueAt: isoDateSchema.nullable(),
        returnedAt: isoDateSchema.nullable(),
        conditionAtReturn: conditionSchema.nullable(),
        checkoutNotes: z.string().max(2000).nullable(),
        checkinNotes: z.string().max(2000).nullable(),
      }),
    )
    .min(1)
    // Backfill is rare and tediously human-paced; 500 rows per submit
    // is generous and mirrors the gear bulk-import ceiling.
    .max(500),
});

const suggestCodeInputSchema = z.object({
  typePublicId: z.string().min(1),
});

const gearDetailInputSchema = z.object({
  publicId: z.string().min(1),
});

// Labels: send N publicIds, get back the printable rows for them.
// Capped at 500 so a runaway "print everything" can't time out the
// worker; that's more than a single Avery sheet ever holds anyway.
const listGearLabelsInputSchema = z.object({
  publicIds: z.array(z.string().min(1)).min(1).max(500),
});

// ── inspections ────────────────────────────────────────────────────────

const listGearInspectionsInputSchema = z.object({
  gearPublicId: z.string().min(1),
});

const recordGearInspectionInputSchema = z.object({
  gearPublicId: z.string().min(1),
  inspectedAt: z.number().int().nonnegative(),
  result: z.enum(GEAR_INSPECTION_RESULT_VALUES),
  notes: z.string().max(2_000).nullable(),
});

// ── loans ──────────────────────────────────────────────────────────────

const checkoutLoansInputSchema = z.object({
  memberPublicId: z.string().min(1),
  // Up to 50 items per checkout flow; large enough for any realistic
  // gear-cave batch, small enough that audit-event fan-out + per-row
  // pre-checks fit comfortably in a worker request.
  items: z
    .array(
      z.object({
        gearPublicId: z.string().min(1),
        // 0 is allowed for same-day checkouts (e.g. exec borrows gear
        // for a meeting and returns it the same evening). The due-at
        // computation snaps to end-of-day so a 0-day loan is still
        // valid until 23:59:59.
        durationDays: z.number().int().min(0).max(90),
      }),
    )
    .min(1)
    .max(50),
  notes: z.string().max(2_000).nullable(),
  // Officer overrides. Declared here or Zod strips them and the action
  // never sees the flag the desk sent — `gear:manage` is re-checked in
  // `checkoutLoansAction`, so accepting them at the boundary grants
  // nothing on its own.
  overrideStanding: z.boolean().optional(),
  overrideHolds: z.boolean().optional(),
});

const checkinLoansInputSchema = z.object({
  items: z
    .array(
      z.object({
        gearPublicId: z.string().min(1),
        conditionAtReturn: z.enum(GEAR_CONDITION_VALUES).nullable(),
        notes: z.string().max(2_000).nullable(),
      }),
    )
    .min(1)
    .max(50),
});

const extendLoanInputSchema = z.object({
  publicId: z.string().min(1),
  // Tie the cap to the same year-2100 floor used by `acquiredAt`.
  newDueAt: z
    .number()
    .int()
    .min(0)
    .max(Date.UTC(2100, 0, 1)),
});

const listLoansInputSchema = z.object({
  tab: z.enum(["active", "history"]).optional(),
  memberPublicId: z.string().min(1).optional(),
  q: z.string().max(200).optional(),
  overdueOnly: z.boolean().optional(),
  sort: z.enum(["due_at", "checked_out_at"]).optional(),
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(1).max(250).optional(),
});

const loanDetailInputSchema = z.object({
  publicId: z.string().min(1),
});

const memberSearchInputSchema = z.object({
  q: z.string().min(1).max(200),
});

const memberByPublicIdInputSchema = z.object({
  publicId: z.string().min(1),
});

const gearCodeSearchInputSchema = z.object({
  q: z.string().min(1).max(64),
});

const gearByCodeInputSchema = z.object({
  code: z.string().min(1).max(64),
});

// ── server fn handlers ──────────────────────────────────────────────────

export const listGearFn = createServerFn({ method: "GET" })
  .validator(listGearInputSchema)
  .handler(async ({ data }): Promise<ListGearActionResult> => {
    const { listGearAction } =
      await import("#/features/gear/server/gear-actions.server");
    return listGearAction(data);
  });

export const listGearLabelsFn = createServerFn({ method: "GET" })
  .validator(listGearLabelsInputSchema)
  .handler(async ({ data }): Promise<GearLabel[]> => {
    const { listGearLabelsAction } =
      await import("#/features/gear/server/gear-actions.server");
    return listGearLabelsAction(data);
  });

export const getGearDetailFn = createServerFn({ method: "GET" })
  .validator(gearDetailInputSchema)
  .handler(async ({ data }): Promise<GearDetail> => {
    const { getGearDetailAction } =
      await import("#/features/gear/server/gear-actions.server");
    return getGearDetailAction(data);
  });

export const createGearFn = createServerFn({ method: "POST" })
  .validator(createGearInputSchema)
  .handler(async ({ data }): Promise<CreateGearResult> => {
    const { createGearAction } =
      await import("#/features/gear/server/gear-actions.server");
    return createGearAction(data);
  });

export const editGearFn = createServerFn({ method: "POST" })
  .validator(editGearInputSchema)
  .handler(async ({ data }): Promise<EditGearResult> => {
    const { editGearAction } =
      await import("#/features/gear/server/gear-actions.server");
    return editGearAction(data);
  });

export const deactivateGearFn = createServerFn({ method: "POST" })
  .validator(deactivateGearInputSchema)
  .handler(async ({ data }): Promise<DeactivateGearResult> => {
    const { deactivateGearAction } =
      await import("#/features/gear/server/gear-actions.server");
    return deactivateGearAction(data);
  });

export const reactivateGearFn = createServerFn({ method: "POST" })
  .validator(reactivateGearInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { reactivateGearAction } =
      await import("#/features/gear/server/gear-actions.server");
    return reactivateGearAction(data);
  });

export const releaseGearCodeFn = createServerFn({ method: "POST" })
  .validator(reactivateGearInputSchema)
  .handler(async ({ data }): Promise<ReleaseCodeResult> => {
    const { releaseGearItemCodeAction } =
      await import("#/features/gear/server/gear-actions.server");
    return releaseGearItemCodeAction(data);
  });

export const suggestCodeForTypeFn = createServerFn({ method: "GET" })
  .validator(suggestCodeInputSchema)
  .handler(async ({ data }): Promise<{ suggestion: string }> => {
    const { suggestCodeForTypeAction } =
      await import("#/features/gear/server/gear-actions.server");
    return suggestCodeForTypeAction(data);
  });

export const listGearTypesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<GearTypeSummary[]> => {
    const { listGearTypesAction } =
      await import("#/features/gear/server/gear-types-actions.server");
    return listGearTypesAction();
  },
);

export const createGearTypeFn = createServerFn({ method: "POST" })
  .validator(gearTypeInputSchema)
  .handler(async ({ data }): Promise<CreateGearTypeResult> => {
    const { createGearTypeAction } =
      await import("#/features/gear/server/gear-types-actions.server");
    return createGearTypeAction(data);
  });

export const editGearTypeFn = createServerFn({ method: "POST" })
  .validator(editGearTypeInputSchema)
  .handler(async ({ data }): Promise<EditGearTypeResult> => {
    const { editGearTypeAction } =
      await import("#/features/gear/server/gear-types-actions.server");
    return editGearTypeAction(data);
  });

export const deleteGearTypeFn = createServerFn({ method: "POST" })
  .validator(deleteGearTypeInputSchema)
  .handler(async ({ data }): Promise<DeleteGearTypeResult> => {
    const { deleteGearTypeAction } =
      await import("#/features/gear/server/gear-types-actions.server");
    return deleteGearTypeAction(data);
  });

export const listGearTagsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<GearTagSummary[]> => {
    const { listGearTagsAction } =
      await import("#/features/gear/server/gear-tags-actions.server");
    return listGearTagsAction();
  },
);

export const createGearTagFn = createServerFn({ method: "POST" })
  .validator(gearTagInputSchema)
  .handler(async ({ data }): Promise<CreateGearTagResult> => {
    const { createGearTagAction } =
      await import("#/features/gear/server/gear-tags-actions.server");
    return createGearTagAction(data);
  });

export const editGearTagFn = createServerFn({ method: "POST" })
  .validator(editGearTagInputSchema)
  .handler(async ({ data }): Promise<EditGearTagResult> => {
    const { editGearTagAction } =
      await import("#/features/gear/server/gear-tags-actions.server");
    return editGearTagAction(data);
  });

export const deleteGearTagFn = createServerFn({ method: "POST" })
  .validator(deleteGearTagInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteGearTagAction } =
      await import("#/features/gear/server/gear-tags-actions.server");
    return deleteGearTagAction(data);
  });

// ── sweeps ─────────────────────────────────────────────────────────────

export type {
  CloseSweepResult,
  GearSweepDetail,
  GearSweepSummary,
  RecordSweepEntryInput,
  RecordSweepEntryResult,
  StartSweepResult,
};

export const getOpenSweepFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<GearSweepDetail | null> => {
    const { getOpenSweepAction } =
      await import("#/features/gear/server/sweeps-actions.server");
    return getOpenSweepAction();
  },
);

export const listSweepsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<GearSweepSummary[]> => {
    const { listSweepsAction } =
      await import("#/features/gear/server/sweeps-actions.server");
    return listSweepsAction();
  },
);

export const getSweepFn = createServerFn({ method: "GET" })
  .validator(getSweepInputSchema)
  .handler(async ({ data }): Promise<GearSweepDetail | null> => {
    const { getSweepAction } =
      await import("#/features/gear/server/sweeps-actions.server");
    return getSweepAction(data);
  });

export const startSweepFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<StartSweepResult> => {
    const { startSweepAction } =
      await import("#/features/gear/server/sweeps-actions.server");
    return startSweepAction();
  },
);

export const recordSweepEntryFn = createServerFn({ method: "POST" })
  .validator(recordSweepEntryInputSchema)
  .handler(async ({ data }): Promise<RecordSweepEntryResult> => {
    const { recordSweepEntryAction } =
      await import("#/features/gear/server/sweeps-actions.server");
    return recordSweepEntryAction(data);
  });

export const closeSweepFn = createServerFn({ method: "POST" })
  .validator(closeSweepInputSchema)
  .handler(async ({ data }): Promise<CloseSweepResult> => {
    const { closeSweepAction } =
      await import("#/features/gear/server/sweeps-actions.server");
    return closeSweepAction(data);
  });

// ── holds ──────────────────────────────────────────────────────────────

export type {
  GearHoldSummary,
  ListGearHoldsActionInput,
  PlaceGearHoldInput,
  PlaceGearHoldResult,
  ReleaseGearHoldResult,
};

export const listGearHoldsFn = createServerFn({ method: "GET" })
  .validator(listGearHoldsInputSchema)
  .handler(async ({ data }): Promise<GearHoldSummary[]> => {
    const { listGearHoldsAction } =
      await import("#/features/gear/server/holds-actions.server");
    return listGearHoldsAction(data);
  });

export const placeGearHoldFn = createServerFn({ method: "POST" })
  .validator(placeGearHoldInputSchema)
  .handler(async ({ data }): Promise<PlaceGearHoldResult> => {
    const { placeGearHoldAction } =
      await import("#/features/gear/server/holds-actions.server");
    return placeGearHoldAction(data);
  });

export const releaseGearHoldFn = createServerFn({ method: "POST" })
  .validator(releaseGearHoldInputSchema)
  .handler(async ({ data }): Promise<ReleaseGearHoldResult> => {
    const { releaseGearHoldAction } =
      await import("#/features/gear/server/holds-actions.server");
    return releaseGearHoldAction(data);
  });

// ── attribute definitions ──────────────────────────────────────────────

export type { GearModelSummaryDto, GearModelBrowseDto };

export const listGearModelBrowseFn = createServerFn({ method: "GET" })
  .validator(listGearModelBrowseInputSchema)
  .handler(async ({ data }): Promise<GearModelBrowseDto[]> => {
    const { listGearModelBrowseAction } =
      await import("#/features/gear/server/models-actions.server");
    return listGearModelBrowseAction(data);
  });

export type {
  CreateGearAttributeDefInput,
  CreateGearAttributeDefResult,
  DeleteGearAttributeDefResult,
  GearAttributeDefSummary,
  ListGearAttributeDefsActionInput,
  UpdateGearAttributeDefInput,
  UpdateGearAttributeDefResult,
};

export const listGearAttributeDefsFn = createServerFn({ method: "GET" })
  .validator(listGearAttributeDefsInputSchema)
  .handler(async ({ data }): Promise<GearAttributeDefSummary[]> => {
    const { listGearAttributeDefsAction } =
      await import("#/features/gear/server/attributes-actions.server");
    return listGearAttributeDefsAction(data);
  });

export const createGearAttributeDefFn = createServerFn({ method: "POST" })
  .validator(createGearAttributeDefInputSchema)
  .handler(async ({ data }): Promise<CreateGearAttributeDefResult> => {
    const { createGearAttributeDefAction } =
      await import("#/features/gear/server/attributes-actions.server");
    return createGearAttributeDefAction(data);
  });

export const updateGearAttributeDefFn = createServerFn({ method: "POST" })
  .validator(updateGearAttributeDefInputSchema)
  .handler(async ({ data }): Promise<UpdateGearAttributeDefResult> => {
    const { updateGearAttributeDefAction } =
      await import("#/features/gear/server/attributes-actions.server");
    return updateGearAttributeDefAction(data);
  });

export const deleteGearAttributeDefFn = createServerFn({ method: "POST" })
  .validator(deleteGearAttributeDefInputSchema)
  .handler(async ({ data }): Promise<DeleteGearAttributeDefResult> => {
    const { deleteGearAttributeDefAction } =
      await import("#/features/gear/server/attributes-actions.server");
    return deleteGearAttributeDefAction(data);
  });

export type { BulkResult };

export const bulkDeactivateGearFn = createServerFn({ method: "POST" })
  .validator(bulkDeactivateInputSchema)
  .handler(async ({ data }): Promise<BulkResult> => {
    const { bulkDeactivateGearAction } =
      await import("#/features/gear/server/gear-bulk-actions.server");
    return bulkDeactivateGearAction(data);
  });

export const bulkReactivateGearFn = createServerFn({ method: "POST" })
  .validator(bulkReactivateInputSchema)
  .handler(async ({ data }): Promise<BulkResult> => {
    const { bulkReactivateGearAction } =
      await import("#/features/gear/server/gear-bulk-actions.server");
    return bulkReactivateGearAction(data);
  });

export const bulkSetGearItemConditionFn = createServerFn({ method: "POST" })
  .validator(bulkSetConditionInputSchema)
  .handler(async ({ data }): Promise<BulkResult> => {
    const { bulkSetGearItemConditionAction } =
      await import("#/features/gear/server/gear-bulk-actions.server");
    return bulkSetGearItemConditionAction(data);
  });

export const bulkAddGearItemTagsFn = createServerFn({ method: "POST" })
  .validator(bulkAddTagsInputSchema)
  .handler(async ({ data }): Promise<BulkResult> => {
    const { bulkAddGearItemTagsAction } =
      await import("#/features/gear/server/gear-bulk-actions.server");
    return bulkAddGearItemTagsAction(data);
  });

export const listGearInspectionsFn = createServerFn({ method: "GET" })
  .validator(listGearInspectionsInputSchema)
  .handler(async ({ data }): Promise<GearInspectionSummary[]> => {
    const { listGearInspectionsAction } =
      await import("#/features/gear/server/gear-inspections-actions.server");
    return listGearInspectionsAction(data);
  });

export const recordGearInspectionFn = createServerFn({ method: "POST" })
  .validator(recordGearInspectionInputSchema)
  .handler(async ({ data }): Promise<RecordGearInspectionResult> => {
    const { recordGearInspectionAction } =
      await import("#/features/gear/server/gear-inspections-actions.server");
    return recordGearInspectionAction(data);
  });

export const bulkImportGearFn = createServerFn({ method: "POST" })
  .validator(bulkImportInputSchema)
  .handler(async ({ data }): Promise<BulkImportResult> => {
    const { bulkImportGearAction } =
      await import("#/features/gear/server/gear-bulk-import-actions.server");
    return bulkImportGearAction(data);
  });

// ── loan shells ────────────────────────────────────────────────────────

export const checkoutLoansFn = createServerFn({ method: "POST" })
  .validator(checkoutLoansInputSchema)
  .handler(async ({ data }): Promise<CheckoutLoansResult> => {
    const { checkoutLoansAction } =
      await import("#/features/gear/server/loans-actions.server");
    return checkoutLoansAction(data);
  });

export const checkinLoansFn = createServerFn({ method: "POST" })
  .validator(checkinLoansInputSchema)
  .handler(async ({ data }): Promise<CheckinLoansResult> => {
    const { checkinLoansAction } =
      await import("#/features/gear/server/loans-actions.server");
    return checkinLoansAction(data);
  });

export const bulkImportLoansFn = createServerFn({ method: "POST" })
  .validator(bulkImportLoansInputSchema)
  .handler(async ({ data }): Promise<BulkImportLoansResult> => {
    const { bulkImportLoansAction } =
      await import("#/features/gear/server/loans-bulk-import-actions.server");
    return bulkImportLoansAction(data);
  });

export const extendLoanFn = createServerFn({ method: "POST" })
  .validator(extendLoanInputSchema)
  .handler(async ({ data }): Promise<ExtendLoanResult> => {
    const { extendLoanAction } =
      await import("#/features/gear/server/loans-actions.server");
    return extendLoanAction(data);
  });

export const listLoansFn = createServerFn({ method: "GET" })
  .validator(listLoansInputSchema)
  .handler(async ({ data }): Promise<ListLoansActionResult> => {
    const { listLoansAction } =
      await import("#/features/gear/server/loans-actions.server");
    return listLoansAction(data);
  });

export const getLoanDetailFn = createServerFn({ method: "GET" })
  .validator(loanDetailInputSchema)
  .handler(async ({ data }): Promise<LoanDetail> => {
    const { getLoanDetailAction } =
      await import("#/features/gear/server/loans-actions.server");
    return getLoanDetailAction(data);
  });

export const listMyLoansFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<MyLoansResult> => {
    const { listMyLoansAction } =
      await import("#/features/gear/server/loans-actions.server");
    return listMyLoansAction();
  },
);

export const searchMembersForLoanFn = createServerFn({ method: "GET" })
  .validator(memberSearchInputSchema)
  .handler(async ({ data }): Promise<MemberSearchResult[]> => {
    const { searchMembersForLoanAction } =
      await import("#/features/gear/server/loans-actions.server");
    return searchMembersForLoanAction(data);
  });

export const getMemberForLoanFn = createServerFn({ method: "GET" })
  .validator(memberByPublicIdInputSchema)
  .handler(async ({ data }): Promise<MemberSearchResult | null> => {
    const { getMemberForLoanAction } =
      await import("#/features/gear/server/loans-actions.server");
    return getMemberForLoanAction(data);
  });

export const searchItemsByCodeFn = createServerFn({ method: "GET" })
  .validator(gearCodeSearchInputSchema)
  .handler(async ({ data }): Promise<GearLookupRow[]> => {
    const { searchItemsByCodeAction } =
      await import("#/features/gear/server/loans-actions.server");
    return searchItemsByCodeAction(data);
  });

export const getItemByCodeFn = createServerFn({ method: "GET" })
  .validator(gearByCodeInputSchema)
  .handler(async ({ data }): Promise<GearLookupRow | null> => {
    const { getItemByCodeAction } =
      await import("#/features/gear/server/loans-actions.server");
    return getItemByCodeAction(data);
  });

// ── cart shells ────────────────────────────────────────────────────────

const cartGearInputSchema = z.object({
  gearPublicId: z.string().min(1),
});

// Token is small — a `ucmc-cart:` prefix plus a UUID. 200 chars is
// generous and guards against pathological scanner payloads being
// stuffed straight into KV.
const resolveCartTokenInputSchema = z.object({
  token: z.string().min(1).max(200),
});

export const getMyCartFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<MyCartResult> => {
    const { getMyCartAction } =
      await import("#/features/gear/server/cart-actions.server");
    return getMyCartAction();
  },
);

export const addToCartFn = createServerFn({ method: "POST" })
  .validator(cartGearInputSchema)
  .handler(async ({ data }): Promise<AddToCartResult> => {
    const { addToCartAction } =
      await import("#/features/gear/server/cart-actions.server");
    return addToCartAction(data);
  });

export const removeFromCartFn = createServerFn({ method: "POST" })
  .validator(cartGearInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { removeFromCartAction } =
      await import("#/features/gear/server/cart-actions.server");
    return removeFromCartAction(data);
  });

export const clearCartFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    const { clearCartAction } =
      await import("#/features/gear/server/cart-actions.server");
    return clearCartAction();
  },
);

export const mintCartTokenFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<MintCartTokenResult> => {
    const { mintCartTokenAction } =
      await import("#/features/gear/server/cart-actions.server");
    return mintCartTokenAction();
  },
);

export const resolveCartTokenFn = createServerFn({ method: "POST" })
  .validator(resolveCartTokenInputSchema)
  .handler(async ({ data }): Promise<ResolveCartTokenResult> => {
    const { resolveCartTokenAction } =
      await import("#/features/gear/server/cart-actions.server");
    return resolveCartTokenAction(data);
  });

// ── gear models ─────────────────────────────────────────────────────────

const listGearModelsInputSchema = z.object({
  typePublicId: z.string().min(1).optional(),
});

const gearModelInputSchema = z.object({
  typePublicId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  manufacturer: z.string().trim().max(100).nullable(),
  tracking: z.enum(GEAR_TRACKING_VALUES),
  description: z.string().max(1000).nullable(),
  msrpCents: z.number().int().min(0).nullable(),
  serviceLifeYears: z.number().int().min(1).max(100).nullable(),
  inspectionIntervalDays: z.number().int().min(1).max(3650).nullable(),
  // Scheme-restricted: `z.url()` alone accepts `javascript:` and
  // `data:`, and `gear:manage` is delegable — see the public-pages rule.
  productUrl: z
    .string()
    .trim()
    .max(500)
    .regex(/^https?:\/\//, "must be an http(s) URL")
    .nullable(),
  attributes: attributeValueInputSchema.optional(),
});

export const listGearModelsFn = createServerFn({ method: "GET" })
  .validator(listGearModelsInputSchema)
  .handler(async ({ data }): Promise<GearModelSummaryDto[]> => {
    const { listGearModelsAction } =
      await import("#/features/gear/server/models-actions.server");
    return listGearModelsAction(data);
  });

export const createGearModelFn = createServerFn({ method: "POST" })
  .validator(gearModelInputSchema)
  .handler(async ({ data }): Promise<CreateGearModelResult> => {
    const { createGearModelAction } =
      await import("#/features/gear/server/models-actions.server");
    return createGearModelAction(data);
  });

export const updateGearModelFn = createServerFn({ method: "POST" })
  .validator(
    // `typePublicId` is omitted rather than merely ignored — see
    // `UpdateGearModelInput`. Accepting a field the action drops reads
    // as a supported type change that silently does nothing.
    gearModelInputSchema
      .omit({ typePublicId: true })
      .partial()
      .extend({
        publicId: z.string().min(1),
      }),
  )
  .handler(async ({ data }): Promise<UpdateGearModelResult> => {
    const { updateGearModelAction } =
      await import("#/features/gear/server/models-actions.server");
    return updateGearModelAction(data);
  });

export const deleteGearModelFn = createServerFn({ method: "POST" })
  .validator(z.object({ publicId: z.string().min(1) }))
  .handler(async ({ data }): Promise<DeleteGearModelResult> => {
    const { deleteGearModelAction } =
      await import("#/features/gear/server/models-actions.server");
    return deleteGearModelAction(data);
  });
