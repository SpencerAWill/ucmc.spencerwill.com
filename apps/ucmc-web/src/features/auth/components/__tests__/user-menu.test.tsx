/**
 * The account menu's two feedback entries, each on its own gate: "My
 * Feedback" (a link) sits with the other "My" pages, and "Send Feedback"
 * (opens the dialog) is a section of its own above Sign out.
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

describe("UserMenu feedback entries", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    flagsMock.mockReset();
    launcher.canSend = false;
    launcher.open.mockReset();
  });

  it("shows My Feedback when pages.my_feedback is on and the member holds site_feedback:submit", async () => {
    setup(["site_feedback:submit"]);
    await openMenu();
    expect(
      screen.getByRole("menuitem", { name: "My Feedback" }),
    ).toHaveAttribute("href", "/my/feedback");
  });

  it("shows My Feedback for club_feedback:submit alone", async () => {
    setup(["club_feedback:submit"]);
    await openMenu();
    expect(
      screen.getByRole("menuitem", { name: "My Feedback" }),
    ).toBeInTheDocument();
  });

  it("hides My Feedback when pages.my_feedback is off", async () => {
    setup(["site_feedback:submit"], { my_feedback: false });
    await openMenu();
    expect(
      screen.queryByRole("menuitem", { name: "My Feedback" }),
    ).not.toBeInTheDocument();
  });

  it("hides My Feedback when the member holds neither submit permission", async () => {
    setup(["site_feedback:manage"]);
    await openMenu();
    expect(
      screen.queryByRole("menuitem", { name: "My Feedback" }),
    ).not.toBeInTheDocument();
  });

  it("Send Feedback renders when canSend and opens the launcher", async () => {
    launcher.canSend = true;
    setup(["site_feedback:submit"]);
    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Send Feedback" }),
    );
    expect(launcher.open).toHaveBeenCalledTimes(1);
  });

  it("shows only My Feedback when canSend is false", async () => {
    setup(["site_feedback:submit"]);
    await openMenu();
    expect(
      screen.queryByRole("menuitem", { name: "Send Feedback" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "My Feedback" }),
    ).toBeInTheDocument();
  });

  it("shows only Send Feedback when My Feedback is off", async () => {
    launcher.canSend = true;
    setup(["site_feedback:submit"], { my_feedback: false });
    await openMenu();
    expect(
      screen.getByRole("menuitem", { name: "Send Feedback" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "My Feedback" }),
    ).not.toBeInTheDocument();
  });

  it("shows neither entry when both gates are off", async () => {
    setup([], { my_feedback: true });
    await openMenu();
    expect(
      screen.queryByRole("menuitem", { name: /feedback/i }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });

  it("My Feedback follows the My pages; Send Feedback is its own section before Sign out", async () => {
    launcher.canSend = true;
    setup(["site_feedback:submit"], { my_feedback: true, my_gear_cart: true });
    await openMenu();
    const menu = screen.getByRole("menu");
    const sequence = Array.from(
      menu.querySelectorAll("[role=menuitem], [role=separator]"),
    ).map((el) =>
      el.getAttribute("role") === "separator" ? "---" : el.textContent,
    );
    const mine = sequence.indexOf("My Feedback");
    expect(sequence[mine - 1]).toBe("My Cart");
    expect(sequence.slice(mine + 1)).toEqual([
      "---",
      "Send Feedback",
      "---",
      "Sign out",
    ]);
  });
});

describe("UserMenu signed out", () => {
  it("links to /sign-in with the words, not only the ? avatar (#307)", () => {
    flagsMock.mockReturnValue({ pages: {} });
    useAuthMock.mockReturnValue({
      ...authStub([], { isApproved: false, principal: null }),
      isLoading: false,
      signOut: vi.fn(),
    });
    render(<UserMenu />);
    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe("/sign-in");
    expect(link.textContent).toContain("Sign in");
  });
});
