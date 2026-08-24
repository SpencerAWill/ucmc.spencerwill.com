/**
 * The registry of pages that render a configurable hero.
 *
 * One entry per public page. Everything downstream is derived from this
 * list — the `hero.<page>.*` setting keys, the discriminated update
 * validator, the editor's page scoping, and the `hero_slides.page`
 * values — so **adding a hero to a new page is one entry here**, with no
 * migration (unlike RBAC permissions, which are DB rows).
 *
 * The keys are slugs, not URL paths: `gear_cave` is `/gear-cave` and
 * `home` is `/`. They're stored in `hero_slides.page` and embedded in
 * setting keys, so **renaming one is a data migration** — treat them as
 * stable identifiers and don't derive them from the route path.
 *
 * `defaultHeading` / `defaultTagline` are the copy a page shows before
 * anyone edits it. They're real defaults rather than placeholders: every
 * page renders its hero from day one (gradient + text when it has no
 * slides yet), so these are the shipped page titles until an officer
 * changes them.
 */
export const HERO_PAGES = {
  home: {
    label: "Home",
    defaultHeading: "University of Cincinnati Mountaineering Club",
    defaultTagline:
      "Climb, hike, and summit together — UC's student-run community for climbers and mountaineers of every level.",
  },
  gear_cave: {
    label: "Gear Cave",
    defaultHeading: "The Gear Cave",
    defaultTagline:
      "UCMC’s communal equipment library — what we own, how to borrow, and what it costs.",
  },
  policies: {
    label: "Policies",
    defaultHeading: "Club policies",
    defaultTagline:
      "Operational rules for gear checkout, whitewater participation, and climbing participation. Read these before your first trip or first checkout.",
  },
  scholarships: {
    label: "Scholarships",
    defaultHeading: "Scholarships",
    defaultTagline:
      "The Steve Must Memorial Scholarship: how to apply, how to give, and who’s received it over the years.",
  },
  resources: {
    label: "Resources",
    defaultHeading: "Resources",
    defaultTagline:
      "Trip-planning paperwork, packing guides, UC student support contacts, external training organizations, and a curated set of outdoor links.",
  },
  history: {
    label: "History",
    defaultHeading: "UCMC History",
    defaultTagline:
      "How the University of Cincinnati Mountaineering Club started, the people who carried it through five decades, and the friends we’ve lost along the way.",
  },
  album: {
    label: "Album",
    defaultHeading: "Album",
    defaultTagline:
      "Photos from UCMC trips, by year and tag. Click a tile to see it larger.",
  },
  gazette: {
    label: "Gazette",
    defaultHeading: "Goosedown Gazette",
    defaultTagline:
      "UCMC’s club newsletter, by year and issue. Read inline or download a copy.",
  },
} as const;

export type HeroPage = keyof typeof HERO_PAGES;

export const HERO_PAGE_KEYS = Object.keys(HERO_PAGES) as HeroPage[];

/**
 * Runtime narrowing for a value off the wire or out of the database.
 *
 * `Object.hasOwn`, not `in`: `in` walks the prototype chain, so `"toString"`
 * and `"constructor"` would both narrow to `HeroPage` and then index the
 * registry to a function.
 */
export function isHeroPage(value: string): value is HeroPage {
  return Object.hasOwn(HERO_PAGES, value);
}

export type HeroHeadingKey = `hero.${HeroPage}.heading`;
export type HeroTaglineKey = `hero.${HeroPage}.tagline`;

/**
 * `hero.<page>.heading` / `hero.<page>.tagline` — the `landing_settings`
 * keys holding a page's overlay copy. Built here rather than written out
 * so the registry stays the only place a page is named.
 *
 * The return types are template literals over the *specific* page rather
 * than `string`, and that is load-bearing: `HERO_HEADING_KEYS` is what
 * `updateSettingInputSchema` feeds to `z.enum` for its discriminator, so
 * widening either return to `string` collapses the whole discriminated
 * union — every `key` accepts any string and per-key value typing goes
 * with it. Runtime validation stays correct either way, which is exactly
 * why the loss is invisible without a type-level test.
 */
export function heroHeadingKey<TPage extends HeroPage>(
  page: TPage,
): `hero.${TPage}.heading` {
  return `hero.${page}.heading`;
}

export function heroTaglineKey<TPage extends HeroPage>(
  page: TPage,
): `hero.${TPage}.tagline` {
  return `hero.${page}.tagline`;
}

/** Every hero setting key, for validators and allowlists. */
export const HERO_HEADING_KEYS: HeroHeadingKey[] =
  HERO_PAGE_KEYS.map(heroHeadingKey);
export const HERO_TAGLINE_KEYS: HeroTaglineKey[] =
  HERO_PAGE_KEYS.map(heroTaglineKey);
