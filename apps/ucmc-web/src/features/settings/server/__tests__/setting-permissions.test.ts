/**
 * Pins which permission edits each setting. `/settings` admits anyone
 * holding one of `SETTINGS_PAGE_PERMISSIONS`, and the page, the list
 * read, the history read and the write all answer per key from
 * `settingPermissionOf` — so a key that silently fell back to the
 * default (or picked up the wrong override) would change who can edit it.
 */
import { describe, expect, it } from "vitest";

import {
  canEditSetting,
  SETTINGS_PAGE_PERMISSIONS,
  settingPermissionOf,
} from "#/server/settings/settings-registry";

describe("settingPermissionOf", () => {
  it("defaults to settings:manage", () => {
    expect(settingPermissionOf("contact.clubEmail")).toBe("settings:manage");
    expect(settingPermissionOf("pages.calendar")).toBe("settings:manage");
  });
});

describe("settingPermissionOf, notice", () => {
  it.each([
    "notice.enabled",
    "notice.text",
    "notice.audience",
    "notice.tone",
  ] as const)("%s is edited with notice:manage", (key) => {
    expect(settingPermissionOf(key)).toBe("notice:manage");
  });
});

describe("SETTINGS_PAGE_PERMISSIONS", () => {
  it("lists each distinct permission once, settings:manage first", () => {
    expect(SETTINGS_PAGE_PERMISSIONS).toEqual([
      "settings:manage",
      "notice:manage",
    ]);
  });
});

describe("canEditSetting", () => {
  it("answers from the key's own permission", () => {
    expect(canEditSetting(["settings:manage"], "contact.clubEmail")).toBe(true);
    expect(canEditSetting([], "contact.clubEmail")).toBe(false);
    expect(canEditSetting(["members:manage"], "contact.clubEmail")).toBe(false);
  });

  it("does not let notice:manage edit anything outside the notice", () => {
    expect(canEditSetting(["notice:manage"], "notice.text")).toBe(true);
    expect(canEditSetting(["notice:manage"], "contact.clubEmail")).toBe(false);
    expect(canEditSetting(["settings:manage"], "notice.text")).toBe(false);
  });
});
