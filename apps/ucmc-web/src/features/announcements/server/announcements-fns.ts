/**
 * Route-facing shells for announcements server fns. Each handler dynamic-
 * imports its action from `./announcements-actions.server` so server-only
 * code never reaches the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { AnnouncementSummary } from "#/features/announcements/server/announcements-actions.server";
import {
  announcementInputSchema,
  announcementUpdateInputSchema,
} from "#/features/announcements/server/limits";

export type { AnnouncementSummary };

export const listAnnouncementsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<AnnouncementSummary[]> => {
    const { listAnnouncementsAction } =
      await import("#/features/announcements/server/announcements-actions.server");
    return listAnnouncementsAction();
  },
);

export const unreadAnnouncementsCountFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<{ count: number }> => {
  const { getUnreadCountAction } =
    await import("#/features/announcements/server/announcements-actions.server");
  return getUnreadCountAction();
});

export const markAnnouncementsReadFn = createServerFn({
  method: "POST",
}).handler(async (): Promise<{ ok: true }> => {
  const { markAnnouncementsReadAction } =
    await import("#/features/announcements/server/announcements-actions.server");
  return markAnnouncementsReadAction();
});

export const createAnnouncementFn = createServerFn({ method: "POST" })
  .inputValidator(announcementInputSchema)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { createAnnouncementAction } =
      await import("#/features/announcements/server/announcements-actions.server");
    return createAnnouncementAction(data);
  });

export const updateAnnouncementFn = createServerFn({ method: "POST" })
  .inputValidator(announcementUpdateInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateAnnouncementAction } =
      await import("#/features/announcements/server/announcements-actions.server");
    return updateAnnouncementAction(data);
  });

export const deleteAnnouncementFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteAnnouncementAction } =
      await import("#/features/announcements/server/announcements-actions.server");
    return deleteAnnouncementAction(data);
  });
