/**
 * Route-facing shells for landing-page server fns. Each handler dynamic-
 * imports its action from `./landing-actions.server` so server-only code
 * never reaches the client bundle. Type-only imports of action types are
 * fine — they're erased at compile time.
 */
import { createServerFn } from "@tanstack/react-start";

import type {
  ActivitySummary,
  FaqItemSummary,
  HeroSlideSummary,
  LandingContent,
} from "#/features/landing/server/landing-actions.server";
import {
  activityInputSchema,
  activityUpdateInputSchema,
  createHeroSlideInputSchema,
  faqInputSchema,
  faqUpdateInputSchema,
  idInputSchema,
  reorderInputSchema,
  setSectionImageInputSchema,
  updateHeroSlideInputSchema,
  updateSettingInputSchema,
} from "#/features/landing/server/landing-schemas";

export type {
  ActivitySummary,
  FaqItemSummary,
  HeroSlideSummary,
  LandingContent,
};

// ── Read (anonymous-safe) ───────────────────────────────────────────────

export const getLandingContentFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<LandingContent> => {
    const { getLandingContentAction } =
      await import("#/features/landing/server/landing-actions.server");
    return getLandingContentAction();
  },
);

// ── Settings ────────────────────────────────────────────────────────────

export const updateLandingSettingFn = createServerFn({ method: "POST" })
  .inputValidator(updateSettingInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateSettingAction } =
      await import("#/features/landing/server/landing-actions.server");
    return updateSettingAction(data);
  });

// ── Hero slides ─────────────────────────────────────────────────────────

export const createHeroSlideFn = createServerFn({ method: "POST" })
  .inputValidator(createHeroSlideInputSchema)
  .handler(async ({ data }): Promise<{ id: string; imageKey: string }> => {
    const { createHeroSlideAction } =
      await import("#/features/landing/server/landing-actions.server");
    return createHeroSlideAction(data);
  });

export const updateHeroSlideFn = createServerFn({ method: "POST" })
  .inputValidator(updateHeroSlideInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateHeroSlideAction } =
      await import("#/features/landing/server/landing-actions.server");
    return updateHeroSlideAction(data);
  });

export const deleteHeroSlideFn = createServerFn({ method: "POST" })
  .inputValidator(idInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteHeroSlideAction } =
      await import("#/features/landing/server/landing-actions.server");
    return deleteHeroSlideAction(data);
  });

export const reorderHeroSlidesFn = createServerFn({ method: "POST" })
  .inputValidator(reorderInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { reorderHeroSlidesAction } =
      await import("#/features/landing/server/landing-actions.server");
    return reorderHeroSlidesAction(data);
  });

// ── FAQ ─────────────────────────────────────────────────────────────────

export const createFaqItemFn = createServerFn({ method: "POST" })
  .inputValidator(faqInputSchema)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { createFaqItemAction } =
      await import("#/features/landing/server/landing-actions.server");
    return createFaqItemAction(data);
  });

export const updateFaqItemFn = createServerFn({ method: "POST" })
  .inputValidator(faqUpdateInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateFaqItemAction } =
      await import("#/features/landing/server/landing-actions.server");
    return updateFaqItemAction(data);
  });

export const deleteFaqItemFn = createServerFn({ method: "POST" })
  .inputValidator(idInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteFaqItemAction } =
      await import("#/features/landing/server/landing-actions.server");
    return deleteFaqItemAction(data);
  });

export const reorderFaqItemsFn = createServerFn({ method: "POST" })
  .inputValidator(reorderInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { reorderFaqItemsAction } =
      await import("#/features/landing/server/landing-actions.server");
    return reorderFaqItemsAction(data);
  });

// ── Activities ──────────────────────────────────────────────────────────

export const createActivityFn = createServerFn({ method: "POST" })
  .inputValidator(activityInputSchema)
  .handler(
    async ({ data }): Promise<{ id: string; imageKey: string | null }> => {
      const { createActivityAction } =
        await import("#/features/landing/server/landing-actions.server");
      return createActivityAction(data);
    },
  );

// ── Section-singleton images ────────────────────────────────────────────

export const setAboutImageFn = createServerFn({ method: "POST" })
  .inputValidator(setSectionImageInputSchema)
  .handler(async ({ data }): Promise<{ ok: true; imageKey: string }> => {
    const { setAboutImageAction } =
      await import("#/features/landing/server/landing-actions.server");
    return setAboutImageAction(data);
  });

export const removeAboutImageFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    const { removeAboutImageAction } =
      await import("#/features/landing/server/landing-actions.server");
    return removeAboutImageAction();
  },
);

export const setMeetingImageFn = createServerFn({ method: "POST" })
  .inputValidator(setSectionImageInputSchema)
  .handler(async ({ data }): Promise<{ ok: true; imageKey: string }> => {
    const { setMeetingImageAction } =
      await import("#/features/landing/server/landing-actions.server");
    return setMeetingImageAction(data);
  });

export const removeMeetingImageFn = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    const { removeMeetingImageAction } =
      await import("#/features/landing/server/landing-actions.server");
    return removeMeetingImageAction();
  },
);

export const updateActivityFn = createServerFn({ method: "POST" })
  .inputValidator(activityUpdateInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateActivityAction } =
      await import("#/features/landing/server/landing-actions.server");
    return updateActivityAction(data);
  });

export const deleteActivityFn = createServerFn({ method: "POST" })
  .inputValidator(idInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteActivityAction } =
      await import("#/features/landing/server/landing-actions.server");
    return deleteActivityAction(data);
  });

export const reorderActivitiesFn = createServerFn({ method: "POST" })
  .inputValidator(reorderInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { reorderActivitiesAction } =
      await import("#/features/landing/server/landing-actions.server");
    return reorderActivitiesAction(data);
  });
