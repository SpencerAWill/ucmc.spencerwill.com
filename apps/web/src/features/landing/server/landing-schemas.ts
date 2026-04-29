import { z } from "zod";

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
  heroHeading: "hero.heading",
  heroTagline: "hero.tagline",
  aboutParagraphs: "about.paragraphs",
  // R2 key (`landing/<subdir>/<hash>.<ext>`) or empty string when no image.
  // Mutated only via dedicated set/remove server fns (which handle bytes
  // upload + R2 cleanup), not via the generic update-setting endpoint.
  aboutImageKey: "about.image_key",
  meetingDayTime: "meeting.day_time",
  meetingLocation: "meeting.location",
  meetingEmail: "meeting.email",
  meetingInstagramUrl: "meeting.instagram_url",
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
const optionalUrl = z
  .string()
  .trim()
  .max(LANDING_LIMITS.meetingField.max)
  .refine(
    (v) => v === "" || /^https?:\/\//i.test(v),
    "Must start with http:// or https://",
  );
export const instagramUrlSchema = optionalUrl;

// Discriminated input so a single update server-fn can validate any setting.
export const updateSettingInputSchema = z.discriminatedUnion("key", [
  z.object({
    key: z.literal(LANDING_SETTING_KEYS.heroHeading),
    value: heroHeadingSchema,
  }),
  z.object({
    key: z.literal(LANDING_SETTING_KEYS.heroTagline),
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
  z.object({
    key: z.literal(LANDING_SETTING_KEYS.meetingEmail),
    value: meetingFieldSchema,
  }),
  z.object({
    key: z.literal(LANDING_SETTING_KEYS.meetingInstagramUrl),
    value: instagramUrlSchema,
  }),
]);
export type UpdateSettingInput = z.infer<typeof updateSettingInputSchema>;

// ── Hero slides ─────────────────────────────────────────────────────────
const heroSlideAltSchema = trimmed(
  LANDING_LIMITS.heroSlideAlt.min,
  LANDING_LIMITS.heroSlideAlt.max,
);
export const createHeroSlideInputSchema = z.object({
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
