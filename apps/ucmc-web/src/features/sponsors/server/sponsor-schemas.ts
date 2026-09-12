/**
 * Zod schemas for /sponsors mutation inputs. Shared by the server-fn
 * `validator` (server side) and the TypeScript types the mutation hooks
 * and the form consume (client side), so the wire shape and the form
 * shape can't drift.
 */
import { z } from "zod";

/**
 * The only schemes an officer-supplied link may use. Anchored and
 * case-insensitive, so `JavaScript:` and ` javascript:` can't slip past
 * (the value is `.trim()`ed before this runs, which makes the leading
 * space moot, but the anchor is what makes that irrelevant).
 *
 * Deliberately a local constant rather than an import of the identical
 * regex in `features/volunteer` — `import/no-restricted-paths` forbids
 * one feature importing another, and a two-line regex is not worth a
 * third entry in `FEATURE_PUBLIC_API`.
 */
export const HTTP_SCHEME = /^https?:\/\//i;

export const SPONSOR_LIMITS = {
  name: { min: 1, max: 80 },
  blurb: { min: 1, max: 400 },
  memberPerk: { max: 400 },
} as const;

/**
 * Longest edge of a stored logo, in pixels. The card paints it into a
 * box roughly 200×96 CSS px, so 640 covers a 3× display and leaves room
 * for the box to grow without a re-upload.
 */
export const SPONSOR_LOGO_MAX_DIMENSION = 640;

/**
 * Cap on the base64 data URL the client posts. Base64 inflates by ~4/3,
 * so this admits a little over 1 MB of image — matching
 * `SPONSOR_LOGO_MAX_BYTES`, which re-checks the decoded bytes.
 */
export const SPONSOR_LOGO_DATA_URL_MAX = 1_400_000;

/**
 * Reorder cap, exported so the client can't submit a list the server
 * will reject. Enforced on both sides, the same arrangement as
 * `VOLUNTEER_REORDER_MAX` and `ROLE_MEMBERS_DIFF_MAX`.
 */
export const SPONSOR_REORDER_MAX = 200;

const nullableTrimmed = (max: number) =>
  z.string().trim().max(max).nullable().default(null);

const sponsorFields = {
  name: z
    .string()
    .trim()
    .min(SPONSOR_LIMITS.name.min)
    .max(SPONSOR_LIMITS.name.max),
  blurb: z
    .string()
    .trim()
    .min(SPONSOR_LIMITS.blurb.min)
    .max(SPONSOR_LIMITS.blurb.max),
  /**
   * Member-only. `null` means the sponsor offers nothing beyond
   * supporting the club, which is the common case and renders no perk
   * block at all rather than an empty one.
   */
  memberPerk: nullableTrimmed(SPONSOR_LIMITS.memberPerk.max),
  /**
   * **`z.url()` alone is not enough.** Zod accepts any parseable URL,
   * scheme included — `javascript:alert(1)`, `data:text/html,…` and
   * `vbscript:` all pass — and this value goes straight into an
   * `<a href>` on a page anonymous visitors can load. Since
   * `public_sponsors:manage` is seeded ungranted specifically so it can
   * be delegated to a non-admin role, an unrestricted scheme is a
   * stored XSS handed to whoever holds that delegation.
   * `sponsorWebsiteHref()` re-checks at render time, because a schema
   * only guards writes made after it shipped.
   */
  websiteUrl: z
    .string()
    .trim()
    .url()
    .refine((v) => HTTP_SCHEME.test(v), {
      message: "Enter an http:// or https:// link",
    })
    .nullable()
    .default(null),
} as const;

/**
 * A newly-uploaded logo, as the client encodes it.
 *
 * The dimensions travel with the bytes rather than being decoded
 * server-side: workerd has no image decoder, and the client already
 * knows them exactly because it drew the canvas. They're display
 * metadata (they reserve the card's space to avoid a layout shift), not
 * a security boundary — `decodeImageDataUrl` still checks the magic
 * bytes and the size cap, so a lie about the dimensions costs a
 * mis-reserved box and nothing more.
 */
const logoUploadSchema = z
  .object({
    dataUrl: z.string().max(SPONSOR_LOGO_DATA_URL_MAX),
    widthPx: z.number().int().min(1).max(SPONSOR_LOGO_MAX_DIMENSION),
    heightPx: z.number().int().min(1).max(SPONSOR_LOGO_MAX_DIMENSION),
  })
  .nullable()
  .default(null);

export const createSponsorInputSchema = z.object({
  ...sponsorFields,
  logo: logoUploadSchema,
});
export type CreateSponsorInput = z.infer<typeof createSponsorInputSchema>;

/**
 * On update, `logo` has three meaningful states and they are not the
 * same:
 *   - `undefined` (field absent) — leave the existing logo alone. This
 *     is what a copy edit sends.
 *   - an upload object — replace it; the old R2 key is best-effort
 *     deleted and the orphan sweep catches it if that fails.
 *   - `null` — remove the logo, falling the card back to type.
 *
 * `.optional()` on a `.nullable().default(null)` field would collapse
 * the first two, so the default is dropped here and absence is left
 * genuinely absent.
 */
export const updateSponsorInputSchema = z.object({
  id: z.string().min(1),
  ...sponsorFields,
  logo: z
    .object({
      dataUrl: z.string().max(SPONSOR_LOGO_DATA_URL_MAX),
      widthPx: z.number().int().min(1).max(SPONSOR_LOGO_MAX_DIMENSION),
      heightPx: z.number().int().min(1).max(SPONSOR_LOGO_MAX_DIMENSION),
    })
    .nullable()
    .optional(),
});
export type UpdateSponsorInput = z.infer<typeof updateSponsorInputSchema>;

export const deleteSponsorInputSchema = z.object({ id: z.string().min(1) });
export type DeleteSponsorInput = z.infer<typeof deleteSponsorInputSchema>;

/**
 * New display order, lowest sort_order first. The server rewrites every
 * row's sort_order to its index + 1, so the canonical order stays dense
 * across add → reorder → delete.
 */
export const reorderSponsorsInputSchema = z.object({
  ids: z.array(z.string().min(1)).max(SPONSOR_REORDER_MAX),
});
export type ReorderSponsorsInput = z.infer<typeof reorderSponsorsInputSchema>;
