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

describe("SETTINGS_PAGE_PERMISSIONS", () => {
  it("lists each distinct permission once, settings:manage first", () => {
    expect(SETTINGS_PAGE_PERMISSIONS).toEqual(["settings:manage"]);
  });
});

describe("canEditSetting", () => {
  it("answers from the key's own permission", () => {
    expect(canEditSetting(["settings:manage"], "contact.clubEmail")).toBe(true);
    expect(canEditSetting([], "contact.clubEmail")).toBe(false);
    expect(canEditSetting(["members:manage"], "contact.clubEmail")).toBe(false);
  });
});
