/**
 * Route-facing shells for /history server fns. The handler body
 * dynamic-imports the action so server-only modules never reach the
 * client bundle.
 */
import { createServerFn } from "@tanstack/react-start";

import type { HistoryContent } from "#/features/history/server/history-actions.server";

export type {
  HistoryContent,
  HonoraryEntry,
  OfficerEntry,
  OfficerYearGroup,
} from "#/features/history/server/history-actions.server";

export const getHistoryContentFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<HistoryContent> => {
    const { getHistoryContentAction } =
      await import("#/features/history/server/history-actions.server");
    return getHistoryContentAction();
  },
);
