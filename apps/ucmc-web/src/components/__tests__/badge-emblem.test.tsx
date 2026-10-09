import { existsSync } from "node:fs";
import path from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BadgeEmblem, resolveBadgeArt } from "#/components/badge-emblem";
import { BADGES, BADGE_KEYS } from "#/server/member-profile/badge-registry";

const PUBLIC_DIR = path.join(import.meta.dirname, "..", "..", "..", "public");

describe("badge artwork round trip", () => {
  // The registry names a file and `resolveBadgeArt` builds the URL
  // the browser asks for. Those two halves have to agree, and when
  // they don't the failure is a silently broken image rather than an
  // error — the same shape as the R2 prefix drift that 404'd every
  // album photo. Walking the real directory is what makes a rename
  // fail here instead of in production.
  it("ships a file for every badge in the catalog", () => {
    const missing = BADGE_KEYS.filter(
      (key) => !existsSync(path.join(PUBLIC_DIR, "badges", BADGES[key].art)),
    );
    expect(missing).toEqual([]);
  });

  it("serves art from the public path the files are published at", () => {
    expect(resolveBadgeArt("white-oak.svg")).toBe("/badges/white-oak.svg");
  });
});

describe("BadgeEmblem", () => {
  it("points the image at the resolved artwork URL", () => {
    const { container } = render(
      <BadgeEmblem art="white-oak.svg" shape="circle" label="White Oak" />,
    );
    expect(screen.getByRole("img", { name: "White Oak" })).toBeInTheDocument();
    expect(container.querySelector("image")).toHaveAttribute(
      "href",
      "/badges/white-oak.svg",
    );
  });

  it("is hidden from assistive tech when the caller labels it", () => {
    // The badge's name is rendered beside it in every grid, so an
    // unlabelled emblem must not announce itself a second time.
    const { container } = render(
      <BadgeEmblem art="pack-mule.svg" shape="hex" />,
    );
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("drains and dashes a locked badge but still shows its art", () => {
    const { container } = render(
      <BadgeEmblem art="hemlock.svg" shape="circle" locked />,
    );
    expect(container.querySelector("image")).toHaveClass("grayscale");
    // The frame, not the art, is what says "not yours yet".
    const frame = container.querySelectorAll("path")[2];
    expect(frame).toHaveAttribute("stroke-dasharray");
  });

  it("gives two emblems with different art distinct clip paths", () => {
    // SVG ids are document-global: a shared id would make the second
    // emblem clip to the first one's outline.
    const { container } = render(
      <>
        <BadgeEmblem art="white-oak.svg" shape="circle" />
        <BadgeEmblem art="pack-mule.svg" shape="hex" />
      </>,
    );
    const ids = [...container.querySelectorAll("clipPath")].map((el) => el.id);
    expect(new Set(ids).size).toBe(2);
  });
});
