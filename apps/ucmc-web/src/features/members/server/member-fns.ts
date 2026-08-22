/**
 * Route-facing shells for member-management server fns (registration
 * approval queue, member lifecycle, admin profile editing). Each handler
 * dynamic-imports its implementation from `./member-actions.server` so the
 * server-only code stays off the client module graph.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type {
  EmergencyContactSummary,
  MemberDetail,
  MemberSummary,
  PendingRegistration,
  RoleOption,
} from "#/features/members/server/member-actions.server";
import type {
  EditUnclaimedResult,
  PreAddResult,
  UnclaimedMember,
  UnclaimedMembersPage,
} from "#/features/members/server/unclaimed-actions.server";
import { profileInputSchema } from "#/server/profile/profile-schemas";

export type {
  EmergencyContactSummary,
  MemberDetail,
  MemberSummary,
  PendingRegistration,
  RoleOption,
  EditUnclaimedResult,
  PreAddResult,
  UnclaimedMember,
  UnclaimedMembersPage,
};

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
      await import("#/features/members/server/member-actions.server");
    return listRolesAction();
  },
);

// ── members directory ────────────────────────────────────────────────────

export const listMembersInputSchema = z.object({
  search: z.string().max(200).optional(),
  affiliations: z.string().optional(), // comma-separated ucAffiliation values
  roles: z.string().optional(), // comma-separated role names
  statuses: z.string().optional(), // comma-separated user status values
  sort: z.enum(["name_asc", "name_desc", "newest", "oldest"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type ListMembersInput = z.infer<typeof listMembersInputSchema>;

export interface MembersPage {
  rows: MemberSummary[];
  total: number;
}

export const listMembersFn = createServerFn({ method: "GET" })
  .validator(listMembersInputSchema)
  .handler(async ({ data }): Promise<MembersPage> => {
    const { listMembersAction } =
      await import("#/features/members/server/member-actions.server");
    return listMembersAction({
      search: data.search,
      affiliations: data.affiliations,
      roles: data.roles,
      statuses: data.statuses,
      sort: data.sort,
      limit: data.limit,
      offset: data.offset,
    });
  });

// ── member detail ───────────────────────────────────────────────────────

export const getMemberDetailFn = createServerFn({ method: "GET" })
  .validator(z.object({ publicId: z.string().min(1) }))
  .handler(async ({ data }): Promise<MemberDetail> => {
    const { getMemberDetailAction } =
      await import("#/features/members/server/member-actions.server");
    return getMemberDetailAction(data.publicId);
  });

// ── pending registrations ───────────────────────────────────────────────

export interface PendingRegistrationsPage {
  rows: PendingRegistration[];
  total: number;
}

export const listPendingRegistrationsFn = createServerFn({ method: "GET" })
  .validator(listPendingRegistrationsInputSchema)
  .handler(async ({ data }): Promise<PendingRegistrationsPage> => {
    const { listPendingRegistrationsAction } =
      await import("#/features/members/server/member-actions.server");
    return listPendingRegistrationsAction({
      from: data.from,
      to: data.to,
      limit: data.limit,
      offset: data.offset,
    });
  });

export const approveRegistrationsFn = createServerFn({ method: "POST" })
  .validator(z.object({ userIds: z.array(z.string().min(1)).min(1) }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { approveRegistrationsAction } =
      await import("#/features/members/server/member-actions.server");
    return approveRegistrationsAction(data.userIds);
  });

export const rejectRegistrationsFn = createServerFn({ method: "POST" })
  .validator(z.object({ userIds: z.array(z.string().min(1)).min(1) }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { rejectRegistrationsAction } =
      await import("#/features/members/server/member-actions.server");
    return rejectRegistrationsAction(data.userIds);
  });

// ── member lifecycle ────────────────────────────────────────────────────

export const deactivateMembersFn = createServerFn({ method: "POST" })
  .validator(z.object({ userIds: z.array(z.string().min(1)).min(1) }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deactivateMembersAction } =
      await import("#/features/members/server/member-actions.server");
    return deactivateMembersAction(data.userIds);
  });

export const reactivateMembersFn = createServerFn({ method: "POST" })
  .validator(z.object({ userIds: z.array(z.string().min(1)).min(1) }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { reactivateMembersAction } =
      await import("#/features/members/server/member-actions.server");
    return reactivateMembersAction(data.userIds);
  });

export const unrejectMembersFn = createServerFn({ method: "POST" })
  .validator(z.object({ userIds: z.array(z.string().min(1)).min(1) }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { unrejectMembersAction } =
      await import("#/features/members/server/member-actions.server");
    return unrejectMembersAction(data.userIds);
  });

// ── session revocation ──────────────────────────────────────────────────

export const revokeUserSessionsFn = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { revokeUserSessionsAction } =
      await import("#/features/members/server/member-actions.server");
    return revokeUserSessionsAction(data.userId);
  });

// ── unclaimed members (officer pre-add for gear association) ───────────

export const listUnclaimedInputSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type ListUnclaimedInput = z.infer<typeof listUnclaimedInputSchema>;

export const listUnclaimedFn = createServerFn({ method: "GET" })
  .validator(listUnclaimedInputSchema)
  .handler(async ({ data }): Promise<UnclaimedMembersPage> => {
    const { listUnclaimedAction } =
      await import("#/features/members/server/unclaimed-actions.server");
    return listUnclaimedAction(data);
  });

const preAddEntrySchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(254),
});

export const preAddUnclaimedInputSchema = z.object({
  entries: z.array(preAddEntrySchema).min(1).max(200),
});

export type PreAddUnclaimedInput = z.infer<typeof preAddUnclaimedInputSchema>;

export const preAddUnclaimedFn = createServerFn({ method: "POST" })
  .validator(preAddUnclaimedInputSchema)
  .handler(async ({ data }): Promise<PreAddResult> => {
    const { preAddUnclaimedMembersAction } =
      await import("#/features/members/server/unclaimed-actions.server");
    return preAddUnclaimedMembersAction({ entries: data.entries });
  });

export const editUnclaimedInputSchema = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(254),
});

export type EditUnclaimedInput = z.infer<typeof editUnclaimedInputSchema>;

export const editUnclaimedFn = createServerFn({ method: "POST" })
  .validator(editUnclaimedInputSchema)
  .handler(async ({ data }): Promise<EditUnclaimedResult> => {
    const { editUnclaimedMemberAction } =
      await import("#/features/members/server/unclaimed-actions.server");
    return editUnclaimedMemberAction(data);
  });

export const deleteUnclaimedFn = createServerFn({ method: "POST" })
  .validator(z.object({ userIds: z.array(z.string().min(1)).min(1) }))
  .handler(async ({ data }): Promise<{ deletedIds: string[] }> => {
    const { deleteUnclaimedMembersAction } =
      await import("#/features/members/server/unclaimed-actions.server");
    return deleteUnclaimedMembersAction({ userIds: data.userIds });
  });

// ── admin profile edit ──────────────────────────────────────────────────

// Officers don't acknowledge policies on a member's behalf — that
// happens once at member registration via the registration form. Drop
// `policiesAck` from the validated payload here so it can never reach
// the profiles insert/update spread (the column doesn't exist; spreading
// it would surface as a runtime SQL/Drizzle error).
export const adminUpdateProfileFn = createServerFn({ method: "POST" })
  .validator(
    profileInputSchema
      .omit({ policiesAck: true })
      .extend({ userId: z.string().min(1) }),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { adminUpdateProfileAction } =
      await import("#/features/members/server/member-actions.server");
    return adminUpdateProfileAction(data);
  });
