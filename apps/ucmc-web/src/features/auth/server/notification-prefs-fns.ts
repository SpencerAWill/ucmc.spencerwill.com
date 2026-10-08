/**
 * Route-facing shells for the caller's own notification preferences:
 * list / set one.
 *
 * Each handler dynamic-imports its action so the D1 and cookie code
 * never reaches the client bundle. Result types live here so the
 * preferences tab and its mutation hook can reference them without
 * touching a `.server.ts` module.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type {
  ListMyNotificationPreferencesResult,
  SetMyNotificationPreferenceResult,
} from "#/features/auth/server/notification-prefs-actions.server";

export type {
  ListMyNotificationPreferencesResult,
  NotificationPreferenceRow,
  SetMyNotificationPreferenceResult,
} from "#/features/auth/server/notification-prefs-actions.server";

// The category is validated as a plain string here and resolved against
// the registry inside the action. A zod enum built from the registry
// would put the category list in the client bundle for no gain — and the
// action has to re-check anyway, since it is also the thing that refuses
// a write to a non-suppressible category.
const setPreferenceInputSchema = z.object({
  category: z.string().min(1).max(100),
  enabled: z.boolean(),
});

export const listMyNotificationPreferencesFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<ListMyNotificationPreferencesResult> => {
  const { listMyNotificationPreferencesAction } =
    await import("#/features/auth/server/notification-prefs-actions.server");
  return listMyNotificationPreferencesAction();
});

export const setMyNotificationPreferenceFn = createServerFn({ method: "POST" })
  .validator(setPreferenceInputSchema)
  .handler(async ({ data }): Promise<SetMyNotificationPreferenceResult> => {
    const { setMyNotificationPreferenceAction } =
      await import("#/features/auth/server/notification-prefs-actions.server");
    return setMyNotificationPreferenceAction(data);
  });
