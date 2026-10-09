/**
 * The badge catalog: every badge a member can hold, what it is called,
 * and whether the data to award it exists yet.
 *
 * A code registry for the same reason as
 * `notification-registry.ts` — **adding a badge is an entry here, not
 * a migration.** Nothing persists an earned badge: every badge in this
 * file is *computed* from rows the app already writes (waiver cycles,
 * gear loans, sweep entries, roles), so the award and the data that
 * justifies it can never disagree. A badge an officer hands out by
 * name — the banquet superlatives — is the one shape that will need a
 * grants table, and none are declared here yet (issue #257 phase 4).
 *
 * The catalog is descriptive only. Thresholds live next to the
 * counters they compare, in `badge-rules.ts`, so a tier can't drift
 * from the number that earns it.
 *
 * Client-safe: no DB imports, no `cloudflare:workers`. The profile
 * renders labels straight from here.
 */

/** Grouping for the badge grid's section headings. */
export const BADGE_KINDS = [
  "tenure",
  "gear",
  "service",
  "merit",
  "social",
] as const;
export type BadgeKind = (typeof BADGE_KINDS)[number];

/**
 * Why a badge is not earnable yet, or `null` when it is.
 *
 * Declared rather than inferred so the UI can show the whole catalog
 * honestly: a member browsing badges sees what exists and what is
 * still coming, instead of a short list that looks complete. A badge
 * marked unearnable is never awarded, whatever the rules compute.
 */
export const BADGE_BLOCKERS = {
  trips: "Unlocks when trip sign-ups move into the site",
} as const;
export type BadgeBlocker = keyof typeof BADGE_BLOCKERS;

/**
 * The outline a badge's artwork is masked to.
 *
 * Shape carries the badge's KIND, so a grid of badges is readable
 * before any label is: round badges are seasons, shields are service,
 * hexes are everything you went out and did. Declared per badge
 * rather than derived from `kind` so a one-off can break the pattern
 * deliberately.
 */
export const BADGE_SHAPES = ["hex", "circle", "shield"] as const;
export type BadgeShape = (typeof BADGE_SHAPES)[number];

export interface BadgeMeta {
  label: string;
  /** One line, in the member's words, saying how it is earned. */
  description: string;
  kind: BadgeKind;
  /**
   * Filename under `public/badges/`, artwork for this badge.
   *
   * A real image rather than an icon-font glyph: badges are meant to
   * be collected and shown off, and a line icon at 64px reads as a
   * toolbar button. `BadgeEmblem` masks whatever is here to `shape`,
   * so the art can be swapped for a painted or photographed version
   * without touching code — the file is the design surface.
   *
   * The extension is part of the value so art can move to PNG or WebP
   * per badge without a code change. Checked into the repo, never
   * uploaded: badge art is club identity, it wants review and version
   * history, and nothing here should depend on a bucket being warm.
   */
  art: string;
  shape: BadgeShape;
  /**
   * Hidden badges are omitted from the catalog until earned, so there
   * is something to stumble on. Never used for anything a member
   * might plan around.
   */
  hidden: boolean;
  /**
   * `null` when the badge is live. Otherwise the blocker whose copy
   * the locked card shows.
   */
  blockedBy: BadgeBlocker | null;
}

export const BADGES = {
  // ── Tenure. One per club year with a waiver on file.
  //
  // Named for trees that actually grow within a day's drive of
  // Cincinnati, ordered understory → canopy → old giant, so the ring
  // count reads as a walk up through a forest rather than a level
  // number. Deliberately NOT the buckeye, however Ohio it is.
  redbud: {
    label: "Redbud",
    description: "Your first season. First thing to bloom each spring.",
    kind: "tenure",
    art: "redbud.svg",
    shape: "circle",
    hidden: false,
    blockedBy: null,
  },
  pawpaw: {
    label: "Pawpaw",
    description: "A second season. The Ohio River valley's own fruit tree.",
    kind: "tenure",
    art: "pawpaw.svg",
    shape: "circle",
    hidden: false,
    blockedBy: null,
  },
  hemlock: {
    label: "Hemlock",
    description: "Three seasons. The tree that shades the Hocking gorges.",
    kind: "tenure",
    art: "hemlock.svg",
    shape: "circle",
    hidden: false,
    blockedBy: null,
  },
  hickory: {
    label: "Hickory",
    description: "Four seasons. Slow growth, hardest wood in the woods.",
    kind: "tenure",
    art: "hickory.svg",
    shape: "circle",
    hidden: false,
    blockedBy: null,
  },
  white_oak: {
    label: "White Oak",
    description:
      "Five seasons or more. Outlives everyone; you are the club's memory.",
    kind: "tenure",
    art: "white-oak.svg",
    shape: "circle",
    hidden: false,
    blockedBy: null,
  },

  // ── Gear cave. Every one of these reads off `gear_loans`, which the
  // desk has been writing since the feature shipped.
  first_rental: {
    label: "First Rental",
    description: "Checked something out of the gear cave.",
    kind: "gear",
    art: "first-rental.svg",
    shape: "hex",
    hidden: false,
    blockedBy: null,
  },
  pack_mule: {
    label: "Pack Mule",
    description: "Ten gear loans. Silver at 25, gold at 50.",
    kind: "gear",
    art: "pack-mule.svg",
    shape: "hex",
    hidden: false,
    blockedBy: null,
  },
  clean_return: {
    label: "Clean Return",
    description: "Ten loans running, every one back on time.",
    kind: "gear",
    art: "clean-return.svg",
    shape: "hex",
    hidden: false,
    blockedBy: null,
  },
  sweep_crew: {
    label: "Sweep Crew",
    description: "Helped count the gear cave during an inventory sweep.",
    kind: "gear",
    art: "sweep-crew.svg",
    shape: "hex",
    hidden: false,
    blockedBy: null,
  },

  // ── Service.
  officer: {
    label: "Officer",
    description: "Held an officer role. Thank you.",
    kind: "service",
    art: "officer.svg",
    shape: "shield",
    hidden: false,
    blockedBy: null,
  },

  // ── Out there. Every badge below needs trip attendance, which does
  // not exist yet — sign-ups still go to a Google Form. They are
  // declared now so the catalog shows what is coming rather than
  // implying the club only cares about gear paperwork.
  underground: {
    label: "Underground",
    description: "Your first caving trip.",
    kind: "merit",
    art: "coming-soon.svg",
    shape: "hex",
    hidden: false,
    blockedBy: "trips",
  },
  first_rope: {
    label: "First Rope",
    description: "Your first climbing trip with the club.",
    kind: "merit",
    art: "coming-soon.svg",
    shape: "hex",
    hidden: false,
    blockedBy: "trips",
  },
  first_night_out: {
    label: "First Night Out",
    description: "Your first overnight trip.",
    kind: "merit",
    art: "coming-soon.svg",
    shape: "hex",
    hidden: false,
    blockedBy: "trips",
  },
  winter_camper: {
    label: "Winter Camper",
    description: "Slept out when the low was below freezing.",
    kind: "merit",
    art: "coming-soon.svg",
    shape: "hex",
    hidden: false,
    blockedBy: "trips",
  },
  polar_bear: {
    label: "Polar Bear",
    description: "Went out in January anyway.",
    kind: "merit",
    art: "coming-soon.svg",
    shape: "hex",
    hidden: true,
    blockedBy: "trips",
  },
  trip_leader: {
    label: "Trip Leader",
    description: "Led a club trip.",
    kind: "service",
    art: "coming-soon.svg",
    shape: "hex",
    hidden: false,
    blockedBy: "trips",
  },
  carpool_captain: {
    label: "Carpool Captain",
    description: "Drove on five trips.",
    kind: "social",
    art: "coming-soon.svg",
    shape: "hex",
    hidden: false,
    blockedBy: "trips",
  },
  mentor: {
    label: "Mentor",
    description: "Brought a first-timer along on a trip.",
    kind: "social",
    art: "coming-soon.svg",
    shape: "hex",
    hidden: false,
    blockedBy: "trips",
  },
} as const satisfies Record<string, BadgeMeta>;

export type BadgeKey = keyof typeof BADGES;

export const BADGE_KEYS = Object.keys(BADGES) as BadgeKey[];

/** `Object.hasOwn`, never `in` — prototype-chain hazard, repo-wide. */
export function isBadgeKey(value: string): value is BadgeKey {
  return Object.hasOwn(BADGES, value);
}

/**
 * Tier on a badge that has them. Untiered badges report `null`; the
 * UI paints those in the brand green rather than a metal.
 */
export const BADGE_TIERS = ["bronze", "silver", "gold"] as const;
export type BadgeTier = (typeof BADGE_TIERS)[number];

export interface AwardedBadge {
  key: BadgeKey;
  tier: BadgeTier | null;
  /**
   * The count behind the award, for the badge's subtitle ("7 loans").
   * `null` where the badge is a yes/no rather than a tally.
   */
  count: number | null;
}

/** A badge is awardable only while nothing blocks its data source. */
export function isBadgeLive(key: BadgeKey): boolean {
  return BADGES[key].blockedBy === null;
}
