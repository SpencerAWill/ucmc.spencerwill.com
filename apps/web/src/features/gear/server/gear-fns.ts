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
  CreateGearInput,
  CreateGearResult,
  EditGearInput,
  EditGearResult,
  GearDetail,
  GearSummary,
  GearTagSummary,
  GearTypeSummary,
  ListGearActionInput,
  ListGearActionResult,
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

export type {
  BulkImportInput,
  BulkImportResult,
  BulkImportSkipped,
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
  GearSummary,
  GearTagSummary,
  GearTypeSummary,
  ListGearActionInput,
  ListGearActionResult,
};

// ── input schemas ───────────────────────────────────────────────────────

// Dates ride the wire as ms-since-epoch numbers (or null) and the
// action converts at the boundary. Keeping the schema input shape
// JSON-native — no `.transform()` — means `createServerFn`'s `data`
// type stays serializable, which is what client-side hooks consume.
const acquiredAtSchema = z.number().int().nullable();

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

const createGearInputSchema = z.object({
  typePublicId: z.string().min(1),
  code: z.string().max(64).nullable(),
  // Description is the primary heading on the gear card — required end
  // to end. `.trim()` before `.min(1)` so whitespace-only strings fail.
  description: z.string().trim().min(1, "Description is required").max(500),
  // null = no thumbnail (omit on create).
  thumbnailDataUrl: thumbnailDataUrlSchema.nullable(),
  acquiredAt: acquiredAtSchema,
  acquisitionCostCents: z.number().int().min(0).nullable(),
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

const gearTagInputSchema = z.object({
  name: z.string().min(1).max(40),
});

const editGearTagInputSchema = z.object({
  publicId: z.string().min(1),
  name: z.string().min(1).max(40),
});

const deleteGearTagInputSchema = z.object({
  publicId: z.string().min(1),
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

const suggestCodeInputSchema = z.object({
  typePublicId: z.string().min(1),
});

const gearDetailInputSchema = z.object({
  publicId: z.string().min(1),
});

// ── server fn handlers ──────────────────────────────────────────────────

export const listGearFn = createServerFn({ method: "GET" })
  .inputValidator(listGearInputSchema)
  .handler(async ({ data }): Promise<ListGearActionResult> => {
    const { listGearAction } =
      await import("#/features/gear/server/gear-actions.server");
    return listGearAction(data);
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
  .handler(async ({ data }): Promise<{ ok: true }> => {
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

export const bulkImportGearFn = createServerFn({ method: "POST" })
  .inputValidator(bulkImportInputSchema)
  .handler(async ({ data }): Promise<BulkImportResult> => {
    const { bulkImportGearAction } =
      await import("#/features/gear/server/gear-bulk-import-actions.server");
    return bulkImportGearAction(data);
  });
