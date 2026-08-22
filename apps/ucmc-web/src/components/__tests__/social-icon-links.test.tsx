import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SocialIconLinks } from "#/components/social-icon-links";

const ALL = {
  instagramUrl: "https://instagram.com/uc_mountaineering",
  facebookUrl: "https://www.facebook.com/groups/19204046466/",
  youtubeUrl: "https://www.youtube.com/channel/UC1zpNSpQI784F-zOtVHjUMQ",
};

describe("SocialIconLinks", () => {
  it("renders one labeled external link per configured URL", () => {
    render(<SocialIconLinks {...ALL} />);

    for (const [label, href] of [
      ["UCMC on Instagram", ALL.instagramUrl],
      ["UCMC on Facebook", ALL.facebookUrl],
      ["UCMC on YouTube", ALL.youtubeUrl],
    ]) {
      const link = screen.getByLabelText(label);
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      // `noopener` matters on target=_blank — without it the opened tab
      // gets a `window.opener` handle back to us.
      expect(link.getAttribute("rel")).toContain("noopener");
    }
  });

  it("drops the icon for a blank URL instead of linking to nowhere", () => {
    // Blank is the "we don't have that account" value. An <a href="">
    // would resolve as a same-origin reload of the current page, which
    // looks like a broken link rather than an absent one.
    render(<SocialIconLinks {...ALL} facebookUrl="" />);

    expect(screen.getByLabelText("UCMC on Instagram")).toBeInTheDocument();
    expect(screen.getByLabelText("UCMC on YouTube")).toBeInTheDocument();
    expect(screen.queryByLabelText("UCMC on Facebook")).toBeNull();
  });

  it("renders nothing at all when every URL is blank", () => {
    // Not an empty wrapper: the landing card's flex gap would otherwise
    // reserve space for a row with no content in it.
    const { container } = render(
      <SocialIconLinks instagramUrl="" facebookUrl="" youtubeUrl="" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("wraps the row in phrasing content", () => {
    // The landing page renders this inside the <p> that holds a row's
    // value; a block-level wrapper there is invalid HTML and React
    // reparents it, producing a hydration mismatch.
    const { container } = render(<SocialIconLinks {...ALL} />);
    expect(container.firstElementChild?.tagName).toBe("SPAN");
  });
});
