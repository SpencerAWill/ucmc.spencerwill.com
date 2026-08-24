import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "#/components/ui/tooltip";
import { SESSION_QUERY_KEY } from "#/features/auth/api/query-keys";
import { ViewModeProvider } from "#/features/auth/api/view-mode";
import {
  PERMISSIONS_QUERY_KEY,
  roleQueryKey,
} from "#/features/members/api/query-keys";
import { RoleEditorSheet } from "#/features/members/components/role-editor-sheet";
import type {
  PermissionSummary,
  RoleDetail,
} from "#/features/members/server/rbac-fns";

// The sheet uses `useQuery` against `roleQueryOptions` + `permissionsQueryOptions`;
// we seed the cache directly so the server fns are never called. Stub the
// shell module so the import graph stays clean in the jsdom pool.
vi.mock("#/features/members/server/rbac-fns", () => ({
  getRoleFn: vi.fn(),
  listPermissionsFn: vi.fn(),
}));

vi.mock("#/features/members/api/use-set-role-permissions", () => ({
  useSetRolePermissions: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("#/features/members/api/use-update-role", () => ({
  useUpdateRole: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

const setRoleMembersMutate = vi.fn();
vi.mock("#/features/members/api/use-set-role-members", () => ({
  useSetRoleMembers: () => ({
    mutate: setRoleMembersMutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

// The Members tab's picker queries the members directory; the sheet's
// own tests never open it, so stub the shell rather than seeding a
// cache entry for a query that's `enabled: false` until then.
vi.mock("#/features/members/server/member-fns", () => ({
  listMembersFn: vi.fn(),
}));

/**
 * The sheet reads `useAuth()` for `roles:assign` (the Members tab's
 * write gate), so every render needs a seeded session and the
 * `ViewModeProvider` the hook resolves emulated roles through. The
 * `TooltipProvider` stands in for the one `SidebarProvider` supplies
 * in the real tree, which the row action buttons need.
 * `permissions` seeds the catalog the Permissions tab groups.
 */
function renderWithRole(
  role: RoleDetail,
  opts?: {
    permissions?: PermissionSummary[];
    viewerPermissions?: string[];
    initialTab?: "members" | "permissions" | "metadata";
  },
) {
  // `staleTime: Infinity` keeps the seeded cache entries from
  // refetching through the stubbed server fns on mount — a refetch
  // resolves `undefined` and errors the query, which correctly puts
  // the sheet in its `loadFailed` state and disables every Save.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(roleQueryKey(role.id), role);
  client.setQueryData(PERMISSIONS_QUERY_KEY, opts?.permissions ?? []);
  client.setQueryData(SESSION_QUERY_KEY, {
    principal: {
      userId: "user_viewer",
      primaryEmail: "viewer@example.com",
      emails: ["viewer@example.com"],
      status: "approved",
      hasProfile: true,
      avatarKey: null,
      roles: ["system_admin"],
      isSystemAdmin: true,
      permissions: opts?.viewerPermissions ?? ["roles:manage", "roles:assign"],
      rolePermissionMap: {},
    },
    anonymousPermissions: [],
  });
  return render(
    <QueryClientProvider client={client}>
      <ViewModeProvider>
        <TooltipProvider>
          <RoleEditorSheet
            roleId={role.id}
            roleName={role.name}
            open
            onOpenChange={() => {}}
            initialTab={opts?.initialTab ?? "metadata"}
          />
        </TooltipProvider>
      </ViewModeProvider>
    </QueryClientProvider>,
  );
}

function makeRole(overrides: Partial<RoleDetail>): RoleDetail {
  return {
    id: "role_test",
    name: "test",
    displayName: "Test",
    description: null,
    isProtected: false,
    isOfficer: false,
    permissionIds: [],
    memberCount: 0,
    position: 0,
    members: [],
    ...overrides,
  };
}

describe("RoleEditorSheet — Details tab", () => {
  it("disables Display name + Officer + Description + Save for system_admin", () => {
    renderWithRole(
      makeRole({
        id: "role_system_admin",
        name: "system_admin",
        displayName: "System Admin",
        description: "System administrator with full platform control.",
        isProtected: true,
      }),
    );

    expect(screen.getByLabelText(/^display name$/i)).toBeDisabled();
    expect(screen.getByLabelText(/^description$/i)).toBeDisabled();
    expect(screen.getByLabelText(/officer position/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    // Identifier readout remains the slug.
    expect(screen.getByLabelText(/^identifier$/i)).toHaveValue("system_admin");
  });

  it("hides the Officer checkbox for the anonymous role", () => {
    renderWithRole(
      makeRole({
        id: "role_anonymous",
        name: "anonymous",
        displayName: "Anonymous",
        isProtected: true,
      }),
    );

    expect(screen.queryByLabelText(/officer position/i)).toBeNull();
    // Display name remains editable so admins can polish the label.
    expect(screen.getByLabelText(/^display name$/i)).toBeEnabled();
  });

  it("enables all controls for a regular non-protected role", () => {
    renderWithRole(
      makeRole({
        id: "role_trip_leader",
        name: "trip_leader",
        displayName: "Trip Leader",
        description: "Leads trips.",
      }),
    );

    expect(screen.getByLabelText(/^display name$/i)).toBeEnabled();
    expect(screen.getByLabelText(/^description$/i)).toBeEnabled();
    expect(screen.getByLabelText(/officer position/i)).toBeEnabled();
  });
});

beforeEach(() => {
  setRoleMembersMutate.mockClear();
});

const PERMS: PermissionSummary[] = [
  { id: "perm_gear_read", name: "gear:read", description: "Browse gear" },
  { id: "perm_gear_manage", name: "gear:manage", description: "Edit gear" },
  { id: "perm_waivers_view", name: "waivers:view", description: null },
];

describe("RoleEditorSheet — Permissions tab", () => {
  it("collapses every group and shows a granted count per group", async () => {
    renderWithRole(
      makeRole({
        id: "role_trip_leader",
        name: "trip_leader",
        permissionIds: ["perm_gear_read"],
      }),
      { permissions: PERMS, initialTab: "permissions" },
    );

    // Group headers are present as accordion triggers, collapsed.
    const gear = screen.getByRole("button", { name: /gear/i });
    expect(gear).toHaveAttribute("aria-expanded", "false");
    expect(gear).toHaveTextContent("1 / 2");
    expect(screen.getByRole("button", { name: /waivers/i })).toHaveTextContent(
      "0 / 1",
    );

    // Collapsed means the individual permission checkboxes aren't
    // rendered — that's the whole point of the accordion.
    expect(screen.queryByText("gear:read")).toBeNull();

    await userEvent.click(gear);
    expect(gear).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("gear:read")).toBeInTheDocument();
    expect(screen.getByText("gear:manage")).toBeInTheDocument();
  });

  it("updates the group count as grants are toggled, before saving", async () => {
    renderWithRole(
      makeRole({
        id: "role_trip_leader",
        name: "trip_leader",
        permissionIds: ["perm_gear_read"],
      }),
      { permissions: PERMS, initialTab: "permissions" },
    );

    const gear = screen.getByRole("button", { name: /gear/i });
    await userEvent.click(gear);
    const boxes = screen.getAllByRole("checkbox");
    await userEvent.click(boxes[1]);

    expect(screen.getByRole("button", { name: /gear/i })).toHaveTextContent(
      "2 / 2",
    );
  });
});

describe("RoleEditorSheet — Members tab", () => {
  const members = [
    { userId: "user_a", email: "ann@example.com", preferredName: "Ann" },
    { userId: "user_b", email: "bob@example.com", preferredName: null },
  ];

  it("stages a removal behind Save rather than writing on click", async () => {
    renderWithRole(
      makeRole({
        id: "role_trip_leader",
        name: "trip_leader",
        members,
        memberCount: 2,
      }),
      { initialTab: "members" },
    );

    // Save starts disabled — nothing staged yet.
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();

    await userEvent.click(
      screen.getByRole("button", { name: /remove ann from this role/i }),
    );

    // Row is gone from the staged list, but nothing has been sent.
    expect(screen.queryByText("Ann")).toBeNull();
    expect(setRoleMembersMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/1 to remove/i)).toBeInTheDocument();

    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(setRoleMembersMutate).toHaveBeenCalledWith(
      { roleId: "role_trip_leader", userIds: ["user_b"] },
      expect.anything(),
    );
  });

  it("renders the member role read-only, with no remove buttons", () => {
    renderWithRole(
      makeRole({
        id: "role_member",
        name: "member",
        members,
        memberCount: 2,
        isProtected: true,
      }),
      { initialTab: "members" },
    );

    expect(screen.queryByRole("button", { name: /^remove/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add a member/i })).toBeNull();
    expect(
      screen.getByText(/holds the member role automatically/i),
    ).toBeInTheDocument();
    // No Save on a tab that can't be edited — the footer reads Close
    // rather than Cancel. (The sheet's own dismiss X shares that
    // accessible name, so match on the footer button's variant.)
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    const closes = screen.getAllByRole("button", { name: /^close$/i });
    expect(closes.some((b) => b.dataset.variant === "outline")).toBe(true);
  });

  it("renders read-only without roles:assign, even with roles:manage", () => {
    renderWithRole(
      makeRole({
        id: "role_trip_leader",
        name: "trip_leader",
        members,
        memberCount: 2,
      }),
      { initialTab: "members", viewerPermissions: ["roles:manage"] },
    );

    expect(screen.queryByRole("button", { name: /^remove/i })).toBeNull();
    expect(
      screen.getByText(/needs the roles:assign permission/i),
    ).toBeInTheDocument();
  });

  it("requires a confirmation before changing who holds system_admin", async () => {
    renderWithRole(
      makeRole({
        id: "role_system_admin",
        name: "system_admin",
        members,
        memberCount: 2,
        isProtected: true,
      }),
      { initialTab: "members" },
    );

    await userEvent.click(
      screen.getByRole("button", { name: /remove ann from this role/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    // Nothing sent yet — the confirm stands between Save and the write.
    expect(setRoleMembersMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/highest level of access/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(setRoleMembersMutate).toHaveBeenCalledWith(
      { roleId: "role_system_admin", userIds: ["user_b"] },
      expect.anything(),
    );
  });

  it("hides the Members tab entirely for the anonymous role", () => {
    renderWithRole(
      makeRole({
        id: "role_anonymous",
        name: "anonymous",
        isProtected: true,
      }),
    );

    expect(screen.queryByRole("tab", { name: /members/i })).toBeNull();
  });
});
