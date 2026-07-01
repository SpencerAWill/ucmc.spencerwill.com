import { z } from "zod";

export const ANNOUNCEMENT_LIMITS = {
  title: { min: 1, max: 120 },
  body: { min: 1, max: 5000 },
} as const;

export const announcementInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(ANNOUNCEMENT_LIMITS.title.min, "Required")
    .max(
      ANNOUNCEMENT_LIMITS.title.max,
      `At most ${ANNOUNCEMENT_LIMITS.title.max} characters`,
    ),
  body: z
    .string()
    .trim()
    .min(ANNOUNCEMENT_LIMITS.body.min, "Required")
    .max(
      ANNOUNCEMENT_LIMITS.body.max,
      `At most ${ANNOUNCEMENT_LIMITS.body.max} characters`,
    ),
});

export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

export const announcementUpdateInputSchema = announcementInputSchema.extend({
  id: z.string().min(1),
});

export type AnnouncementUpdateInput = z.infer<
  typeof announcementUpdateInputSchema
>;
