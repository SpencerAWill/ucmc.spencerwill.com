/**
 * URL-state plumbing for a `<DataToolbar />`.
 *
 * Every list route was hand-rolling the same three rules, and drifting
 * on all three:
 *
 * 1. **Defaults are resolved on read** (`search.sort ?? "code"`) and
 *    **omitted on write**, so `/gear` stays `/gear` instead of becoming
 *    `/gear?sort=code&dir=asc&view=list&page=1`. A URL that spells out
 *    its own defaults is one that changes meaning the day a default
 *    does.
 * 2. **Changing what's in the result set resets the page.** Filtering
 *    a 6-page list down to 2 while parked on page 5 shows an empty
 *    list, not an empty state. Sort and view don't reset it — the same
 *    rows are still there, in a different order or shape.
 * 3. **Comparison is array-aware**, because tag/affiliation params are
 *    arrays and `Object.is([], [])` is false — which would make every
 *    write look like a change and reset the page on a view toggle.
 *
 * The route still owns its own zod search schema and its `navigate`;
 * this only owns the three rules above.
 *
 * **`defaults` and `resultSetKeys` must be module-level constants**, not
 * object literals written at the call site — they're memo dependencies,
 * and a fresh identity every render defeats the memo.
 */
import { useCallback, useMemo } from "react";

type SearchValue = string | number | boolean | readonly string[] | undefined;
type SearchRecord = Record<string, SearchValue>;

/** Array-aware, one level deep — the only shape a search param takes. */
export function sameSearchValue(a: SearchValue, b: SearchValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = Array.isArray(a) ? a : [];
    const right = Array.isArray(b) ? b : [];
    return (
      left.length === right.length &&
      left.every((item, index) => item === right[index])
    );
  }
  return Object.is(a, b);
}

/**
 * The write half, pure so it can be tested without a router: merge the
 * updates, blank out anything that matches its default, and reset the
 * page key if a result-set key actually moved.
 */
export function nextToolbarSearch<TSearch extends SearchRecord>(args: {
  current: TSearch;
  defaults: Partial<TSearch>;
  updates: Partial<TSearch>;
  resultSetKeys: readonly (keyof TSearch)[];
  pageKey: keyof TSearch;
}): TSearch {
  const { current, defaults, updates, resultSetKeys, pageKey } = args;
  const merged = { ...current, ...updates };

  const resultSetChanged = resultSetKeys.some(
    (key) =>
      key in updates &&
      !sameSearchValue(
        resolveValue(current[key], defaults[key]),
        resolveValue(merged[key], defaults[key]),
      ),
  );

  const next = { ...merged } as SearchRecord;
  for (const key of Object.keys(next)) {
    // An empty array and an empty string are "nothing selected" too —
    // left in, they'd show up as `?tag=` in the bar.
    const value = next[key];
    const isEmpty =
      value === "" || (Array.isArray(value) && value.length === 0);
    if (isEmpty || sameSearchValue(value, defaults[key])) {
      next[key] = undefined;
    }
  }
  if (resultSetChanged) {
    next[pageKey as string] = undefined;
  }
  return next as TSearch;
}

function resolveValue(value: SearchValue, fallback: SearchValue): SearchValue {
  return value === undefined ? fallback : value;
}

export interface ToolbarSearchState<TSearch extends SearchRecord> {
  /** The route's params with defaults applied — read this, not `search`. */
  value: TSearch;
  /** Merge a partial update and navigate. */
  set: (updates: Partial<TSearch>) => void;
}

export function useToolbarSearchState<TSearch extends SearchRecord>({
  search,
  defaults,
  resultSetKeys,
  pageKey = "page",
  navigate,
}: {
  /** `Route.useSearch()`. */
  search: TSearch;
  /** Per-key defaults, resolved on read and omitted on write. */
  defaults: Partial<TSearch>;
  /** Keys whose change means different rows, so page 5 stops making
   *  sense. Sort and view belong *outside* this list. */
  resultSetKeys: readonly (keyof TSearch)[];
  pageKey?: keyof TSearch;
  /** The route's own navigate, narrowed to the search object. */
  navigate: (next: TSearch) => void;
}): ToolbarSearchState<TSearch> {
  const value = useMemo(() => {
    const resolved = { ...search } as SearchRecord;
    for (const key of Object.keys(defaults)) {
      if (resolved[key] === undefined) {
        resolved[key] = defaults[key];
      }
    }
    return resolved as TSearch;
  }, [search, defaults]);

  const set = useCallback(
    (updates: Partial<TSearch>) => {
      navigate(
        nextToolbarSearch({
          current: search,
          defaults,
          updates,
          resultSetKeys,
          pageKey,
        }),
      );
    },
    [search, defaults, resultSetKeys, pageKey, navigate],
  );

  return { value, set };
}
