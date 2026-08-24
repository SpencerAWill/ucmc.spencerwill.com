import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HeaderMasthead } from "#/components/layouts/header-masthead";

// Same stubbing shape as the other layout tests: the masthead reads one
// query and renders one `Link`, so `useQuery` returns whatever the test
// stages and `Link` becomes a plain `<a>` so accessible-name queries
// work without a router.
const brandingMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: brandingMock() }),
}));

vi.mock("#/features/settings/api/queries", () => ({
  publicBrandingQueryOptions: () => ({
    queryKey: ["public-branding"],
    placeholderData: { headerTitle: "", headerTagline: "" },
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
}));

function renderWith(headerTitle: string, headerTagline: string) {
  brandingMock.mockReturnValue({ headerTitle, headerTagline });
  render(<HeaderMasthead />);
}

describe("HeaderMasthead", () => {
  it("renders both halves of the configured masthead", () => {
    renderWith("UC Mountaineering Club", "Est. 1971–2026");

    expect(screen.getByText("UC Mountaineering Club")).toBeInTheDocument();
    expect(screen.getByText("Est. 1971–2026")).toBeInTheDocument();
  });

  it("puts the whole masthead inside one link home", () => {
    renderWith("UC Mountaineering Club", "Est. 1971–2026");

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link).toHaveAttribute("href", "/");
    // Title, mark, and tagline are all inside it — clicking any of them
    // navigates, not just the badge.
    expect(link).toContainElement(screen.getByText("UC Mountaineering Club"));
    expect(link).toContainElement(screen.getByText("Est. 1971–2026"));
    expect(link.querySelector("img")).not.toBeNull();
  });

  it("names the link with the visible title (WCAG Label in Name)", () => {
    renderWith("Rock Club", "");

    expect(
      screen.getByRole("link", { name: /^Rock Club — home$/ }),
    ).toBeInTheDocument();
  });

  it("keeps the link named when the title is blank", () => {
    // At narrow widths the title is display:none and the image is
    // alt="", so without the fallback the link would have no name at
    // all — and a blank setting reproduces that at every width.
    renderWith("", "");

    expect(
      screen.getByRole("link", { name: /UCMC home/i }),
    ).toBeInTheDocument();
  });

  it("renders neither half when both settings are blank", () => {
    renderWith("", "");

    const link = screen.getByRole("link");
    expect(link.textContent).toBe("");
    expect(link.querySelector("img")).not.toBeNull();
  });

  it("expands the {year} token to the current club-zone year", () => {
    renderWith("UC Mountaineering Club", "Est. 1971–{year}");

    const year =
      Temporal.Now.instant().toZonedDateTimeISO("America/New_York").year;
    expect(screen.getByText(`Est. 1971–${year}`)).toBeInTheDocument();
    expect(screen.queryByText(/\{year\}/)).toBeNull();
  });

  it("expands every occurrence of the token, not just the first", () => {
    renderWith("", "{year}/{year}");

    const year =
      Temporal.Now.instant().toZonedDateTimeISO("America/New_York").year;
    expect(screen.getByText(`${year}/${year}`)).toBeInTheDocument();
  });
});
