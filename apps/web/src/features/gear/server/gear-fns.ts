/**
 * Route-facing shells for gear server fns. Each handler body is a
 * one-line dynamic import of the action it delegates to, keeping
 * server-only code (DB access, audit recorder) off the client bundle.
 *
 * Input schemas use zod and are referenced by route loaders for
 * validateSearch / queryOptions input typing.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
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
  RetireGearResult,
} from "#/features/gear/server/gear-actions.server";
import type {
  CreateGearTypeInput,
  CreateGearTypeResult,
  DeleteGearTypeResult,
  EditGearTypeInput,
  EditGearTypeResult,
} from "#/features/gear/server/gear-types-actions.server";
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
  ExtendLoanResult,
  GearLookupRow,
  ListLoansActionInput,
  ListLoansActionResult,
  LoanDetail,
  LoanSummary,
} from "#/features/gear/server/loans-actions.server";
import type { MemberSearchResult } from "#/features/gear/server/loans-repo.server";

// ── bulk multi-select handlers ─────────────────────────────────────────

import type { BulkResult } from "#/features/gear/server/gear-bulk-actions.server";

// Mirror of the gear enums in `drizzle/schema.ts`. Re-declared here so
// route loaders and form components can validate filter / submit shapes
// without pulling the whole schema file into the client bundle. Keep in
// sync with `drizzle/schema.ts` — the schema is the database-side
// source of truth.
export const GEAR_LIFECYCLE_VALUES = ["active", "retired"] as const;
export type GearLifecycle = (typeof GEAR_LIFECYCLE_VALUES)[number];

export const GEAR_CONDITION_VALUES = [
  "serviceable",
  "needs_repair",
  "missing",
  "lost",
] as const;
export type GearCondition = (typeof GEAR_CONDITION_VALUES)[number];

export const GEAR_CONDITION_GRADE_VALUES = [
  "excellent",
  "good",
  "fair",
] as const;
export type GearConditionGrade = (typeof GEAR_CONDITION_GRADE_VALUES)[number];

export const GEAR_INSPECTION_RESULT_VALUES = [
  "pass",
  "fail",
  "advisory",
] as const;
export type GearInspectionResultValue =
  (typeof GEAR_INSPECTION_RESULT_VALUES)[number];

export type {
  BulkImportInput,
  BulkImportResult,
  BulkImportSkipped,
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
  ExtendLoanResult,
  GearLookupRow,
  ListLoansActionInput,
  ListLoansActionResult,
  LoanDetail,
  LoanSummary,
  MemberSearchResult,
  RecordGearInspectionInput,
  RecordGearInspectionResult,
  RetireGearResult,
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
  tagPublicIds: z.array(z.string().min(1)).optional(),
  lifecycle: z.enum(GEAR_LIFECYCLE_VALUES).optional(),
  condition: z.enum(GEAR_CONDITION_VALUES).optional(),
  q: z.string().max(200).optional(),
  sort: z.enum(["code", "created_at", "updated_at"]).optional(),
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(1).max(250).optional(),
});

// Thumbnail data URL — capped at ~600 KB so the encoded base64 fits
// inside the worker request budget (~1 MiB) even with overhead.
const thumbnailDataUrlSchema = z
  .string()
  .max(600 * 1024)
  .regex(/^data:image\/(webp|jpeg|png);base64,/, "Invalid image data URL");

export const createGearInputSchema = z.object({
  typePublicId: z.string().min(1),
  code: z.string().max(64).nullable(),
  // Description is the primary heading on the gear card — required end
  // to end. `.trim()` before `.min(1)` so whitespace-only strings fail.
  description: z.string().trim().min(1, "Description is required").max(500),
  // null = no thumbnail (omit on create).
  thumbnailDataUrl: thumbnailDataUrlSchema.nullable(),
  acquiredAt: acquiredAtSchema,
  acquisitionCostCents: z.number().int().min(0).nullable(),
  // Optional on the wire — omit means "unknown / not provided" on
  // create, and "no change" on edit. The action normalizes undefined
  // to null at the boundary.
  msrpCents: z.number().int().min(0).nullable().optional(),
  manufacturer: z.string().trim().max(100).nullable().optional(),
  serialNumber: z.string().trim().max(100).nullable().optional(),
  conditionGrade: z.enum(GEAR_CONDITION_GRADE_VALUES).nullable().optional(),
  notesMarkdown: z.string().max(10_000).nullable(),
  condition: z.enum(GEAR_CONDITION_VALUES),
  tagPublicIds: z.array(z.string().min(1)),
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

const retireGearInputSchema = z.object({
  publicId: z.string().min(1),
  reason: z.string().max(500).nullable(),
});

const unretireGearInputSchema = z.object({
  publicId: z.string().min(1),
});

const gearTypeInputSchema = z.object({
  name: z.string().min(1).max(80),
  prefix: z.string().max(8).nullable(),
  description: z.string().max(500).nullable(),
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

// ── multi-select bulk-action input schemas ─────────────────────────────

const publicIdArraySchema = z.array(z.string().min(1)).min(1).max(500);

const bulkRetireInputSchema = z.object({
  publicIds: publicIdArraySchema,
  reason: z.string().max(500).nullable(),
});

const bulkUnretireInputSchema = z.object({
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
        typePublicId: z.string().min(1),
        code: z.string().max(64).nullable(),
        // Required at the wire level. The action also re-checks and
        // skips with `missing_description` for any row that slipped
        // through the client validation.
        description: z.string().max(500),
        acquiredAt: acquiredAtSchema,
        acquisitionCostCents: z.number().int().min(0).nullable(),
      }),
    )
    .min(1)
    .max(500),
});

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

const conditionSchema = z.enum([
  "serviceable",
  "needs_repair",
  "missing",
  "lost",
]);

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
  .inputValidator(listGearInputSchema)
  .handler(async ({ data }): Promise<ListGearActionResult> => {
    const { listGearAction } =
      await import("#/features/gear/server/gear-actions.server");
    return listGearAction(data);
  });

export const listGearLabelsFn = createServerFn({ method: "GET" })
  .inputValidator(listGearLabelsInputSchema)
  .handler(async ({ data }): Promise<GearLabel[]> => {
    const { listGearLabelsAction } =
      await import("#/features/gear/server/gear-actions.server");
    return listGearLabelsAction(data);
  });

export const getGearDetailFn = createServerFn({ method: "GET" })
  .inputValidator(gearDetailInputSchema)
  .handler(async ({ data }): Promise<GearDetail> => {
    const { getGearDetailAction } =
      await import("#/features/gear/server/gear-actions.server");
    return getGearDetailAction(data);
  });

export const createGearFn = createServerFn({ method: "POST" })
  .inputValidator(createGearInputSchema)
  .handler(async ({ data }): Promise<CreateGearResult> => {
    const { createGearAction } =
      await import("#/features/gear/server/gear-actions.server");
    return createGearAction(data);
  });

export const editGearFn = createServerFn({ method: "POST" })
  .inputValidator(editGearInputSchema)
  .handler(async ({ data }): Promise<EditGearResult> => {
    const { editGearAction } =
      await import("#/features/gear/server/gear-actions.server");
    return editGearAction(data);
  });

export const retireGearFn = createServerFn({ method: "POST" })
  .inputValidator(retireGearInputSchema)
  .handler(async ({ data }): Promise<RetireGearResult> => {
    const { retireGearAction } =
      await import("#/features/gear/server/gear-actions.server");
    return retireGearAction(data);
  });

export const unretireGearFn = createServerFn({ method: "POST" })
  .inputValidator(unretireGearInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { unretireGearAction } =
      await import("#/features/gear/server/gear-actions.server");
    return unretireGearAction(data);
  });

export const suggestCodeForTypeFn = createServerFn({ method: "GET" })
  .inputValidator(suggestCodeInputSchema)
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
  .inputValidator(gearTypeInputSchema)
  .handler(async ({ data }): Promise<CreateGearTypeResult> => {
    const { createGearTypeAction } =
      await import("#/features/gear/server/gear-types-actions.server");
    return createGearTypeAction(data);
  });

export const editGearTypeFn = createServerFn({ method: "POST" })
  .inputValidator(editGearTypeInputSchema)
  .handler(async ({ data }): Promise<EditGearTypeResult> => {
    const { editGearTypeAction } =
      await import("#/features/gear/server/gear-types-actions.server");
    return editGearTypeAction(data);
  });

export const deleteGearTypeFn = createServerFn({ method: "POST" })
  .inputValidator(deleteGearTypeInputSchema)
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
  .inputValidator(gearTagInputSchema)
  .handler(async ({ data }): Promise<CreateGearTagResult> => {
    const { createGearTagAction } =
      await import("#/features/gear/server/gear-tags-actions.server");
    return createGearTagAction(data);
  });

export const editGearTagFn = createServerFn({ method: "POST" })
  .inputValidator(editGearTagInputSchema)
  .handler(async ({ data }): Promise<EditGearTagResult> => {
    const { editGearTagAction } =
      await import("#/features/gear/server/gear-tags-actions.server");
    return editGearTagAction(data);
  });

export const deleteGearTagFn = createServerFn({ method: "POST" })
  .inputValidator(deleteGearTagInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteGearTagAction } =
      await import("#/features/gear/server/gear-tags-actions.server");
    return deleteGearTagAction(data);
  });

export type { BulkResult };

export const bulkRetireGearFn = createServerFn({ method: "POST" })
  .inputValidator(bulkRetireInputSchema)
  .handler(async ({ data }): Promise<BulkResult> => {
    const { bulkRetireGearAction } =
      await import("#/features/gear/server/gear-bulk-actions.server");
    return bulkRetireGearAction(data);
  });

export const bulkUnretireGearFn = createServerFn({ method: "POST" })
  .inputValidator(bulkUnretireInputSchema)
  .handler(async ({ data }): Promise<BulkResult> => {
    const { bulkUnretireGearAction } =
      await import("#/features/gear/server/gear-bulk-actions.server");
    return bulkUnretireGearAction(data);
  });

export const bulkSetGearConditionFn = createServerFn({ method: "POST" })
  .inputValidator(bulkSetConditionInputSchema)
  .handler(async ({ data }): Promise<BulkResult> => {
    const { bulkSetGearConditionAction } =
      await import("#/features/gear/server/gear-bulk-actions.server");
    return bulkSetGearConditionAction(data);
  });

export const bulkAddGearTagsFn = createServerFn({ method: "POST" })
  .inputValidator(bulkAddTagsInputSchema)
  .handler(async ({ data }): Promise<BulkResult> => {
    const { bulkAddGearTagsAction } =
      await import("#/features/gear/server/gear-bulk-actions.server");
    return bulkAddGearTagsAction(data);
  });

export const listGearInspectionsFn = createServerFn({ method: "GET" })
  .inputValidator(listGearInspectionsInputSchema)
  .handler(async ({ data }): Promise<GearInspectionSummary[]> => {
    const { listGearInspectionsAction } =
      await import("#/features/gear/server/gear-inspections-actions.server");
    return listGearInspectionsAction(data);
  });

export const recordGearInspectionFn = createServerFn({ method: "POST" })
  .inputValidator(recordGearInspectionInputSchema)
  .handler(async ({ data }): Promise<RecordGearInspectionResult> => {
    const { recordGearInspectionAction } =
      await import("#/features/gear/server/gear-inspections-actions.server");
    return recordGearInspectionAction(data);
  });

export const bulkImportGearFn = createServerFn({ method: "POST" })
  .inputValidator(bulkImportInputSchema)
  .handler(async ({ data }): Promise<BulkImportResult> => {
    const { bulkImportGearAction } =
      await import("#/features/gear/server/gear-bulk-import-actions.server");
    return bulkImportGearAction(data);
  });

// ── loan shells ────────────────────────────────────────────────────────

export const checkoutLoansFn = createServerFn({ method: "POST" })
  .inputValidator(checkoutLoansInputSchema)
  .handler(async ({ data }): Promise<CheckoutLoansResult> => {
    const { checkoutLoansAction } =
      await import("#/features/gear/server/loans-actions.server");
    return checkoutLoansAction(data);
  });

export const checkinLoansFn = createServerFn({ method: "POST" })
  .inputValidator(checkinLoansInputSchema)
  .handler(async ({ data }): Promise<CheckinLoansResult> => {
    const { checkinLoansAction } =
      await import("#/features/gear/server/loans-actions.server");
    return checkinLoansAction(data);
  });

export const bulkImportLoansFn = createServerFn({ method: "POST" })
  .inputValidator(bulkImportLoansInputSchema)
  .handler(async ({ data }): Promise<BulkImportLoansResult> => {
    const { bulkImportLoansAction } =
      await import("#/features/gear/server/loans-bulk-import-actions.server");
    return bulkImportLoansAction(data);
  });

export const extendLoanFn = createServerFn({ method: "POST" })
  .inputValidator(extendLoanInputSchema)
  .handler(async ({ data }): Promise<ExtendLoanResult> => {
    const { extendLoanAction } =
      await import("#/features/gear/server/loans-actions.server");
    return extendLoanAction(data);
  });

export const listLoansFn = createServerFn({ method: "GET" })
  .inputValidator(listLoansInputSchema)
  .handler(async ({ data }): Promise<ListLoansActionResult> => {
    const { listLoansAction } =
      await import("#/features/gear/server/loans-actions.server");
    return listLoansAction(data);
  });

export const getLoanDetailFn = createServerFn({ method: "GET" })
  .inputValidator(loanDetailInputSchema)
  .handler(async ({ data }): Promise<LoanDetail> => {
    const { getLoanDetailAction } =
      await import("#/features/gear/server/loans-actions.server");
    return getLoanDetailAction(data);
  });

export const listMyLoansFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ active: LoanSummary[]; history: LoanSummary[] }> => {
    const { listMyLoansAction } =
      await import("#/features/gear/server/loans-actions.server");
    return listMyLoansAction();
  },
);

export const searchMembersForLoanFn = createServerFn({ method: "GET" })
  .inputValidator(memberSearchInputSchema)
  .handler(async ({ data }): Promise<MemberSearchResult[]> => {
    const { searchMembersForLoanAction } =
      await import("#/features/gear/server/loans-actions.server");
    return searchMembersForLoanAction(data);
  });

export const getMemberForLoanFn = createServerFn({ method: "GET" })
  .inputValidator(memberByPublicIdInputSchema)
  .handler(async ({ data }): Promise<MemberSearchResult | null> => {
    const { getMemberForLoanAction } =
      await import("#/features/gear/server/loans-actions.server");
    return getMemberForLoanAction(data);
  });

export const searchGearByCodeFn = createServerFn({ method: "GET" })
  .inputValidator(gearCodeSearchInputSchema)
  .handler(async ({ data }): Promise<GearLookupRow[]> => {
    const { searchGearByCodeAction } =
      await import("#/features/gear/server/loans-actions.server");
    return searchGearByCodeAction(data);
  });

export const getGearByCodeFn = createServerFn({ method: "GET" })
  .inputValidator(gearByCodeInputSchema)
  .handler(async ({ data }): Promise<GearLookupRow | null> => {
    const { getGearByCodeAction } =
      await import("#/features/gear/server/loans-actions.server");
    return getGearByCodeAction(data);
  });
