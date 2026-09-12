/**
 * The header's "View as" control.
 *
 * Two things here are load-bearing and neither is obvious from the
 * markup. The amber fill is the *only* visual indicator now that the
 * banner is gone, so the accessible name has to name the previewed role
 * — colour alone is SC 1.4.1, and a screen-reader user would otherwise
 * get no signal at all that the app is in a preview. And the control has
 * to disappear for anyone with nothing to switch between, because it
 * otherwise offers a one-item menu on every page for every member.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "#/components/ui/tooltip";
import { ViewAsMenu } from "#/features/auth/components/view-as-menu";
import { authStub } from "#/test-support/auth-stub";

const useAuthMock = vi.hoisted(() => vi.fn());
const setEmulatedRole = vi.hoisted(() => vi.fn());

vi.mock("#/features/auth/api/use-auth", () => ({
  useAuth: useAuthMock,
}));

vi.mock("#/features/auth/api/view-mode", () => ({
  useViewMode: () => ({ setEmulatedRole }),
}));

type PrincipalOverrides = {
  status?: string;
  rolePermissionMap?: Record<string, string[]>;
  roleDisplayNames?: Record<string, string>;
};

function setup({
  emulatedRole = null,
  isElevated = true,
  ...principal
}: PrincipalOverrides & {
  emulatedRole?: string | null;
  isElevated?: boolean;
} = {}) {
  useAuthMock.mockReturnValue(
    authStub([], {
      emulatedRole,
      isElevated,
      principal: {
        status: "approved",
        rolePermissionMap: { system_admin: [], treasurer: [], member: [] },
        roleDisplayNames: {
          system_admin: "System Admin",
          treasurer: "Treasurer",
          member: "Member",
        },
        ...principal,
      },
    }),
  );
  render(
    <TooltipProvider>
      <ViewAsMenu />
    </TooltipProvider>,
  );
}

describe("ViewAsMenu", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    setEmulatedRole.mockReset();
  });

  it("names the previewed role in the accessible name, not just the fill", () => {
    setup({ emulatedRole: "treasurer" });
    expect(
      screen.getByRole("button", { name: "Viewing as Treasurer" }),
    ).toBeInTheDocument();
  });

  it("reads as an invitation, not a state, while no preview is active", () => {
    setup();
    expect(
      screen.getByRole("button", { name: "View as role" }),
    ).toBeInTheDocument();
  });

  it("carries the amber fill only while a preview is active", () => {
    setup({ emulatedRole: "treasurer" });
    expect(screen.getByRole("button")).toHaveClass("bg-amber-100");
  });

  it("sits flush with the other header icons when idle", () => {
    setup();
    expect(screen.getByRole("button")).not.toHaveClass("bg-amber-100");
  });

  it("offers every previewable role plus the way back out", async () => {
    setup();
    await userEvent.click(screen.getByRole("button"));
    expect(
      screen.getByRole("menuitemradio", { name: "Actual permissions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitemradio", { name: "Treasurer" }),
    ).toBeInTheDocument();
    // `system_admin` *is* the actual-permissions state for the only
    // people who can select it, so it is never its own entry.
    expect(
      screen.queryByRole("menuitemradio", { name: "System Admin" }),
    ).not.toBeInTheDocument();
  });

  it("enters a preview from the menu", async () => {
    setup();
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(
      screen.getByRole("menuitemradio", { name: "Treasurer" }),
    );
    expect(setEmulatedRole).toHaveBeenCalledWith("treasurer");
  });

  it("exits a preview back to null rather than to a role name", async () => {
    setup({ emulatedRole: "treasurer" });
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(
      screen.getByRole("menuitemradio", { name: "Actual permissions" }),
    );
    expect(setEmulatedRole).toHaveBeenCalledWith(null);
  });

  it("renders nothing for a viewer with only one role", () => {
    setup({ isElevated: false });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing for an account that is not approved", () => {
    setup({ status: "pending" });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
