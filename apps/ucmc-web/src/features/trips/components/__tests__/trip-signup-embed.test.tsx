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
    render(<TripSignupEmbed waiverCurrent />);

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
    render(<TripSignupEmbed waiverCurrent />);

    const link = screen.getByRole("link", {
      name: /open the form in a new tab/i,
    });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link.getAttribute("href")).not.toContain("embedded=true");
  });

  it("warns, but does not block, when the waiver isn't current", () => {
    render(<TripSignupEmbed waiverCurrent={false} />);

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

  it("shows no waiver warning when the member is attested", () => {
    render(<TripSignupEmbed waiverCurrent />);

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
