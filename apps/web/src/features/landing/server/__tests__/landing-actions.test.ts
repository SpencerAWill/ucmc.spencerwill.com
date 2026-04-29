import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

// ── mocks ──────────────────────────────────────────────────────────────

const cookieJar = new Map<string, string>();
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) => cookieJar.get(name),
  setCookie: (name: string, value: string) => {
    cookieJar.set(name, value);
  },
  deleteCookie: (name: string) => {
    cookieJar.delete(name);
  },
  getRequestHeader: () => undefined,
}));

vi.mock("#/server/rate-limit.server", () => ({
  checkAuthRateLimitByIp: async () => true,
  checkAuthRateLimitByEmail: async () => true,
  checkUploadRateLimit: async () => true,
}));

const {
  createActivityAction,
  createFaqItemAction,
  createHeroSlideAction,
  deleteActivityAction,
  deleteHeroSlideAction,
  getLandingContentAction,
  removeAboutImageAction,
  removeMeetingImageAction,
  reorderHeroSlidesAction,
  setAboutImageAction,
  setMeetingImageAction,
  updateActivityAction,
  updateFaqItemAction,
  updateHeroSlideAction,
  updateSettingAction,
} = await import("#/features/landing/server/landing-actions.server");
const { openSession } = await import("#/server/auth/session.server");
const { getBucket } = await import("#/server/r2");

// ── helpers ────────────────────────────────────────────────────────────

async function seedUser(email: string): Promise<string> {
  const id = `user_${crypto.randomUUID()}`;
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
    email,
    status: "approved",
  });
  await db.insert(schema.profiles).values({
    userId: id,
    fullName: "Test User",
    preferredName: "Test",
    mNumber: "M12345678",
    phone: "+15135551212",
    ucAffiliation: "student",
    updatedAt: new Date(),
  });
  return id;
}

async function assignRole(userId: string, roleId: string): Promise<void> {
  await getDb()
    .insert(schema.userRoles)
    .values({ userId, roleId })
    .onConflictDoNothing();
}

async function signInAs(userId: string): Promise<void> {
  cookieJar.clear();
  await openSession(userId);
}

async function signInAsAdmin(email = "admin@example.com"): Promise<string> {
  const userId = await seedUser(email);
  await assignRole(userId, "role_system_admin");
  await signInAs(userId);
  return userId;
}

async function signInAsMember(email = "member@example.com"): Promise<string> {
  const userId = await seedUser(email);
  await assignRole(userId, "role_member");
  await signInAs(userId);
  return userId;
}

// Smallest valid 1×1 lossless WebP — same fixed bytes the avatar test uses.
function makeWebpDataUrl(variant = 0x08): string {
  const bytes = new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46,
    0x1a,
    0x00,
    0x00,
    0x00,
    0x57,
    0x45,
    0x42,
    0x50,
    0x56,
    0x50,
    0x38,
    0x4c,
    0x0d,
    0x00,
    0x00,
    0x00,
    0x2f,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x88,
    0x88,
    variant,
  ]);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return `data:image/webp;base64,${btoa(binary)}`;
}

beforeEach(async () => {
  cookieJar.clear();
  const db = getDb();
  // Wipe everything writable. Settings + activities + FAQ are seeded by
  // 0013_landing_seed_initial_content.sql but tests want a clean slate.
  await db.delete(schema.landingHeroSlides);
  await db.delete(schema.landingFaqItems);
  await db.delete(schema.landingActivities);
  await db.delete(schema.landingSettings);
  await db.delete(schema.userRoles);
  await db.delete(schema.sessions);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

// ── read is anonymous-safe ─────────────────────────────────────────────

describe("getLandingContentAction (read)", () => {
  it("returns an empty bundle for unauthenticated callers (no throw)", async () => {
    const content = await getLandingContentAction();
    expect(content.heroSlides).toHaveLength(0);
    expect(content.faqItems).toHaveLength(0);
    expect(content.activities).toHaveLength(0);
    expect(content.settings).toEqual({});
  });

  it("returns settings parsed by shape (string vs string[])", async () => {
    const adminId = await signInAsAdmin();
    await updateSettingAction({ key: "hero.heading", value: "Welcome" });
    await updateSettingAction({
      key: "about.paragraphs",
      value: ["Para one.", "Para two."],
    });
    cookieJar.clear();

    const content = await getLandingContentAction();
    expect(content.settings["hero.heading"]).toBe("Welcome");
    expect(content.settings["about.paragraphs"]).toEqual([
      "Para one.",
      "Para two.",
    ]);
    // sanity: the action ran and wrote with the admin's id
    const row = await getDb().query.landingSettings.findFirst({
      where: eq(schema.landingSettings.key, "hero.heading"),
    });
    expect(row?.updatedBy).toBe(adminId);
  });
});

// ── writes are gated on landing:edit ───────────────────────────────────

describe("write authorization", () => {
  it("updateSettingAction rejects unauthenticated", async () => {
    await expect(
      updateSettingAction({ key: "hero.heading", value: "x" }),
    ).rejects.toThrow("Not signed in");
  });

  it("updateSettingAction rejects users without landing:edit", async () => {
    await signInAsMember();
    await expect(
      updateSettingAction({ key: "hero.heading", value: "x" }),
    ).rejects.toThrow("Forbidden: missing landing:edit");
  });

  it("createHeroSlideAction rejects users without landing:edit", async () => {
    await signInAsMember();
    await expect(
      createHeroSlideAction({ alt: "trip", dataUrl: makeWebpDataUrl() }),
    ).rejects.toThrow("Forbidden: missing landing:edit");
  });

  it("createFaqItemAction rejects users without landing:edit", async () => {
    await signInAsMember();
    await expect(
      createFaqItemAction({ question: "q?", answer: "a" }),
    ).rejects.toThrow("Forbidden: missing landing:edit");
  });

  it("createActivityAction rejects users without landing:edit", async () => {
    await signInAsMember();
    await expect(
      createActivityAction({
        icon: "Mountain",
        title: "Climb",
        blurb: "Send",
      }),
    ).rejects.toThrow("Forbidden: missing landing:edit");
  });
});

// ── hero slides ────────────────────────────────────────────────────────

describe("hero slides", () => {
  it("admin can create a slide and the image lands in R2", async () => {
    await signInAsAdmin();
    const result = await createHeroSlideAction({
      alt: "Trip in the Red",
      dataUrl: makeWebpDataUrl(),
    });
    expect(result.id).toMatch(/^hslide_/);
    expect(result.imageKey).toMatch(/^landing\/hero\/[a-f0-9]{16}\.webp$/);
    const stored = await getBucket().head(result.imageKey);
    expect(stored).not.toBeNull();
  });

  it("delete removes the R2 object when no other slide references it", async () => {
    await signInAsAdmin();
    const { id, imageKey } = await createHeroSlideAction({
      alt: "Trip",
      dataUrl: makeWebpDataUrl(),
    });
    expect(await getBucket().head(imageKey)).not.toBeNull();

    await deleteHeroSlideAction({ id });
    expect(await getBucket().head(imageKey)).toBeNull();
  });

  it("update replaces the image and deletes the old R2 object", async () => {
    await signInAsAdmin();
    const created = await createHeroSlideAction({
      alt: "v1",
      dataUrl: makeWebpDataUrl(0x08),
    });
    await updateHeroSlideAction({
      id: created.id,
      alt: "v2",
      dataUrl: makeWebpDataUrl(0x09),
    });
    // Old image gone, new one present
    expect(await getBucket().head(created.imageKey)).toBeNull();
    const content = await getLandingContentAction();
    expect(content.heroSlides[0].alt).toBe("v2");
    expect(
      await getBucket().head(content.heroSlides[0].imageKey),
    ).not.toBeNull();
  });

  it("reorder assigns contiguous sort_order from 0 in the given order", async () => {
    await signInAsAdmin();
    const a = await createHeroSlideAction({
      alt: "a",
      dataUrl: makeWebpDataUrl(0x08),
    });
    const b = await createHeroSlideAction({
      alt: "b",
      dataUrl: makeWebpDataUrl(0x09),
    });
    const c = await createHeroSlideAction({
      alt: "c",
      dataUrl: makeWebpDataUrl(0x0a),
    });

    await reorderHeroSlidesAction({ ids: [c.id, a.id, b.id] });
    const content = await getLandingContentAction();
    expect(content.heroSlides.map((s) => s.id)).toEqual([c.id, a.id, b.id]);
    expect(content.heroSlides.map((s) => s.sortOrder)).toEqual([0, 1, 2]);
  });
});

// ── FAQ ────────────────────────────────────────────────────────────────

describe("faq items", () => {
  it("admin can create / update / list", async () => {
    await signInAsAdmin();
    const { id } = await createFaqItemAction({
      question: "Is it cold?",
      answer: "Often.",
    });
    await updateFaqItemAction({
      id,
      question: "Is it cold?",
      answer: "Sometimes.",
    });
    const content = await getLandingContentAction();
    expect(content.faqItems).toHaveLength(1);
    expect(content.faqItems[0].answer).toBe("Sometimes.");
  });
});

// ── activities ─────────────────────────────────────────────────────────

describe("activities", () => {
  it("admin can create and update", async () => {
    await signInAsAdmin();
    const { id } = await createActivityAction({
      icon: "Mountain",
      title: "Cragging",
      blurb: "Sport climbing weekends",
    });
    await updateActivityAction({
      id,
      icon: "MountainSnow",
      title: "Alpine",
      blurb: "Bigger objectives",
    });
    const content = await getLandingContentAction();
    expect(content.activities).toHaveLength(1);
    expect(content.activities[0].icon).toBe("MountainSnow");
    expect(content.activities[0].title).toBe("Alpine");
    expect(content.activities[0].imageKey).toBeNull();
  });

  it("create-with-image stores in R2 under landing/activities/", async () => {
    await signInAsAdmin();
    const result = await createActivityAction({
      icon: "Mountain",
      title: "Cragging",
      blurb: "Sport climbing weekends",
      dataUrl: makeWebpDataUrl(),
    });
    expect(result.imageKey).toMatch(
      /^landing\/activities\/[a-f0-9]{16}\.webp$/,
    );
    expect(await getBucket().head(result.imageKey!)).not.toBeNull();
    const content = await getLandingContentAction();
    expect(content.activities[0].imageKey).toBe(result.imageKey);
  });

  it("update with new dataUrl replaces image and deletes old R2 object", async () => {
    await signInAsAdmin();
    const created = await createActivityAction({
      icon: "Mountain",
      title: "Cragging",
      blurb: "Sport climbing",
      dataUrl: makeWebpDataUrl(0x08),
    });
    await updateActivityAction({
      id: created.id,
      icon: "Mountain",
      title: "Cragging",
      blurb: "Sport climbing",
      dataUrl: makeWebpDataUrl(0x09),
    });
    expect(await getBucket().head(created.imageKey!)).toBeNull();
    const content = await getLandingContentAction();
    expect(content.activities[0].imageKey).not.toBe(created.imageKey);
    expect(
      await getBucket().head(content.activities[0].imageKey!),
    ).not.toBeNull();
  });

  it("update with removeImage clears image_key and deletes R2 object", async () => {
    await signInAsAdmin();
    const created = await createActivityAction({
      icon: "Mountain",
      title: "Cragging",
      blurb: "Sport climbing",
      dataUrl: makeWebpDataUrl(),
    });
    await updateActivityAction({
      id: created.id,
      icon: "Mountain",
      title: "Cragging",
      blurb: "Sport climbing",
      removeImage: true,
    });
    expect(await getBucket().head(created.imageKey!)).toBeNull();
    const content = await getLandingContentAction();
    expect(content.activities[0].imageKey).toBeNull();
  });

  it("update without dataUrl keeps the existing image", async () => {
    await signInAsAdmin();
    const created = await createActivityAction({
      icon: "Mountain",
      title: "Cragging",
      blurb: "v1",
      dataUrl: makeWebpDataUrl(),
    });
    await updateActivityAction({
      id: created.id,
      icon: "Mountain",
      title: "Cragging",
      blurb: "v2",
    });
    const content = await getLandingContentAction();
    expect(content.activities[0].blurb).toBe("v2");
    expect(content.activities[0].imageKey).toBe(created.imageKey);
    expect(await getBucket().head(created.imageKey!)).not.toBeNull();
  });

  it("delete cleans up R2 image", async () => {
    await signInAsAdmin();
    const created = await createActivityAction({
      icon: "Mountain",
      title: "Cragging",
      blurb: "Sport climbing",
      dataUrl: makeWebpDataUrl(),
    });
    await deleteActivityAction({ id: created.id });
    expect(await getBucket().head(created.imageKey!)).toBeNull();
  });
});

describe("about image", () => {
  it("setAboutImageAction uploads + writes setting", async () => {
    await signInAsAdmin();
    const result = await setAboutImageAction({
      dataUrl: makeWebpDataUrl(),
    });
    expect(result.imageKey).toMatch(/^landing\/about\/[a-f0-9]{16}\.webp$/);
    expect(await getBucket().head(result.imageKey)).not.toBeNull();
    const content = await getLandingContentAction();
    expect(content.settings["about.image_key"]).toBe(result.imageKey);
  });

  it("setAboutImageAction replaces previous image and deletes the old object", async () => {
    await signInAsAdmin();
    const first = await setAboutImageAction({
      dataUrl: makeWebpDataUrl(0x08),
    });
    const second = await setAboutImageAction({
      dataUrl: makeWebpDataUrl(0x09),
    });
    expect(await getBucket().head(first.imageKey)).toBeNull();
    expect(await getBucket().head(second.imageKey)).not.toBeNull();
  });

  it("removeAboutImageAction clears the setting and deletes the object", async () => {
    await signInAsAdmin();
    const first = await setAboutImageAction({
      dataUrl: makeWebpDataUrl(),
    });
    await removeAboutImageAction();
    expect(await getBucket().head(first.imageKey)).toBeNull();
    const content = await getLandingContentAction();
    expect(content.settings["about.image_key"]).toBe("");
  });
});

describe("meeting image", () => {
  it("setMeetingImageAction uploads under landing/meeting/", async () => {
    await signInAsAdmin();
    const result = await setMeetingImageAction({
      dataUrl: makeWebpDataUrl(),
    });
    expect(result.imageKey).toMatch(/^landing\/meeting\/[a-f0-9]{16}\.webp$/);
    expect(await getBucket().head(result.imageKey)).not.toBeNull();
    const content = await getLandingContentAction();
    expect(content.settings["meeting.image_key"]).toBe(result.imageKey);
  });

  it("setMeetingImageAction replaces previous + cleans old R2", async () => {
    await signInAsAdmin();
    const first = await setMeetingImageAction({
      dataUrl: makeWebpDataUrl(0x08),
    });
    const second = await setMeetingImageAction({
      dataUrl: makeWebpDataUrl(0x09),
    });
    expect(await getBucket().head(first.imageKey)).toBeNull();
    expect(await getBucket().head(second.imageKey)).not.toBeNull();
  });

  it("removeMeetingImageAction clears + deletes R2", async () => {
    await signInAsAdmin();
    const first = await setMeetingImageAction({
      dataUrl: makeWebpDataUrl(),
    });
    await removeMeetingImageAction();
    expect(await getBucket().head(first.imageKey)).toBeNull();
    const content = await getLandingContentAction();
    expect(content.settings["meeting.image_key"]).toBe("");
  });

  it("about and meeting images use distinct R2 prefixes (no clobber)", async () => {
    await signInAsAdmin();
    const aboutResult = await setAboutImageAction({
      dataUrl: makeWebpDataUrl(0x08),
    });
    const meetingResult = await setMeetingImageAction({
      dataUrl: makeWebpDataUrl(0x09),
    });
    expect(aboutResult.imageKey).toMatch(/^landing\/about\//);
    expect(meetingResult.imageKey).toMatch(/^landing\/meeting\//);
    // Both still present — sets are independent
    expect(await getBucket().head(aboutResult.imageKey)).not.toBeNull();
    expect(await getBucket().head(meetingResult.imageKey)).not.toBeNull();
  });
});
