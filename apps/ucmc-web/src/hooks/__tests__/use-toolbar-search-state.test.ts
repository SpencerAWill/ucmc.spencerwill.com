import { describe, expect, it } from "vitest";

import {
  nextToolbarSearch,
  sameSearchValue,
} from "#/hooks/use-toolbar-search-state";

interface GearSearch {
  q?: string;
  tag?: readonly string[];
  lifecycle?: string;
  sort?: string;
  dir?: string;
  view?: string;
  page?: number;
  [key: string]: string | number | readonly string[] | undefined;
}

const DEFAULTS: Partial<GearSearch> = {
  lifecycle: "active",
  sort: "code",
  dir: "asc",
  view: "list",
};

const RESULT_SET_KEYS = ["q", "tag", "lifecycle"] as const;

const next = (current: GearSearch, updates: Partial<GearSearch>) =>
  nextToolbarSearch({
    current,
    defaults: DEFAULTS,
    updates,
    resultSetKeys: RESULT_SET_KEYS,
    pageKey: "page",
  });

describe("sameSearchValue", () => {
  it("compares array params by contents, not identity", () => {
    // `Object.is([], [])` is false, which would make every write look
    // like a change and reset the page on a view toggle.
    expect(sameSearchValue(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameSearchValue(["a"], ["b"])).toBe(false);
    expect(sameSearchValue([], undefined)).toBe(true);
  });
});

describe("nextToolbarSearch", () => {
  it("omits values that match their default", () => {
    // A URL that spells out its own defaults changes meaning the day a
    // default does.
    const result = next({ view: "grid", page: 3 }, { view: "list" });
    expect(result.view).toBeUndefined();
  });

  it("omits empty strings and empty arrays", () => {
    const result = next({ q: "rope", tag: ["t1"] }, { q: "", tag: [] });
    expect(result.q).toBeUndefined();
    expect(result.tag).toBeUndefined();
  });

  it("resets the page when the result set changes", () => {
    // Filtering a 6-page list down to 2 while parked on page 5 shows an
    // empty list rather than an empty state.
    const result = next({ page: 5 }, { lifecycle: "retired" });
    expect(result.page).toBeUndefined();
    expect(result.lifecycle).toBe("retired");
  });

  it("keeps the page when only sort, direction or view move", () => {
    // The same rows are still there — reordered, or drawn differently.
    expect(next({ page: 5 }, { sort: "updated_at" }).page).toBe(5);
    expect(next({ page: 5 }, { dir: "desc" }).page).toBe(5);
    expect(next({ page: 5 }, { view: "table" }).page).toBe(5);
  });

  it("keeps the page when a result-set key is rewritten to what it already was", () => {
    // Re-picking the tags you already had isn't a new result set, and
    // an array-identity comparison would say it was.
    const result = next({ tag: ["t1", "t2"], page: 4 }, { tag: ["t1", "t2"] });
    expect(result.page).toBe(4);
  });

  it("treats an omitted param as its default when deciding to reset", () => {
    // `lifecycle` absent means "active"; setting it *to* active is not
    // a change, so the page survives.
    const result = next({ page: 2 }, { lifecycle: "active" });
    expect(result.page).toBe(2);
    expect(result.lifecycle).toBeUndefined();
  });
});
