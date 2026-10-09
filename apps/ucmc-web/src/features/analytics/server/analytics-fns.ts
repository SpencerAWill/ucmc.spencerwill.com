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

// Re-exported so a COMPONENT can take its props from the shell rather
// than reaching into a `.server` module. Only shapes a component names
// in its props belong here: a route infers the whole result through its
// query options, so re-exporting the top-level result types as well
// leaves exports with no importer, which knip correctly flags. Add an
// entry here when a component needs the type, not when an action grows
// one.
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

export const complianceAnalyticsFn = createServerFn({ method: "GET" })
  .validator(z.object({ season: seasonSchema.optional() }))
  .handler(async ({ data }) => {
    const { complianceAnalyticsAction } =
      await import("#/features/analytics/server/compliance-actions.server");
    return complianceAnalyticsAction(data);
  });

export const gearAnalyticsFn = createServerFn({ method: "GET" })
  .validator(z.object({ season: seasonSchema.optional() }))
  .handler(async ({ data }) => {
    const { gearAnalyticsAction } =
      await import("#/features/analytics/server/gear-actions.server");
    return gearAnalyticsAction(data);
  });

export const activityAnalyticsFn = createServerFn({ method: "GET" })
  .validator(z.object({ season: seasonSchema.optional() }))
  .handler(async ({ data }) => {
    const { activityAnalyticsAction } =
      await import("#/features/analytics/server/activity-actions.server");
    return activityAnalyticsAction(data);
  });
