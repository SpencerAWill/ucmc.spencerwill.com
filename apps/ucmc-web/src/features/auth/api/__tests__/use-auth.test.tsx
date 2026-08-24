import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "#/features/auth/api/use-auth";
import { ViewModeProvider } from "#/features/auth/api/view-mode";
import { WAIVER_VIEW_PERMISSIONS } from "#/features/auth/guards";

// The permission resolution is the subject, so the session query is
// stubbed rather than fetched. The emulated role rides *in* that payload
// now (the server resolves it from the `ucmc_view_as` cookie), which is
// the same value the route guards read — so stubbing the payload is
// stubbing the real source.
const sessionMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: sessionMock(), isLoading: false }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  }),
}));

vi.mock("#/features/auth/api/queries", () => ({
  sessionQueryOptions: () => ({ queryKey: ["session"] }),
}));

vi.mock("#/features/auth/server/server-fns", () => ({
  signOutFn: vi.fn(),
}));

/**
 * A sys admin: every permission on the site via the principal bypass,
 * plus a `rolePermissionMap` that describes what each role *actually*
 * holds — including `member`, which has no waiver permissions.
 */
function setSysAdminSession(emulatedRole: string | null = null) {
  sessionMock.mockReturnValue({
    emulatedRole,
    principal: {
      status: "approved",
      hasProfile: true,
      isSystemAdmin: true,
      roles: ["system_admin"],
      permissions: ["members:view_private", "waivers:view", "waivers:verify"],
      rolePermissionMap: {
        system_admin: [
          "members:view_private",
          "waivers:view",
          "waivers:verify",
        ],
        member: ["gear:read", "club_feedback:submit"],
      },
    },
    anonymousPermissions: [],
  });
}

function Probe() {
  const { hasPermission, hasAnyPermission } = useAuth();
  return (
    <ul>
      <li>view:{String(hasPermission("waivers:view"))}</li>
      <li>any:{String(hasAnyPermission(WAIVER_VIEW_PERMISSIONS))}</li>
    </ul>
  );
}

function renderProbe() {
  return render(
    <ViewModeProvider>
      <Probe />
    </ViewModeProvider>,
  );
}

describe("useAuth().hasAnyPermission", () => {
  beforeEach(() => {
    sessionMock.mockReset();
    setSysAdminSession();
  });

  it("is true when the viewer holds either half of the pair", () => {
    renderProbe();
    expect(screen.getByText("any:true")).toBeInTheDocument();
  });

  it("is false while previewing a role that holds neither half", () => {
    // The bug this pins: the waiver card on /members/$publicId read the
    // payload instead of the permission, so a sys admin previewing
    // `member` still saw another member's attestation. Both predicates
    // have to fall to the previewed role's own grants.
    setSysAdminSession("member");
    renderProbe();
    expect(screen.getByText("any:false")).toBeInTheDocument();
    expect(screen.getByText("view:false")).toBeInTheDocument();
  });

  it("falls back to the anonymous permission set with no principal", () => {
    sessionMock.mockReturnValue({
      principal: null,
      anonymousPermissions: ["public_album:view"],
      emulatedRole: null,
    });
    renderProbe();
    expect(screen.getByText("any:false")).toBeInTheDocument();
  });
});
