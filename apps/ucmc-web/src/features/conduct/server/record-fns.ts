/**
 * Route-facing shells for conduct records. Each handler dynamic-imports
 * its action from `./record-actions.server`, so server-only code never
 * reaches the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  createRecordSchema,
  liftSchema,
  listRecordsSchema,
  referSchema,
  sccsOutcomeSchema,
  updateRecordSchema,
} from "#/features/conduct/server/limits";
import type {
  ConductRecordDetail,
  ConductRecordSummary,
  MemberConductSummary,
} from "#/features/conduct/server/record-actions.server";
import type { ConductSubjectOption } from "#/features/conduct/server/record-repo.server";

export type {
  ConductRecordDetail,
  ConductRecordSummary,
  ConductSubjectOption,
  MemberConductSummary,
};

const recordIdSchema = z.object({
  publicId: z.string().trim().min(1).max(100),
});
const memberSummarySchema = z.object({
  userId: z.string().trim().min(1).max(100),
});

const subjectSearchSchema = z.object({ q: z.string().max(200) });

export const getConductSubjectFn = createServerFn({ method: "GET" })
  .validator(z.object({ publicId: z.string().trim().min(1).max(100) }))
  .handler(async ({ data }): Promise<ConductSubjectOption | null> => {
    const { getConductSubjectAction } =
      await import("#/features/conduct/server/record-actions.server");
    return getConductSubjectAction(data);
  });

export const searchConductSubjectsFn = createServerFn({ method: "GET" })
  .validator(subjectSearchSchema)
  .handler(async ({ data }): Promise<ConductSubjectOption[]> => {
    const { searchConductSubjectsAction } =
      await import("#/features/conduct/server/record-actions.server");
    return searchConductSubjectsAction(data);
  });

export const listConductRecordsFn = createServerFn({ method: "GET" })
  .validator(listRecordsSchema)
  .handler(async ({ data }): Promise<ConductRecordSummary[]> => {
    const { listConductRecordsAction } =
      await import("#/features/conduct/server/record-actions.server");
    return listConductRecordsAction(data);
  });

export const getConductRecordFn = createServerFn({ method: "GET" })
  .validator(recordIdSchema)
  .handler(async ({ data }): Promise<ConductRecordDetail | null> => {
    const { getConductRecordAction } =
      await import("#/features/conduct/server/record-actions.server");
    return getConductRecordAction(data.publicId);
  });

/** The member page's Conduct card. Null hides the card. */
export const memberConductSummaryFn = createServerFn({ method: "GET" })
  .validator(memberSummarySchema)
  .handler(async ({ data }): Promise<MemberConductSummary | null> => {
    const { memberConductSummaryAction } =
      await import("#/features/conduct/server/record-actions.server");
    return memberConductSummaryAction(data.userId);
  });

export const createConductRecordFn = createServerFn({ method: "POST" })
  .validator(createRecordSchema)
  .handler(async ({ data }): Promise<{ publicId: string }> => {
    const { createConductRecordAction } =
      await import("#/features/conduct/server/record-actions.server");
    return createConductRecordAction(data);
  });

export const updateConductRecordFn = createServerFn({ method: "POST" })
  .validator(updateRecordSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateConductRecordAction } =
      await import("#/features/conduct/server/record-actions.server");
    return updateConductRecordAction(data);
  });

export const referConductRecordFn = createServerFn({ method: "POST" })
  .validator(referSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { referConductRecordAction } =
      await import("#/features/conduct/server/record-actions.server");
    return referConductRecordAction(data);
  });

export const recordSccsOutcomeFn = createServerFn({ method: "POST" })
  .validator(sccsOutcomeSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { recordSccsOutcomeAction } =
      await import("#/features/conduct/server/record-actions.server");
    return recordSccsOutcomeAction(data);
  });

export const liftConductRecordFn = createServerFn({ method: "POST" })
  .validator(liftSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { liftConductRecordAction } =
      await import("#/features/conduct/server/record-actions.server");
    return liftConductRecordAction(data);
  });
