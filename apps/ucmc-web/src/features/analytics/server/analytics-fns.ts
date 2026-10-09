/**
 * Server-fn shells for the analytics dashboard. Implementation lives
 * in the `*-actions.server.ts` siblings; each handler body is a
 * one-liner that dynamic-imports its action so server-only code stays
 * off the client module graph.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type {
  EmailVolume,
  ServiceHeadroom,
} from "#/features/analytics/server/platform-actions.server";

// Re-exported so components take their props from the shell rather than
// reaching into a `.server` module. Only the shapes a component actually
// renders are re-exported — the full `PlatformAnalytics` result is
// inferred through the query options, and re-exporting it as well would
// be an export with no importer for knip to flag.
export type { EmailVolume, ServiceHeadroom };

/**
 * `"YYYY-YY"`, the one season-label format in the codebase
 * (`historical_officers.school_year`, `waiver_attestations.cycle`).
 * Validated rather than passed through because it reaches
 * `seasonBoundsFor`, which parses the leading year out of it — a
 * malformed label would otherwise produce a `NaN` window and a query
 * that silently matches nothing.
 */
const seasonSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "Expected a season label like 2026-27");

export const platformAnalyticsFn = createServerFn({ method: "GET" })
  .validator(z.object({ season: seasonSchema.optional() }))
  .handler(async ({ data }) => {
    const { platformAnalyticsAction } =
      await import("#/features/analytics/server/platform-actions.server");
    return platformAnalyticsAction(data);
  });
