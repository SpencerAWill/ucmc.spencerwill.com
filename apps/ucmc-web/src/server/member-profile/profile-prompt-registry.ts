/**
 * The catalog behind a member's profile: the prompts they can answer
 * and the disciplines they can rate themselves in.
 *
 * The third registry of its kind, after `settings-registry.ts` (site
 * config) and `notification-registry.ts` (per-member preferences), and
 * it makes the same trade: `profile_prompts` and `profile_disciplines`
 * store sparse rows keyed by the keys declared here, so **adding a
 * prompt or a discipline is an entry in this file, not a migration**.
 *
 * Lives in `src/server/` rather than `features/members` because the
 * member directory, the profile page and `/my/profile` all need it,
 * and features can't import each other. Same reasoning as
 * `gear-cave-standing.server.ts` and the notification registry.
 *
 * Client-safe: no DB imports, no `cloudflare:workers`. Pure data, so
 * the edit form and the profile page render straight from it rather
 * than keeping a second copy of every label.
 */

import type { CuratedIconName } from "#/components/curated-icon/icon-names";

export interface ProfilePromptMeta {
  /** The question, as the member reads it above their answer. */
  question: string;
  /**
   * Greyed-out example in the empty textarea. Concrete and local on
   * purpose — a placeholder reading "Your answer" teaches nothing
   * about the length or register that fits.
   */
  placeholder: string;
}

/**
 * Deliberately a short list. Prompts work because everyone answers
 * the same handful and the answers are comparable; thirty prompts
 * produce thirty profiles with nothing in common.
 */
export const PROFILE_PROMPTS = {
  trail_snack: {
    question: "Go-to trail snack",
    placeholder: "Frozen Snickers. Thawed by mile two.",
  },
  dream_objective: {
    question: "Dream objective",
    placeholder: "The Grand Teton via the Owen-Spalding.",
  },
  worst_weather: {
    question: "Worst weather I've camped in",
    placeholder: "Dolly Sods in a February ice storm.",
  },
  first_trip: {
    question: "How I got into this",
    placeholder: "Dragged along to the Red my first semester and never left.",
  },
  favorite_place: {
    question: "Favorite place I've been with the club",
    placeholder: "The back of Mammoth, lights off, everyone quiet.",
  },
  teach_me: {
    question: "Something I want to learn",
    placeholder: "Placing trad gear without talking myself out of the move.",
  },
  pack_item: {
    question: "Thing in my pack I'd never leave behind",
    placeholder: "A second pair of socks. Non-negotiable.",
  },
  hot_take: {
    question: "My outdoor hot take",
    placeholder: "Hammocks are better than tents and it isn't close.",
  },
} as const satisfies Record<string, ProfilePromptMeta>;

export type ProfilePromptKey = keyof typeof PROFILE_PROMPTS;

/**
 * `Object.hasOwn`, never `in` — the prototype-chain hazard is a
 * repo-wide rule (see `rolePermissionMap` in auth-and-rbac).
 */
export function isProfilePromptKey(value: string): value is ProfilePromptKey {
  return Object.hasOwn(PROFILE_PROMPTS, value);
}

// ── Disciplines ─────────────────────────────────────────────────────

export interface DisciplineMeta {
  /** Plural, as a section label: "Climbing", "Caving". */
  label: string;
  /**
   * A name from the shared curated list, not a component — this
   * module must stay free of React so server actions can import it.
   * `icon-names.ts` is React-free for exactly that reason, and typing
   * the field makes a typo a type error rather than a blank square.
   */
  icon: CuratedIconName;
  /** One line in the member's words, shown while they pick a level. */
  hint: string;
}

export const DISCIPLINES = {
  climbing: {
    label: "Climbing",
    icon: "Mountain",
    hint: "Sport, trad, top-rope and bouldering, indoors or out.",
  },
  caving: {
    label: "Caving",
    icon: "Flashlight",
    hint: "Horizontal and vertical, from walking passage to crawls.",
  },
  backpacking: {
    label: "Backpacking",
    icon: "Tent",
    hint: "Multi-day trips carrying what you sleep in.",
  },
  hiking: {
    label: "Day hiking",
    icon: "Footprints",
    hint: "Out and back in a day, any distance.",
  },
  paddling: {
    label: "Paddling",
    icon: "Waves",
    hint: "Canoe, kayak and raft, flat water or moving.",
  },
  mountaineering: {
    label: "Mountaineering",
    icon: "MountainSnow",
    hint: "Glacier travel, alpine routes, anything needing an ice axe.",
  },
  winter: {
    label: "Winter",
    icon: "Snowflake",
    hint: "Camping, travel and climbing below freezing.",
  },
} as const satisfies Record<string, DisciplineMeta>;

export type DisciplineKey = keyof typeof DISCIPLINES;

export function isDisciplineKey(value: string): value is DisciplineKey {
  return Object.hasOwn(DISCIPLINES, value);
}

export interface DisciplineLevelMeta {
  label: string;
  /**
   * What picking this level tells a trip leader. Written so a member
   * can place themselves honestly without reading it as a ranking —
   * "new" is a fine answer and the copy says so.
   */
  description: string;
  /**
   * Filled segments out of `DISCIPLINE_LEVEL_KEYS.length` in the
   * profile's level meter. Ordinal, so it also sorts the select.
   */
  rank: number;
}

export const DISCIPLINE_LEVELS = {
  new: {
    label: "New to it",
    description: "Curious and happy to be shown. Bring me along.",
    rank: 1,
  },
  learning: {
    label: "Learning",
    description: "Been out a few times. Still want someone experienced along.",
    rank: 2,
  },
  comfortable: {
    label: "Comfortable",
    description: "Can look after myself and keep an eye on a newer member.",
    rank: 3,
  },
  experienced: {
    label: "Experienced",
    description: "Happy to plan a trip and teach the basics.",
    rank: 4,
  },
} as const satisfies Record<string, DisciplineLevelMeta>;

export type DisciplineLevel = keyof typeof DISCIPLINE_LEVELS;

export function isDisciplineLevel(value: string): value is DisciplineLevel {
  return Object.hasOwn(DISCIPLINE_LEVELS, value);
}
