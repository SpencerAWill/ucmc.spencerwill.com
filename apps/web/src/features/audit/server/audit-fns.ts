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
} from "#/features/audit/server/audit-actions.server";

export type { AuditEntrySummary, ListAuditEventsResult };

// Mirror of the `auditAction` enum in `drizzle/schema.ts`. Re-declaring
// the values here keeps the client bundle from pulling in the entire
// schema file just to validate a string filter. Exposed as
// `AUDIT_ACTIONS` for the route's filter `Select` and `AuditAction` for
// type-safe filter shapes; the zod enum stays internal.
// Order is intentional — drives the audit page's filter dropdown.
// Existing entries keep their slots so officers' muscle memory survives
// the unclaimed-members feature; the four new entries land at the end
// so they're additive, not disruptive.
export const AUDIT_ACTIONS = [
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
  "role.updated",
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
  "member.pre_added",
  "member.unclaimed_edited",
  "member.unclaimed_deleted",
  "member.claimed",
  "gear.added",
  "gear.updated",
  "gear.retired",
  "gear.unretired",
  "gear.tags_changed",
  "gear_type.created",
  "gear_type.updated",
  "gear_type.deleted",
  "gear_tag.created",
  "gear_tag.updated",
  "gear_tag.deleted",
  "gear_inspection.recorded",
  "loan.checked_out",
  "loan.checked_in",
  "loan.extended",
  "settings_updated",
  "history.narrative_updated",
  "historical_officer.created",
  "historical_officer.updated",
  "historical_officer.deleted",
  "honorary_member.created",
  "honorary_member.updated",
  "honorary_member.deleted",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
const auditActionEnum = z.enum(AUDIT_ACTIONS);

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
