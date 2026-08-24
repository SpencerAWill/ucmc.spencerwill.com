import { describe, expect, it } from "vitest";

import {
  CURRENT_YEAR_TOKEN,
  getMeta,
  SETTINGS,
} from "#/server/settings/settings-registry";

/**
 * The masthead settings are the only `appearance` entries and the only
 * ones whose default carries a substitution token, so the pairing
 * between the token constant and the shipped default is pinned here —
 * a "tidy-up" of either one silently stops the year advancing.
 */
describe("header masthead settings", () => {
  it("defaults the title to the club's short name", () => {
    expect(SETTINGS["appearance.headerTitle"].parse(undefined)).toBe(
      "UC Mountaineering Club",
    );
  });

  it("ships a default tagline that carries the year token", () => {
    const tagline = SETTINGS["appearance.headerTagline"].parse(undefined);
    expect(tagline).toContain(CURRENT_YEAR_TOKEN);
    // En dash, not a hyphen — it's a year range.
    expect(tagline).toBe(`Est. 1971–${CURRENT_YEAR_TOKEN}`);
  });

  it("documents the token in the tagline's own description", () => {
    // The description is where an admin learns the token exists; if it
    // drifts from the constant the feature is undiscoverable.
    expect(getMeta("appearance.headerTagline").description).toContain(
      CURRENT_YEAR_TOKEN,
    );
  });

  it("files both under appearance, not contact", () => {
    // These are site identity, not a way to reach anyone — and the
    // public-read allowlists are split along the same line.
    expect(getMeta("appearance.headerTitle").category).toBe("appearance");
    expect(getMeta("appearance.headerTagline").category).toBe("appearance");
  });

  it("accepts a blank value on both, meaning 'show nothing'", () => {
    expect(SETTINGS["appearance.headerTitle"].parse("")).toBe("");
    expect(SETTINGS["appearance.headerTagline"].parse("")).toBe("");
  });

  it("trims surrounding whitespace rather than rendering it", () => {
    expect(SETTINGS["appearance.headerTitle"].parse("  Rock Club  ")).toBe(
      "Rock Club",
    );
  });

  it("rejects values too long for fixed-height header chrome", () => {
    expect(() =>
      SETTINGS["appearance.headerTitle"].parse("x".repeat(61)),
    ).toThrow();
    expect(() =>
      SETTINGS["appearance.headerTagline"].parse("x".repeat(41)),
    ).toThrow();
  });
});
