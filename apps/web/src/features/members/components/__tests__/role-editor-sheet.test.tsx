import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

function renderWithRole(role: RoleDetail) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(roleQueryKey(role.id), role);
  const permissions: PermissionSummary[] = [];
  client.setQueryData(PERMISSIONS_QUERY_KEY, permissions);
  return render(
    <QueryClientProvider client={client}>
      <RoleEditorSheet
        roleId={role.id}
        roleName={role.name}
        open
        onOpenChange={() => {}}
        initialTab="metadata"
      />
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
