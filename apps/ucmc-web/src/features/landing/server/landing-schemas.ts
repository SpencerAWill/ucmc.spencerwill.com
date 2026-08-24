import { z } from "zod";

import {
  HERO_HEADING_KEYS,
  HERO_PAGE_KEYS,
  HERO_TAGLINE_KEYS,
} from "#/features/landing/lib/hero-pages";
import type { HeroPage } from "#/features/landing/lib/hero-pages";

// ── Curated lucide icon allowlist for activity cards ────────────────────
// Restricted set keeps the editor UX simple and prevents importing every
// lucide icon into the client bundle.
export const ACTIVITY_ICONS = [
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
] as const;
export type ActivityIcon = (typeof ACTIVITY_ICONS)[number];

// ── Limits ──────────────────────────────────────────────────────────────
export const LANDING_LIMITS = {
  heroHeading: { min: 1, max: 80 },
  heroTagline: { min: 1, max: 200 },
  heroSlideAlt: { min: 1, max: 200 },
  aboutParagraph: { min: 1, max: 500 },
  aboutParagraphCount: { min: 1, max: 6 },
  activityTitle: { min: 1, max: 40 },
  activityBlurb: { min: 1, max: 200 },
  faqQuestion: { min: 1, max: 200 },
  faqAnswer: { min: 1, max: 2000 },
  faqItemCount: { max: 20 },
  meetingField: { min: 1, max: 120 },
} as const;

// Hero image cap is bigger than avatars (200 KB) since slides are
// full-bleed; client compresses to WebP so 800 KB is a generous
// post-compression ceiling.
export const HERO_IMAGE_MAX_BYTES = 800 * 1024;

// ── Setting keys ────────────────────────────────────────────────────────
// Singleton text rows in landing_settings live under these well-known keys.
// Writers reference them by enum-ish constant; readers parse value_json
// according to the per-key schema below.
export const LANDING_SETTING_KEYS = {
  // NOTE: the hero's heading/tagline are no longer here. Migration 0065
  // moved them under a per-page namespace (`hero.<page>.heading`), built
  // by `heroHeadingKey` / `heroTaglineKey` from the `HERO_PAGES`
  // registry — the keys are now derived from a list, so writing them out
  // as constants would just be a second place to forget a page.
  aboutParagraphs: "about.paragraphs",
  // R2 key (`landing/<subdir>/<hash>.<ext>`) or empty string when no image.
  // Mutated only via dedicated set/remove server fns (which handle bytes
  // upload + R2 cleanup), not via the generic update-setting endpoint.
  aboutImageKey: "about.image_key",
  meetingDayTime: "meeting.day_time",
  meetingLocation: "meeting.location",
  // NOTE: `meeting.email` and `meeting.instagram_url` used to live here.
  // Both are now site settings (`contact.clubEmail`,
  // `contact.instagramUrl`) because the footer renders the same values
  // and the landing CMS shouldn't be the owner of something two surfaces
  // display. Migration 0058 carried the rows over and deleted them.
  meetingImageKey: "meeting.image_key",
} as const;

export type LandingSettingKey =
  (typeof LANDING_SETTING_KEYS)[keyof typeof LANDING_SETTING_KEYS];

// ── Per-setting value schemas ───────────────────────────────────────────
const trimmed = (min: number, max: number) =>
  z.string().trim().min(min, "Required").max(max, `At most ${max} characters`);

export const heroHeadingSchema = trimmed(
  LANDING_LIMITS.heroHeading.min,
  LANDING_LIMITS.heroHeading.max,
);
export const heroTaglineSchema = trimmed(
  LANDING_LIMITS.heroTagline.min,
  LANDING_LIMITS.heroTagline.max,
);
export const aboutParagraphsSchema = z
  .array(
    trimmed(
      LANDING_LIMITS.aboutParagraph.min,
      LANDING_LIMITS.aboutParagraph.max,
    ),
  )
  .min(LANDING_LIMITS.aboutParagraphCount.min, "At least one paragraph")
  .max(
    LANDING_LIMITS.aboutParagraphCount.max,
    `At most ${LANDING_LIMITS.aboutParagraphCount.max} paragraphs`,
  );
export const meetingFieldSchema = trimmed(
  LANDING_LIMITS.meetingField.min,
  LANDING_LIMITS.meetingField.max,
);

// Discriminated input so a single update server-fn can validate any setting.
// The hero branches use `z.enum` over the registry-derived key lists
// rather than one literal per page: eight pages x two keys is sixteen
// branches that all validate identically, and every one of them would
// have to be added by hand when a page joins `HERO_PAGES`. Heading and
// tagline stay separate because their length caps differ.
export const updateSettingInputSchema = z.discriminatedUnion("key", [
  z.object({
    key: z.enum(HERO_HEADING_KEYS as [string, ...string[]]),
    value: heroHeadingSchema,
  }),
  z.object({
    key: z.enum(HERO_TAGLINE_KEYS as [string, ...string[]]),
    value: heroTaglineSchema,
  }),
  z.object({
    key: z.literal(LANDING_SETTING_KEYS.aboutParagraphs),
    value: aboutParagraphsSchema,
  }),
  z.object({
    key: z.literal(LANDING_SETTING_KEYS.meetingDayTime),
    value: meetingFieldSchema,
  }),
  z.object({
    key: z.literal(LANDING_SETTING_KEYS.meetingLocation),
    value: meetingFieldSchema,
  }),
]);
export type UpdateSettingInput = z.infer<typeof updateSettingInputSchema>;

// ── Hero slides ─────────────────────────────────────────────────────────
const heroSlideAltSchema = trimmed(
  LANDING_LIMITS.heroSlideAlt.min,
  LANDING_LIMITS.heroSlideAlt.max,
);
export const createHeroSlideInputSchema = z.object({
  // Which page's gallery this slide joins. Validated against the
  // registry so a hand-crafted request can't invent a page and orphan a
  // row no editor can reach.
  page: z.enum(HERO_PAGE_KEYS as [HeroPage, ...HeroPage[]]),
  alt: heroSlideAltSchema,
  // base64 data URL of the cropped image, mirrors avatar upload wire shape
  dataUrl: z.string().min(1).max(2_000_000),
});
export type CreateHeroSlideInput = z.infer<typeof createHeroSlideInputSchema>;

export const updateHeroSlideInputSchema = z.object({
  id: z.string().min(1),
  alt: heroSlideAltSchema,
  // Optional — when present, replace the image. When absent, only update alt.
  dataUrl: z.string().min(1).max(2_000_000).optional(),
});
export type UpdateHeroSlideInput = z.infer<typeof updateHeroSlideInputSchema>;

export const reorderInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});
export type ReorderInput = z.infer<typeof reorderInputSchema>;

export const idInputSchema = z.object({ id: z.string().min(1) });

// ── FAQ ─────────────────────────────────────────────────────────────────
export const faqInputSchema = z.object({
  question: trimmed(
    LANDING_LIMITS.faqQuestion.min,
    LANDING_LIMITS.faqQuestion.max,
  ),
  answer: trimmed(LANDING_LIMITS.faqAnswer.min, LANDING_LIMITS.faqAnswer.max),
});
export type FaqInput = z.infer<typeof faqInputSchema>;

export const faqUpdateInputSchema = faqInputSchema.extend({
  id: z.string().min(1),
});
export type FaqUpdateInput = z.infer<typeof faqUpdateInputSchema>;

// ── Activities ──────────────────────────────────────────────────────────
const optionalImageDataUrl = z.string().min(1).max(2_000_000).optional();

export const activityInputSchema = z.object({
  icon: z.enum(ACTIVITY_ICONS),
  title: trimmed(
    LANDING_LIMITS.activityTitle.min,
    LANDING_LIMITS.activityTitle.max,
  ),
  blurb: trimmed(
    LANDING_LIMITS.activityBlurb.min,
    LANDING_LIMITS.activityBlurb.max,
  ),
  // When present, the action uploads the image and stores its R2 key on
  // the new activity row. When absent, the activity is text-only.
  dataUrl: optionalImageDataUrl,
});
export type ActivityInput = z.infer<typeof activityInputSchema>;

export const activityUpdateInputSchema = activityInputSchema.extend({
  id: z.string().min(1),
  // `dataUrl` (inherited): replace the image. `removeImage`: clear the
  // image entirely. They are mutually exclusive at the action layer.
  removeImage: z.boolean().optional(),
});
export type ActivityUpdateInput = z.infer<typeof activityUpdateInputSchema>;

// ── Section-singleton images (about, meeting) ──────────────────────────
// Same wire shape: just bytes via base64 data URL. Each section has its
// own setting key + R2 subdir; the action layer keys off section name.
export const setSectionImageInputSchema = z.object({
  dataUrl: z.string().min(1).max(2_000_000),
});
export type SetSectionImageInput = z.infer<typeof setSectionImageInputSchema>;
