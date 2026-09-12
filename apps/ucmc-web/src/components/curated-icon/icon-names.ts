/**
 * The curated whitelist of lucide icon names an officer may pick for a
 * card in the CMS — the home page's activity cards and /volunteer's
 * program cards.
 *
 * A whitelist rather than "any lucide name" for two reasons: the icons
 * have to be statically imported to be tree-shaken (a dynamic lookup
 * over the whole lucide surface ships ~1500 icons), and a picker with
 * 1500 entries is not a picker. The stored column is freeform `TEXT`
 * validated against this list at write time.
 *
 * Kept free of React so zod schemas and server actions can import the
 * list without pulling the component graph in behind it; the matching
 * lucide components live in `curated-icon.tsx`, and the two are pinned
 * to each other by `curated-icon.test.tsx`.
 *
 * **Widening is always safe; narrowing is not.** Removing a name
 * orphans every row already storing it — the card then renders its
 * fallback and an officer has to go find it. Deprecate by leaving the
 * name in place.
 */
export const CURATED_ICONS = [
  // Terrain and trips — the home page's activity cards.
  "Mountain",
  "MountainSnow",
  "Snowflake",
  "TentTree",
  "Backpack",
  "Users",
  "Compass",
  "Map",
  "Tent",
  "Sun",
  "Trees",
  "Footprints",
  // Service and stewardship — /volunteer's program cards. The set above
  // is entirely climbing-and-camping glyphs, with nothing that reads as
  // trail work, a cleanup, or a donation drive.
  "HandHeart",
  "Handshake",
  "Shovel",
  "Hammer",
  "Recycle",
  "Trash2",
  "Sprout",
  "TreeDeciduous",
  "Leaf",
  "Waves",
  "Route",
  "Gift",
  "HeartHandshake",
  "Sparkles",
] as const;

export type CuratedIconName = (typeof CURATED_ICONS)[number];

/**
 * Runtime narrowing for a value off the wire or out of the database.
 *
 * A plain `includes` rather than a `Set`/`in` lookup: the list is short,
 * and `in` against an object map would walk the prototype chain, so
 * `"constructor"` and `"toString"` would both narrow to a valid icon
 * name and then index the component registry to a function.
 */
export function isCuratedIcon(value: string): value is CuratedIconName {
  return (CURATED_ICONS as readonly string[]).includes(value);
}
