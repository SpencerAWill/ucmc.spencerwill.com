/**
 * Route-facing shells for member-management server fns (registration
 * approval queue). Each handler dynamic-imports its implementation from
 * `./member-actions.server` so the server-only code stays off the client
 * module graph.
 *
 * Exports:
 *   - listPendingRegistrationsFn — pending registrations for the queue
 *   - approveRegistrationFn     — approve a pending member
 *   - rejectRegistrationFn      — reject a pending member
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type {
  MemberSummary,
  PendingRegistration,
  RoleOption,
} from "#/server/auth/member-actions.server";

export type { MemberSummary, PendingRegistration, RoleOption };

export const listPendingRegistrationsInputSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type ListPendingRegistrationsInput = z.infer<
  typeof listPendingRegistrationsInputSchema
>;

// ── roles ───────────────────────────────────────────────────────────────

export const listRolesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<RoleOption[]> => {
    const { listRolesAction } =
      await import("#/server/auth/member-actions.server");
    return listRolesAction();
  },
);

// ── members directory ────────────────────────────────────────────────────

const listMembersInputSchema = z.object({
  search: z.string().max(200).optional(),
  affiliations: z.string().optional(), // comma-separated ucAffiliation values
  roles: z.string().optional(), // comma-separated role names
  sort: z.enum(["name_asc", "name_desc", "newest", "oldest"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export interface MembersPage {
  rows: MemberSummary[];
  total: number;
}

export const listMembersFn = createServerFn({ method: "GET" })
  .inputValidator(listMembersInputSchema)
  .handler(async ({ data }): Promise<MembersPage> => {
    const { listMembersAction } =
      await import("#/server/auth/member-actions.server");
    return listMembersAction({
      search: data.search,
      affiliations: data.affiliations,
      roles: data.roles,
      sort: data.sort,
      limit: data.limit,
      offset: data.offset,
    });
  });

// ── pending registrations ───────────────────────────────────────────────

export interface PendingRegistrationsPage {
  rows: PendingRegistration[];
  total: number;
}

export const listPendingRegistrationsFn = createServerFn({ method: "GET" })
  .inputValidator(listPendingRegistrationsInputSchema)
  .handler(async ({ data }): Promise<PendingRegistrationsPage> => {
    const { listPendingRegistrationsAction } =
      await import("#/server/auth/member-actions.server");
    return listPendingRegistrationsAction({
      from: data.from,
      to: data.to,
      limit: data.limit,
      offset: data.offset,
    });
  });

export const approveRegistrationsFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userIds: z.array(z.string().min(1)).min(1) }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { approveRegistrationsAction } =
      await import("#/server/auth/member-actions.server");
    return approveRegistrationsAction(data.userIds);
  });

export const rejectRegistrationsFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userIds: z.array(z.string().min(1)).min(1) }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { rejectRegistrationsAction } =
      await import("#/server/auth/member-actions.server");
    return rejectRegistrationsAction(data.userIds);
  });
