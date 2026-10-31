/**
 * Server fn shell for the termination notice on `/deactivated`. The
 * handler dynamic-imports its action; see
 * `./termination-notice-actions.server.ts` for who it answers.
 */
import { createServerFn } from "@tanstack/react-start";

import type { TerminationNotice } from "#/features/conduct/server/termination-notice-actions.server";

export type { TerminationNotice };

export const getMyTerminationNoticeFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<TerminationNotice | null> => {
  const { getMyTerminationNoticeAction } =
    await import("#/features/conduct/server/termination-notice-actions.server");
  return getMyTerminationNoticeAction();
});
