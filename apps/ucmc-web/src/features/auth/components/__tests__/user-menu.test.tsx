/**
 * The account menu's feedback row: one row holding up to two actions,
 * "My feedback" (a link) and later "Send feedback…" (opens the dialog).
 * Each half has its own gate and the row disappears when neither holds.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserMenu } from "#/features/auth/components/user-menu";
import { authStub } from "#/test-support/auth-stub";

const useAuthMock = vi.hoisted(() => vi.fn());
const flagsMock = vi.hoisted(() => vi.fn());
const launcher = vi.hoisted(() => ({ canSend: false, open: vi.fn() }));

vi.mock("#/components/feedback/feedback-launcher", () => ({
  useFeedbackLauncher: () => launcher,
}));

vi.mock("#/features/auth/api/use-auth", () => ({ useAuth: useAuthMock }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: flagsMock() }),
}));

vi.mock("#/features/settings/api/queries", () => ({
  publicFlagsQueryOptions: () => ({
    queryKey: ["public-flags"],
    placeholderData: { pages: {} },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useLocation: () => null,
}));

function setup(
  permissions: string[],
  pages: Record<string, boolean> = { my_feedback: true },
) {
  flagsMock.mockReturnValue({ pages });
  useAuthMock.mockReturnValue({
    ...authStub(permissions, {
      principal: {
        status: "approved",
        hasProfile: true,
        preferredName: "Test",
        primaryEmail: "test@example.com",
        roles: ["member"],
        roleDisplayNames: {},
        avatarKey: null,
      },
    }),
    isLoading: false,
    signOut: vi.fn(),
  });
  render(<UserMenu />);
}

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
}

describe("UserMenu feedback row", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    flagsMock.mockReset();
    launcher.canSend = false;
    launcher.open.mockReset();
  });

  it("shows My feedback when pages.my_feedback is on and the member holds site_feedback:submit", async () => {
    setup(["site_feedback:submit"]);
    await openMenu();
    expect(
      screen.getByRole("menuitem", { name: "My feedback" }),
    ).toHaveAttribute("href", "/my/feedback");
    expect(screen.getByTestId("feedback-menu-row")).toBeInTheDocument();
  });

  it("shows My feedback for club_feedback:submit alone", async () => {
    setup(["club_feedback:submit"]);
    await openMenu();
    expect(
      screen.getByRole("menuitem", { name: "My feedback" }),
    ).toBeInTheDocument();
  });

  it("hides My feedback when pages.my_feedback is off", async () => {
    setup(["site_feedback:submit"], { my_feedback: false });
    await openMenu();
    expect(
      screen.queryByRole("menuitem", { name: "My feedback" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("feedback-menu-row")).not.toBeInTheDocument();
  });

  it("hides My feedback when the member holds neither submit permission", async () => {
    setup(["site_feedback:manage"]);
    await openMenu();
    expect(
      screen.queryByRole("menuitem", { name: "My feedback" }),
    ).not.toBeInTheDocument();
  });

  it("Send feedback… renders when canSend and opens the launcher", async () => {
    launcher.canSend = true;
    setup(["site_feedback:submit"]);
    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Send feedback…" }),
    );
    expect(launcher.open).toHaveBeenCalledTimes(1);
  });

  it("row shows only My feedback when canSend is false", async () => {
    setup(["site_feedback:submit"]);
    await openMenu();
    expect(
      screen.queryByRole("menuitem", { name: "Send feedback…" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "My feedback" }),
    ).toBeInTheDocument();
  });

  it("row shows only Send feedback… when My feedback is off", async () => {
    launcher.canSend = true;
    setup(["site_feedback:submit"], { my_feedback: false });
    await openMenu();
    expect(
      screen.getByRole("menuitem", { name: "Send feedback…" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "My feedback" }),
    ).not.toBeInTheDocument();
  });

  it("row is absent when both halves are off", async () => {
    setup([], { my_feedback: true });
    await openMenu();
    expect(screen.queryByTestId("feedback-menu-row")).not.toBeInTheDocument();
  });

  it("both halves are separate menuitems in one row, send first", async () => {
    launcher.canSend = true;
    setup(["site_feedback:submit"]);
    await openMenu();
    const row = screen.getByTestId("feedback-menu-row");
    const items = Array.from(row.querySelectorAll("[role=menuitem]")).map(
      (el) => el.textContent,
    );
    expect(items).toEqual(["Send feedback…", "My feedback"]);
  });
});
