/**
 * Route-facing shells for conduct reports. Each handler dynamic-imports
 * its action from `./report-actions.server`, so server-only code never
 * reaches the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  acceptReportSchema,
  dismissReportSchema,
  listReportsSchema,
  submitReportSchema,
} from "#/features/conduct/server/limits";
import type {
  ConductReportSummary,
  ReportSubjectOption,
} from "#/features/conduct/server/report-actions.server";

export type { ConductReportSummary, ReportSubjectOption };

/** Member picker for the report dialog: public ids and names only. */
export const searchReportSubjectsFn = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string().trim().max(100) }))
  .handler(async ({ data }): Promise<ReportSubjectOption[]> => {
    const { searchReportSubjectsAction } =
      await import("#/features/conduct/server/report-actions.server");
    return searchReportSubjectsAction(data);
  });

/** Answers `{ ok: true }` only: the reporter gets nothing to read back. */
export const submitConductReportFn = createServerFn({ method: "POST" })
  .validator(submitReportSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { submitConductReportAction } =
      await import("#/features/conduct/server/report-actions.server");
    return submitConductReportAction(data);
  });

export const listConductReportsFn = createServerFn({ method: "GET" })
  .validator(listReportsSchema)
  .handler(async ({ data }): Promise<ConductReportSummary[]> => {
    const { listConductReportsAction } =
      await import("#/features/conduct/server/report-actions.server");
    return listConductReportsAction(data.status);
  });

export const acceptConductReportFn = createServerFn({ method: "POST" })
  .validator(acceptReportSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { acceptConductReportAction } =
      await import("#/features/conduct/server/report-actions.server");
    return acceptConductReportAction(data);
  });

export const dismissConductReportFn = createServerFn({ method: "POST" })
  .validator(dismissReportSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { dismissConductReportAction } =
      await import("#/features/conduct/server/report-actions.server");
    return dismissConductReportAction(data);
  });
