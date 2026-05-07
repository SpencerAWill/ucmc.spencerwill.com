/**
 * Server-fn shells for the audit log viewer. Implementation lives in
 * `./audit-actions.server.ts`; handler bodies dynamic-import to keep
 * server-only code off the client module graph.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type {
  AuditEntrySummary,
  ListAuditEventsResult,
} from "#/server/audit/audit-actions.server";

export type { AuditEntrySummary, ListAuditEventsResult };

// Mirror of the `auditAction` enum in `drizzle/schema.ts`. Re-declaring
// the values here keeps the client bundle from pulling in the entire
// schema file just to validate a string filter.
const auditActionEnum = z.enum([
  "registration.approved",
  "registration.rejected",
  "registration.unrejected",
  "member.deactivated",
  "member.reactivated",
  "member.self_deleted",
  "member.sessions_revoked",
  "profile.force_edited",
  "email.added",
  "email.removed",
  "email.primary_changed",
  "role.created",
  "role.deleted",
  "role.permissions_set",
  "role.assigned",
  "role.unassigned",
  "waiver.attested",
  "waiver.revoked",
  "landing.settings_edited",
  "landing.hero_slide_edited",
  "landing.activity_edited",
  "landing.faq_edited",
]);

export const listAuditEventsInputSchema = z.object({
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(1).max(200).optional(),
  action: auditActionEnum.optional(),
  /** Inclusive start of date range (ms). */
  from: z.number().int().nonnegative().optional(),
  /** Exclusive end of date range (ms). */
  to: z.number().int().nonnegative().optional(),
});

export const listAuditEventsFn = createServerFn({ method: "GET" })
  .inputValidator(listAuditEventsInputSchema)
  .handler(async ({ data }): Promise<ListAuditEventsResult> => {
    const { listAuditEventsAction } = await import("./audit-actions.server");
    return listAuditEventsAction(data);
  });
