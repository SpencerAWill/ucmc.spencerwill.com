import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TripSignupEmbed } from "#/features/trips/components/trip-signup-embed";

// `Link` becomes a plain `<a>` so accessible-name queries work without a
// router, matching `sidebar-nav.test.tsx`.
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
}));

function frame() {
  // The iframe has an accessible name via `title`, but no ARIA role that
  // Testing Library queries by name, so reach for it by title.
  return document.querySelector("iframe");
}

describe("TripSignupEmbed", () => {
  it("embeds the sign-up form with embedded=true", () => {
    render(<TripSignupEmbed waiverCurrent suspendedUntil={null} />);

    const iframe = frame();
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toContain(
      "https://docs.google.com/forms/",
    );
    // Without `embedded=true` Google renders its own full-page chrome
    // inside the frame — the parameter is what makes this an embed.
    expect(iframe?.getAttribute("src")).toContain("embedded=true");
    expect(iframe).toHaveAttribute("title", "Trip sign-up form");
  });

  it("offers a new-tab escape hatch WITHOUT embedded=true", () => {
    // The recovery path when a browser refuses to frame third-party
    // content. A standalone tab wants the full-page form, so the embed
    // parameter must not ride along.
    render(<TripSignupEmbed waiverCurrent suspendedUntil={null} />);

    const link = screen.getByRole("link", {
      name: /open the form in a new tab/i,
    });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link.getAttribute("href")).not.toContain("embedded=true");
  });

  it("warns, but does not block, when the waiver isn't current", () => {
    render(<TripSignupEmbed waiverCurrent={false} suspendedUntil={null} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /waiver isn.t on file/i,
    );
    expect(
      screen.getByRole("link", { name: /your waiver page/i }),
    ).toHaveAttribute("href", "/my/waiver");
    // The point of the advisory: the form is still there. Attestation is
    // officer-driven off-platform, so hard-gating would strand a member
    // who has already handed in their signed paper.
    expect(frame()).not.toBeNull();
  });

  it("shows no waiver warning or reminder when the member is attested", () => {
    render(<TripSignupEmbed waiverCurrent suspendedUntil={null} />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/signed club waiver on file/i)).toBeNull();
  });

  it("shows a general reminder, not a warning, when there is no standing to read", () => {
    // Signed-out visitors and pending accounts: nothing is known to be
    // missing, and /my/waiver isn't somewhere they can go.
    render(<TripSignupEmbed waiverCurrent={null} suspendedUntil={null} />);

    expect(screen.getByText(/signed club waiver on file/i)).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.queryByRole("link", { name: /your waiver page/i }),
    ).toBeNull();
    expect(frame()).not.toBeNull();
  });

  it("shows the suspension notice instead of the form and the new-tab link", () => {
    render(
      <TripSignupEmbed
        waiverCurrent
        suspendedUntil={Temporal.PlainDate.from("2026-12-15")}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You\u2019re suspended from club trips until Dec 15, 2026.",
    );
    expect(frame()).toBeNull();
    expect(
      screen.queryByRole("link", { name: /open the form in a new tab/i }),
    ).toBeNull();
  });
});
