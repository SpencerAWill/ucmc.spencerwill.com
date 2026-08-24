import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "#/features/auth/api/use-auth";
import { ViewModeProvider } from "#/features/auth/api/view-mode";
import { WAIVER_VIEW_PERMISSIONS } from "#/features/auth/guards";

// The permission resolution is the subject, so the session query is
// stubbed rather than fetched. `ViewModeProvider` is real — the
// emulated role comes out of localStorage, which is exactly the path
// the bug travelled.
const sessionMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: sessionMock(), isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
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
function setSysAdminSession() {
  sessionMock.mockReturnValue({
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
    window.localStorage.clear();
    setSysAdminSession();
  });

  it("is true when the viewer holds either half of the pair", async () => {
    renderProbe();
    expect(await screen.findByText("any:true")).toBeInTheDocument();
  });

  it("is false while emulating a role that holds neither half", async () => {
    // The bug: the waiver card on /members/$publicId read the payload
    // instead of the permission, so emulating `member` still showed
    // another member's attestation. `hasAnyPermission` has to fall to
    // the emulated role's own permission set, exactly as
    // `hasPermission` does.
    window.localStorage.setItem("ucmc-emulated-role", "member");
    renderProbe();
    expect(await screen.findByText("any:false")).toBeInTheDocument();
    expect(screen.getByText("view:false")).toBeInTheDocument();
  });

  it("ignores an emulated role the principal's map doesn't describe", async () => {
    window.localStorage.setItem("ucmc-emulated-role", "not_a_role");
    renderProbe();
    expect(await screen.findByText("any:true")).toBeInTheDocument();
  });

  it("falls back to the anonymous permission set with no principal", () => {
    sessionMock.mockReturnValue({
      principal: null,
      anonymousPermissions: ["public_album:view"],
    });
    renderProbe();
    expect(screen.getByText("any:false")).toBeInTheDocument();
  });
});
