/**
 * Action implementations for landing-page server fns. The shell in
 * `./landing-fns.ts` dynamic-imports this module from inside its
 * createServerFn handlers so server-only code stays off the client graph.
 *
 * Read action is anonymous-safe — the home page is public, so any visitor
 * (signed in or not) gets the same content bundle. Write actions all gate
 * on `landing:manage`.
 */
import { uuidv7 } from "uuidv7";

import {
  countActivitiesUsingImageKey,
  countFaqItems,
  countSlidesUsingImageKey,
  deleteActivity,
  deleteFaqItem,
  deleteHeroSlide,
  getActivity,
  getFaqItem,
  getHeroSlide,
  insertActivity,
  insertFaqItem,
  insertHeroSlide,
  listActivities,
  listFaqItems,
  listHeroSlides,
  listSettings,
  reorderActivities,
  reorderFaqItems,
  reorderHeroSlides,
  updateActivity,
  updateFaqItem,
  updateHeroSlide,
  upsertSetting,
} from "#/features/landing/server/landing-repo.server";
import {
  decodeImageDataUrl,
  deleteLandingImage,
  landingImageKey,
  putLandingImage,
  shortContentHash,
} from "#/features/landing/server/landing-image.server";
import type { LandingOfficerRole } from "#/features/landing/server/landing-officers.server";
import { listLandingOfficers } from "#/features/landing/server/landing-officers.server";
import {
  LANDING_LIMITS,
  LANDING_SETTING_KEYS,
} from "#/features/landing/server/landing-schemas";
import type {
  ActivityIcon,
  ActivityInput,
  ActivityUpdateInput,
  CreateHeroSlideInput,
  FaqInput,
  FaqUpdateInput,
  ReorderInput,
  SetSectionImageInput,
  UpdateHeroSlideInput,
  UpdateSettingInput,
} from "#/features/landing/server/landing-schemas";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";

// ── auth helpers ────────────────────────────────────────────────────────

async function requireLandingEditor(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("landing:manage")) {
    throw new Error("Forbidden: missing landing:manage");
  }
  return principal;
}

// ── public types ────────────────────────────────────────────────────────

export interface HeroSlideSummary {
  id: string;
  imageKey: string;
  alt: string;
  sortOrder: number;
}

export interface FaqItemSummary {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
}

export interface ActivitySummary {
  id: string;
  icon: ActivityIcon;
  title: string;
  blurb: string;
  imageKey: string | null;
  sortOrder: number;
}

// Values are JSON-decoded payloads — string for scalar keys, string[] for
// about.paragraphs. `null` covers the rare corrupt-row case so a malformed
// value never 500s the page.
export type LandingSettingValue = string | string[] | null;

export interface LandingContent {
  settings: Record<string, LandingSettingValue>;
  heroSlides: HeroSlideSummary[];
  faqItems: FaqItemSummary[];
  activities: ActivitySummary[];
  officers: LandingOfficerRole[];
}

// ── read ────────────────────────────────────────────────────────────────

export async function getLandingContentAction(): Promise<LandingContent> {
  const [settingRows, heroSlides, faqItems, activities, officers] =
    await Promise.all([
      listSettings(),
      listHeroSlides(),
      listFaqItems(),
      listActivities(),
      listLandingOfficers(),
    ]);

  const settings: Record<string, LandingSettingValue> = {};
  for (const row of settingRows) {
    try {
      const parsed: unknown = JSON.parse(row.valueJson);
      if (typeof parsed === "string") {
        settings[row.key] = parsed;
      } else if (
        Array.isArray(parsed) &&
        parsed.every((v): v is string => typeof v === "string")
      ) {
        settings[row.key] = parsed;
      } else {
        settings[row.key] = null;
      }
    } catch {
      // Defensive: if a row is corrupt, skip it rather than 500 the page.
      settings[row.key] = null;
    }
  }

  return {
    settings,
    heroSlides: heroSlides.map((s) => ({
      id: s.id,
      imageKey: s.imageKey,
      alt: s.alt,
      sortOrder: s.sortOrder,
    })),
    faqItems: faqItems.map((f) => ({
      id: f.id,
      question: f.question,
      answer: f.answer,
      sortOrder: f.sortOrder,
    })),
    activities: activities.map((a) => ({
      id: a.id,
      icon: a.icon as ActivityIcon,
      title: a.title,
      blurb: a.blurb,
      imageKey: a.imageKey,
      sortOrder: a.sortOrder,
    })),
    officers,
  };
}

// ── settings ────────────────────────────────────────────────────────────

export async function updateSettingAction(
  input: UpdateSettingInput,
): Promise<{ ok: true }> {
  const principal = await requireLandingEditor();
  await upsertSetting(input.key, JSON.stringify(input.value), principal.userId);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "landing.settings_edited",
    targetType: "landing_setting",
    targetId: input.key,
  });
  return { ok: true };
}

// ── hero slides ─────────────────────────────────────────────────────────

export async function createHeroSlideAction(
  input: CreateHeroSlideInput,
): Promise<{ id: string; imageKey: string }> {
  const principal = await requireLandingEditor();
  const { contentType, bytes } = decodeImageDataUrl(input.dataUrl);
  const hash = await shortContentHash(bytes);
  const imageKey = landingImageKey("hero", hash, contentType);
  await putLandingImage(imageKey, bytes, contentType);

  const id = `hslide_${uuidv7()}`;
  await insertHeroSlide({ id, imageKey, alt: input.alt });

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "landing.hero_slide_edited",
    targetType: "landing_hero_slide",
    targetId: id,
    metadata: { op: "create" },
  });
  return { id, imageKey };
}

export async function updateHeroSlideAction(
  input: UpdateHeroSlideInput,
): Promise<{ ok: true }> {
  const principal = await requireLandingEditor();
  const existing = await getHeroSlide(input.id);
  if (!existing) {
    throw new Error("Hero slide not found");
  }

  let nextImageKey: string | undefined;
  if (input.dataUrl) {
    const { contentType, bytes } = decodeImageDataUrl(input.dataUrl);
    const hash = await shortContentHash(bytes);
    nextImageKey = landingImageKey("hero", hash, contentType);
    await putLandingImage(nextImageKey, bytes, contentType);
  }

  await updateHeroSlide({
    id: input.id,
    alt: input.alt,
    imageKey: nextImageKey,
  });

  if (nextImageKey && nextImageKey !== existing.imageKey) {
    // Old key may still be referenced by another slide if two had the same
    // bytes — unlikely with content-hashed keys but cheap to guard.
    const remaining = await countSlidesUsingImageKey(existing.imageKey);
    if (remaining === 0) {
      await deleteLandingImage(existing.imageKey);
    }
  }

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "landing.hero_slide_edited",
    targetType: "landing_hero_slide",
    targetId: input.id,
    metadata: { op: "update", imageReplaced: Boolean(nextImageKey) },
  });
  return { ok: true };
}

export async function deleteHeroSlideAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const principal = await requireLandingEditor();
  const existing = await getHeroSlide(input.id);
  if (!existing) {
    return { ok: true };
  }
  await deleteHeroSlide(input.id);
  const remaining = await countSlidesUsingImageKey(existing.imageKey);
  if (remaining === 0) {
    await deleteLandingImage(existing.imageKey);
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "landing.hero_slide_edited",
    targetType: "landing_hero_slide",
    targetId: input.id,
    metadata: { op: "delete" },
  });
  return { ok: true };
}

export async function reorderHeroSlidesAction(
  input: ReorderInput,
): Promise<{ ok: true }> {
  await requireLandingEditor();
  await reorderHeroSlides(input.ids);
  return { ok: true };
}

// ── FAQ ─────────────────────────────────────────────────────────────────

export async function createFaqItemAction(
  input: FaqInput,
): Promise<{ id: string }> {
  const principal = await requireLandingEditor();
  const existing = await countFaqItems();
  if (existing >= LANDING_LIMITS.faqItemCount.max) {
    throw new Error(
      `At most ${LANDING_LIMITS.faqItemCount.max} FAQ items allowed`,
    );
  }
  const id = `faq_${uuidv7()}`;
  await insertFaqItem({
    id,
    question: input.question,
    answer: input.answer,
  });
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "landing.faq_edited",
    targetType: "landing_faq_item",
    targetId: id,
    metadata: { op: "create" },
  });
  return { id };
}

export async function updateFaqItemAction(
  input: FaqUpdateInput,
): Promise<{ ok: true }> {
  const principal = await requireLandingEditor();
  // The repo's UPDATE silently no-ops on a missing id; audit only
  // when the row actually exists so a stale request can't produce a
  // false-positive `faq_edited` row.
  const existing = await getFaqItem(input.id);
  if (!existing) {
    return { ok: true };
  }
  await updateFaqItem(input);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "landing.faq_edited",
    targetType: "landing_faq_item",
    targetId: input.id,
    metadata: { op: "update" },
  });
  return { ok: true };
}

export async function deleteFaqItemAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const principal = await requireLandingEditor();
  // Same existence guard as update — the repo's DELETE silently
  // no-ops on missing rows, and we don't want phantom audit entries.
  const existing = await getFaqItem(input.id);
  if (!existing) {
    return { ok: true };
  }
  await deleteFaqItem(input.id);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "landing.faq_edited",
    targetType: "landing_faq_item",
    targetId: input.id,
    metadata: { op: "delete" },
  });
  return { ok: true };
}

export async function reorderFaqItemsAction(
  input: ReorderInput,
): Promise<{ ok: true }> {
  await requireLandingEditor();
  await reorderFaqItems(input.ids);
  return { ok: true };
}

// ── Activities ──────────────────────────────────────────────────────────

async function uploadActivityImage(dataUrl: string): Promise<string> {
  const { contentType, bytes } = decodeImageDataUrl(dataUrl);
  const hash = await shortContentHash(bytes);
  const key = landingImageKey("activities", hash, contentType);
  await putLandingImage(key, bytes, contentType);
  return key;
}

async function maybeDeleteActivityImage(key: string | null): Promise<void> {
  if (!key) {
    return;
  }
  const remaining = await countActivitiesUsingImageKey(key);
  if (remaining === 0) {
    await deleteLandingImage(key);
  }
}

export async function createActivityAction(
  input: ActivityInput,
): Promise<{ id: string; imageKey: string | null }> {
  const principal = await requireLandingEditor();
  const imageKey = input.dataUrl
    ? await uploadActivityImage(input.dataUrl)
    : null;
  const id = `act_${uuidv7()}`;
  await insertActivity({
    id,
    icon: input.icon,
    title: input.title,
    blurb: input.blurb,
    imageKey,
  });
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "landing.activity_edited",
    targetType: "landing_activity",
    targetId: id,
    metadata: { op: "create" },
  });
  return { id, imageKey };
}

export async function updateActivityAction(
  input: ActivityUpdateInput,
): Promise<{ ok: true }> {
  const principal = await requireLandingEditor();
  if (input.dataUrl && input.removeImage) {
    throw new Error("Cannot both replace and remove the image");
  }
  const existing = await getActivity(input.id);
  if (!existing) {
    throw new Error("Activity not found");
  }

  let imageKeyChange: string | null | undefined;
  let oldKeyToCleanup: string | null = null;
  if (input.dataUrl) {
    imageKeyChange = await uploadActivityImage(input.dataUrl);
    oldKeyToCleanup = existing.imageKey;
  } else if (input.removeImage) {
    imageKeyChange = null;
    oldKeyToCleanup = existing.imageKey;
  }

  await updateActivity({
    id: input.id,
    icon: input.icon,
    title: input.title,
    blurb: input.blurb,
    imageKey: imageKeyChange,
  });

  if (oldKeyToCleanup && oldKeyToCleanup !== imageKeyChange) {
    await maybeDeleteActivityImage(oldKeyToCleanup);
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "landing.activity_edited",
    targetType: "landing_activity",
    targetId: input.id,
    metadata: { op: "update" },
  });
  return { ok: true };
}

export async function deleteActivityAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  const principal = await requireLandingEditor();
  const existing = await getActivity(input.id);
  if (!existing) {
    return { ok: true };
  }
  await deleteActivity(input.id);
  await maybeDeleteActivityImage(existing.imageKey);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "landing.activity_edited",
    targetType: "landing_activity",
    targetId: input.id,
    metadata: { op: "delete" },
  });
  return { ok: true };
}

// ── Section-singleton images (about, meeting) ──────────────────────────
// Each section has a `<section>.image_key` setting whose value is the R2
// key (or empty string). Reads parse the value JSON and discard empty;
// writes upload bytes + cleanup the previous R2 object.

async function readSectionImageKey(settingKey: string): Promise<string | null> {
  const rows = await listSettings();
  const row = rows.find((r) => r.key === settingKey);
  if (!row) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(row.valueJson);
    return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function setSectionImage(
  settingKey: string,
  subdir: "about" | "meeting",
  input: SetSectionImageInput,
  userId: string,
): Promise<{ ok: true; imageKey: string }> {
  const { contentType, bytes } = decodeImageDataUrl(input.dataUrl);
  const hash = await shortContentHash(bytes);
  const newKey = landingImageKey(subdir, hash, contentType);
  await putLandingImage(newKey, bytes, contentType);

  const previous = await readSectionImageKey(settingKey);
  await upsertSetting(settingKey, JSON.stringify(newKey), userId);
  if (previous && previous !== newKey) {
    await deleteLandingImage(previous);
  }
  return { ok: true, imageKey: newKey };
}

async function removeSectionImage(
  settingKey: string,
  userId: string,
): Promise<{ ok: true }> {
  const previous = await readSectionImageKey(settingKey);
  await upsertSetting(settingKey, JSON.stringify(""), userId);
  if (previous) {
    await deleteLandingImage(previous);
  }
  return { ok: true };
}

export async function setAboutImageAction(
  input: SetSectionImageInput,
): Promise<{ ok: true; imageKey: string }> {
  const principal = await requireLandingEditor();
  const result = await setSectionImage(
    LANDING_SETTING_KEYS.aboutImageKey,
    "about",
    input,
    principal.userId,
  );
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "landing.settings_edited",
    targetType: "landing_setting",
    targetId: LANDING_SETTING_KEYS.aboutImageKey,
    metadata: { op: "set_image" },
  });
  return result;
}

export async function removeAboutImageAction(): Promise<{ ok: true }> {
  const principal = await requireLandingEditor();
  const result = await removeSectionImage(
    LANDING_SETTING_KEYS.aboutImageKey,
    principal.userId,
  );
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "landing.settings_edited",
    targetType: "landing_setting",
    targetId: LANDING_SETTING_KEYS.aboutImageKey,
    metadata: { op: "remove_image" },
  });
  return result;
}

export async function setMeetingImageAction(
  input: SetSectionImageInput,
): Promise<{ ok: true; imageKey: string }> {
  const principal = await requireLandingEditor();
  const result = await setSectionImage(
    LANDING_SETTING_KEYS.meetingImageKey,
    "meeting",
    input,
    principal.userId,
  );
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "landing.settings_edited",
    targetType: "landing_setting",
    targetId: LANDING_SETTING_KEYS.meetingImageKey,
    metadata: { op: "set_image" },
  });
  return result;
}

export async function removeMeetingImageAction(): Promise<{ ok: true }> {
  const principal = await requireLandingEditor();
  const result = await removeSectionImage(
    LANDING_SETTING_KEYS.meetingImageKey,
    principal.userId,
  );
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "landing.settings_edited",
    targetType: "landing_setting",
    targetId: LANDING_SETTING_KEYS.meetingImageKey,
    metadata: { op: "remove_image" },
  });
  return result;
}

export async function reorderActivitiesAction(
  input: ReorderInput,
): Promise<{ ok: true }> {
  await requireLandingEditor();
  await reorderActivities(input.ids);
  return { ok: true };
}

// Re-export key constants for tests.
export { LANDING_SETTING_KEYS };
