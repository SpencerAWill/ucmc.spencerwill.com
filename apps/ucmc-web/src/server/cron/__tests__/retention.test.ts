import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb, insertMany, schema } from "#/server/db";
import { attachPrimaryEmail } from "#/server/db/test-helpers";
import { getPrivateBucket, getPublicBucket } from "#/server/r2";
import {
  EXPIRED_ROWS_PER_TICK,
  expiredRowsDelete,
  runRetentionSweeps,
  sweepOrphanPrivateR2Keys,
  sweepResolvedSiteFeedbackScreenshots,
  sweepDeactivatedAccounts,
  sweepOrphanR2Keys,
  sweepRejectedRegistrations,
  sweepEmailSendLog,
  sweepExpiredMagicLinks,
  sweepExpiredSessions,
  sweepRevokedWaiverAttestations,
  sweepWebauthnCeremonies,
} from "#/server/cron/retention.server";

const DAY_MS = 24 * 60 * 60 * 1000;
// NOW trails wall-clock so Miniflare R2 fixture objects (whose
// `uploaded` is stamped with real Date.now() at PUT time) fall on the
// old side of sweepOrphanR2Keys' age-guard. A hardcoded past NOW makes
// every R2 fixture look newer than NOW, defeating the guard and
// returning 0 deletions. Every other time-sensitive fixture is built
// relative to NOW (`NOW.getTime() - N * DAY_MS`), so this shifts the
// whole timeline forward without changing any test semantics.
const NOW = Temporal.Now.instant().add({ milliseconds: 365 * DAY_MS });

// Random suffix for ID uniqueness across tests sharing the worker DB.
function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

async function seedUser(opts: {
  status: schema.UserStatus;
  rejectedAt?: Temporal.Instant | null;
  deactivatedAt?: Temporal.Instant | null;
}): Promise<string> {
  const id = uid("u");
  await getDb()
    .insert(schema.users)
    .values({
      id,
      publicId: id,
      status: opts.status,
      rejectedAt: opts.rejectedAt ?? null,
      deactivatedAt: opts.deactivatedAt ?? null,
    });
  await attachPrimaryEmail(id, `${id}@example.com`);
  return id;
}

async function seedWaiverAttestation(opts: {
  userId: string;
  revokedAt: Temporal.Instant | null;
}): Promise<string> {
  const id = uid("w");
  await getDb()
    .insert(schema.waiverAttestations)
    .values({
      id,
      userId: opts.userId,
      cycle: "2025-26",
      version: "v1",
      attestedAt: Temporal.Instant.from("2025-09-01T00:00:00Z"),
      attestedBy: null,
      revokedAt: opts.revokedAt,
    });
  return id;
}

afterEach(async () => {
  // Each suite seeds its own rows; clean slate avoids interactions
  // between tests that both delete from `users`.
  const db = getDb();
  await db.delete(schema.siteFeedbackIssues);
  await db.delete(schema.siteFeedback);
  await db.delete(schema.albumPhotos);
  await db.delete(schema.emailSends);
  await db.delete(schema.webauthnConsumedCeremonies);
  await db.delete(schema.magicLinks);
  await db.delete(schema.sessions);
  await db.delete(schema.waiverAttestations);
  await db.delete(schema.profiles);
  await db.delete(schema.heroSlides);
  await db.delete(schema.landingActivities);
  await db.delete(schema.landingSettings);
  await db.delete(schema.users);

  // R2 cleanup — list everything and delete. Bounded by what tests
  // put in.
  const bucket = getPublicBucket();
  for (const prefix of ["avatars/", "landing/"] as const) {
    let cursor: string | undefined;
    let truncated = true;
    while (truncated) {
      const page = await bucket.list({ prefix, cursor, limit: 1000 });
      if (page.objects.length > 0) {
        await bucket.delete(page.objects.map((o) => o.key));
      }
      truncated = page.truncated;
      cursor = page.truncated ? page.cursor : undefined;
    }
  }
  const privateObjects = await getPrivateBucket().list();
  if (privateObjects.objects.length > 0) {
    await getPrivateBucket().delete(privateObjects.objects.map((o) => o.key));
  }
});

describe("sweepRejectedRegistrations", () => {
  it("deletes rows older than 30 days", async () => {
    const id = await seedUser({
      status: "rejected",
      rejectedAt: NOW.subtract({ milliseconds: 31 * DAY_MS }),
    });

    const count = await sweepRejectedRegistrations(NOW);

    expect(count).toBe(1);
    const remaining = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    expect(remaining).toHaveLength(0);
  });

  it("leaves rows younger than 30 days", async () => {
    const id = await seedUser({
      status: "rejected",
      rejectedAt: NOW.subtract({ milliseconds: 29 * DAY_MS }),
    });

    const count = await sweepRejectedRegistrations(NOW);

    expect(count).toBe(0);
    const remaining = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    expect(remaining).toHaveLength(1);
  });

  it("skips NULL rejected_at (pre-migration rows)", async () => {
    const id = await seedUser({ status: "rejected", rejectedAt: null });

    const count = await sweepRejectedRegistrations(NOW);

    expect(count).toBe(0);
    const remaining = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    expect(remaining).toHaveLength(1);
  });

  it("ignores users with other statuses even if rejected_at is set", async () => {
    // Defensive: rejectedAt should be cleared on un-reject, but if a
    // bug ever leaves it stamped on a non-rejected row, the cron must
    // not delete the user.
    const id = await seedUser({
      status: "approved",
      rejectedAt: NOW.subtract({ milliseconds: 100 * DAY_MS }),
    });

    const count = await sweepRejectedRegistrations(NOW);

    expect(count).toBe(0);
    const remaining = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    expect(remaining).toHaveLength(1);
  });
});

describe("sweepDeactivatedAccounts", () => {
  it("deletes rows older than 365 days", async () => {
    const id = await seedUser({
      status: "deactivated",
      deactivatedAt: NOW.subtract({ milliseconds: 366 * DAY_MS }),
    });

    const count = await sweepDeactivatedAccounts(NOW);

    expect(count).toBe(1);
    const remaining = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, id));
    expect(remaining).toHaveLength(0);
  });

  it("leaves rows younger than 365 days", async () => {
    await seedUser({
      status: "deactivated",
      deactivatedAt: NOW.subtract({ milliseconds: 364 * DAY_MS }),
    });

    const count = await sweepDeactivatedAccounts(NOW);

    expect(count).toBe(0);
  });

  it("skips NULL deactivated_at", async () => {
    await seedUser({ status: "deactivated", deactivatedAt: null });

    const count = await sweepDeactivatedAccounts(NOW);

    expect(count).toBe(0);
  });
});

describe("sweepRevokedWaiverAttestations", () => {
  it("deletes rows revoked more than 90 days ago", async () => {
    const userId = await seedUser({ status: "approved" });
    const attId = await seedWaiverAttestation({
      userId,
      revokedAt: NOW.subtract({ milliseconds: 91 * DAY_MS }),
    });

    const count = await sweepRevokedWaiverAttestations(NOW);

    expect(count).toBe(1);
    const remaining = await getDb()
      .select()
      .from(schema.waiverAttestations)
      .where(eq(schema.waiverAttestations.id, attId));
    expect(remaining).toHaveLength(0);
  });

  it("leaves non-revoked attestations alone", async () => {
    const userId = await seedUser({ status: "approved" });
    await seedWaiverAttestation({ userId, revokedAt: null });

    const count = await sweepRevokedWaiverAttestations(NOW);

    expect(count).toBe(0);
  });

  it("leaves recently-revoked attestations alone", async () => {
    const userId = await seedUser({ status: "approved" });
    await seedWaiverAttestation({
      userId,
      revokedAt: NOW.subtract({ milliseconds: 89 * DAY_MS }),
    });

    const count = await sweepRevokedWaiverAttestations(NOW);

    expect(count).toBe(0);
  });
});

// Tests pass `minOrphanAgeMs: 0` so freshly-`put`-ed Miniflare objects
// (whose `uploaded` timestamp is the test's wall clock) aren't skipped
// by the production 5-minute upload-race guard. The guard behavior
// itself has a dedicated test at the bottom of this describe block.
describe("sweepOrphanR2Keys", () => {
  it("deletes objects under avatars/ that aren't referenced by any profile", async () => {
    const userId = await seedUser({ status: "approved" });
    const liveKey = `avatars/${userId}/live123.webp`;
    const orphanKey = `avatars/${userId}/orphan456.webp`;
    const bucket = getPublicBucket();
    await bucket.put(liveKey, new Uint8Array([1, 2, 3]));
    await bucket.put(orphanKey, new Uint8Array([4, 5, 6]));

    await getDb().insert(schema.profiles).values({
      userId,
      fullName: "Test User",
      preferredName: "Test",
      phone: "+15555555555",
      ucAffiliation: "student",
      avatarKey: liveKey,
    });

    const count = await sweepOrphanR2Keys(NOW, 0);

    expect(count).toBe(1);
    expect(await bucket.head(liveKey)).not.toBeNull();
    expect(await bucket.head(orphanKey)).toBeNull();
  });

  it("treats landing hero slide image keys as live", async () => {
    const liveKey = "landing/hero/live789.webp";
    const orphanKey = "landing/hero/orphanabc.webp";
    const bucket = getPublicBucket();
    await bucket.put(liveKey, new Uint8Array([1]));
    await bucket.put(orphanKey, new Uint8Array([2]));

    await getDb()
      .insert(schema.heroSlides)
      .values({
        id: uid("hs"),
        imageKey: liveKey,
        alt: "live slide",
        sortOrder: 0,
      });

    const count = await sweepOrphanR2Keys(NOW, 0);

    expect(count).toBe(1);
    expect(await bucket.head(liveKey)).not.toBeNull();
    expect(await bucket.head(orphanKey)).toBeNull();
  });

  it("parses about.image_key / meeting.image_key from landing_settings JSON", async () => {
    const aboutKey = "landing/about/aboutdef.webp";
    const meetingKey = "landing/meeting/meetghi.webp";
    const orphanKey = "landing/about/orphanjkl.webp";
    const bucket = getPublicBucket();
    await bucket.put(aboutKey, new Uint8Array([1]));
    await bucket.put(meetingKey, new Uint8Array([2]));
    await bucket.put(orphanKey, new Uint8Array([3]));

    await getDb()
      .insert(schema.landingSettings)
      .values([
        { key: "about.image_key", valueJson: JSON.stringify(aboutKey) },
        { key: "meeting.image_key", valueJson: JSON.stringify(meetingKey) },
      ]);

    const count = await sweepOrphanR2Keys(NOW, 0);

    expect(count).toBe(1);
    expect(await bucket.head(aboutKey)).not.toBeNull();
    expect(await bucket.head(meetingKey)).not.toBeNull();
    expect(await bucket.head(orphanKey)).toBeNull();
  });

  it("tolerates malformed JSON in landing_settings without failing the sweep", async () => {
    const orphanKey = "landing/about/orphan.webp";
    const bucket = getPublicBucket();
    await bucket.put(orphanKey, new Uint8Array([1]));

    await getDb()
      .insert(schema.landingSettings)
      .values({ key: "about.image_key", valueJson: "{not valid json" });

    // Should not throw — sweep continues, treating the malformed row as
    // "no live key found" and orphaning the bucket object.
    const count = await sweepOrphanR2Keys(NOW, 0);

    expect(count).toBe(1);
    expect(await bucket.head(orphanKey)).toBeNull();
  });

  it("skips R2 objects newer than minOrphanAgeMs (PUT/UPDATE race guard)", async () => {
    // Simulates a member upload caught mid-flight: R2 PUT has landed
    // but the corresponding profile.avatar_key UPDATE hasn't yet, so
    // the cron sees the key as unreferenced. The age guard must keep
    // it for the next sweep instead of clipping a real upload.
    const orphanKey = "avatars/inflight/upload.webp";
    const bucket = getPublicBucket();
    await bucket.put(orphanKey, new Uint8Array([7]));

    // 5-minute guard, run "now" — the just-uploaded object is well
    // inside the skip window.
    const count = await sweepOrphanR2Keys(
      Temporal.Now.instant(),
      5 * 60 * 1000,
    );

    expect(count).toBe(0);
    expect(await bucket.head(orphanKey)).not.toBeNull();
  });
});

describe("runRetentionSweeps", () => {
  it("aggregates counts across every sweep", async () => {
    // Seed one row that each sweep will pick up.
    const rejectedId = await seedUser({
      status: "rejected",
      rejectedAt: NOW.subtract({ milliseconds: 31 * DAY_MS }),
    });
    const deactivatedId = await seedUser({
      status: "deactivated",
      deactivatedAt: NOW.subtract({ milliseconds: 366 * DAY_MS }),
    });
    const userForWaiver = await seedUser({ status: "approved" });
    await seedWaiverAttestation({
      userId: userForWaiver,
      revokedAt: NOW.subtract({ milliseconds: 91 * DAY_MS }),
    });
    await getPublicBucket().put("avatars/orphan/x.webp", new Uint8Array([0]));

    // minOrphanAgeMs: 0 — bypass the orphan-GC upload-race guard so
    // the just-`put`-ed fixture object isn't held back; the guard
    // itself is exercised in `sweepOrphanR2Keys` tests.
    const counts = await runRetentionSweeps(NOW, { minOrphanAgeMs: 0 });

    expect(counts).toEqual({
      rejectedRegistrations: 1,
      deactivatedAccounts: 1,
      revokedWaivers: 1,
      orphanR2Keys: 1,
      resolvedScreenshots: 0,
      orphanPrivateR2Keys: 0,
      // Seeded nothing for it; the key must still be reported, because
      // the orchestrator's contract is that every sweep answers.
      emailSendLog: 0,
      emailOutbox: 0,
      webauthnCeremonies: 0,
      expiredSessions: 0,
      expiredMagicLinks: 0,
    });

    // Verify side effects landed.
    const remaining = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, rejectedId));
    expect(remaining).toHaveLength(0);
    const remainingDeact = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, deactivatedId));
    expect(remainingDeact).toHaveLength(0);
  });
});

describe("sweepEmailSendLog", () => {
  async function seedSend(ageDays: number) {
    await getDb()
      .insert(schema.emailSends)
      .values({
        id: uid("snd"),
        kind: "auth.magic_link",
        sentAt: NOW.subtract({ milliseconds: ageDays * DAY_MS }),
        ok: true,
      });
  }

  it("drops rows past the 90-day window and keeps the rest", async () => {
    await seedSend(91);
    await seedSend(89);

    expect(await sweepEmailSendLog(NOW)).toBe(1);

    const left = await getDb().select().from(schema.emailSends);
    expect(left).toHaveLength(1);
  });

  it("keeps a row sitting exactly on the boundary", async () => {
    // The cutoff is `sentAt < cutoff`, so a row stamped exactly at it
    // survives. Pinned because an off-by-one here silently shortens a
    // retention window nobody is watching.
    await seedSend(90);

    expect(await sweepEmailSendLog(NOW)).toBe(0);
    expect(await getDb().select().from(schema.emailSends)).toHaveLength(1);
  });

  it("is reported by the orchestrator under its own counter", async () => {
    await seedSend(120);

    const counts = await runRetentionSweeps(NOW);

    expect(counts.emailSendLog).toBe(1);
  });
});

describe("sweepWebauthnCeremonies", () => {
  async function seedConsumed(expiresAt: Temporal.Instant) {
    await getDb()
      .insert(schema.webauthnConsumedCeremonies)
      .values({ id: uid("cer"), expiresAt });
  }

  it("drops markers for expired ceremonies and keeps live ones", async () => {
    await seedConsumed(NOW.subtract({ milliseconds: 1 }));
    await seedConsumed(NOW.add({ seconds: 60 }));

    expect(await sweepWebauthnCeremonies(NOW)).toBe(1);
    expect(await getDb().$count(schema.webauthnConsumedCeremonies)).toBe(1);
  });

  it("is reported by the orchestrator under its own counter", async () => {
    await seedConsumed(NOW.subtract({ milliseconds: DAY_MS }));

    const counts = await runRetentionSweeps(NOW);

    expect(counts.webauthnCeremonies).toBe(1);
  });
});

describe("sweepExpiredSessions", () => {
  async function seedSession(expiresAt: Temporal.Instant): Promise<string> {
    const userId = await seedUser({ status: "approved" });
    const id = uid("ses");
    await getDb()
      .insert(schema.sessions)
      .values({
        id,
        userId,
        createdAt: expiresAt.subtract({ milliseconds: 30 * DAY_MS }),
        lastSeenAt: expiresAt.subtract({ milliseconds: 30 * DAY_MS }),
        expiresAt,
      });
    return id;
  }

  it("drops expired sessions and keeps live ones", async () => {
    await seedSession(NOW.subtract({ milliseconds: 1 }));
    const live = await seedSession(NOW.add({ seconds: 60 }));

    expect(await sweepExpiredSessions(NOW)).toBe(1);

    const left = await getDb().select().from(schema.sessions);
    expect(left.map((row) => row.id)).toEqual([live]);
  });

  it("keeps a session expiring exactly now", async () => {
    await seedSession(NOW);

    expect(await sweepExpiredSessions(NOW)).toBe(0);
  });

  it("is reported by the orchestrator under its own counter", async () => {
    await seedSession(NOW.subtract({ milliseconds: DAY_MS }));

    const counts = await runRetentionSweeps(NOW);

    expect(counts.expiredSessions).toBe(1);
  });
});

describe("sweepExpiredMagicLinks", () => {
  function magicLink(
    expiresAt: Temporal.Instant,
    consumedAt: Temporal.Instant | null = null,
  ) {
    return {
      tokenHash: uid("tok"),
      email: "member@example.com",
      intent: "login" as const,
      createdAt: expiresAt.subtract({ minutes: 15 }),
      expiresAt,
      consumedAt,
    };
  }

  it("drops expired links, consumed or not, and keeps live ones", async () => {
    const expired = NOW.subtract({ milliseconds: 1 });
    const live = magicLink(NOW.add({ seconds: 60 }));
    await insertMany(schema.magicLinks, [
      magicLink(expired),
      magicLink(expired, expired.subtract({ minutes: 5 })),
      live,
    ]);

    expect(await sweepExpiredMagicLinks(NOW)).toBe(2);

    const left = await getDb().select().from(schema.magicLinks);
    expect(left.map((row) => row.tokenHash)).toEqual([live.tokenHash]);
  });

  it("keeps a consumed link until it expires", async () => {
    await insertMany(schema.magicLinks, [
      magicLink(NOW.add({ minutes: 10 }), NOW.subtract({ minutes: 1 })),
    ]);

    expect(await sweepExpiredMagicLinks(NOW)).toBe(0);
  });

  it("deletes at most EXPIRED_ROWS_PER_TICK rows, oldest first", async () => {
    const rows = Array.from({ length: EXPIRED_ROWS_PER_TICK + 1 }, (_, i) =>
      magicLink(NOW.subtract({ seconds: EXPIRED_ROWS_PER_TICK + 1 - i })),
    );
    await insertMany(schema.magicLinks, rows);

    expect(await sweepExpiredMagicLinks(NOW)).toBe(EXPIRED_ROWS_PER_TICK);

    // The newest expiry is the one the cap left for the next tick.
    const left = await getDb().select().from(schema.magicLinks);
    expect(left.map((row) => row.tokenHash)).toEqual([rows.at(-1)?.tokenHash]);
    expect(await sweepExpiredMagicLinks(NOW)).toBe(1);
  });

  it("is reported by the orchestrator under its own counter", async () => {
    await insertMany(schema.magicLinks, [
      magicLink(NOW.subtract({ milliseconds: DAY_MS })),
    ]);

    const counts = await runRetentionSweeps(NOW);

    expect(counts.expiredMagicLinks).toBe(1);
  });
});

describe("expiry sweeps use their expires_at index", () => {
  // The issue this closes (#373) asked for it outright: without the index
  // every daily sweep reads the whole table, and those reads are billed.
  it.each([
    [
      "sessions_expires_at_idx",
      schema.sessions,
      schema.sessions.id,
      schema.sessions.expiresAt,
    ],
    [
      "magic_links_expires_at_idx",
      schema.magicLinks,
      schema.magicLinks.tokenHash,
      schema.magicLinks.expiresAt,
    ],
    [
      "webauthn_consumed_ceremonies_expires_at_idx",
      schema.webauthnConsumedCeremonies,
      schema.webauthnConsumedCeremonies.id,
      schema.webauthnConsumedCeremonies.expiresAt,
    ],
  ])("%s", async (indexName, table, id, expiresAt) => {
    const query = expiredRowsDelete(table, id, expiresAt, NOW).toSQL();
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
      .bind(...query.params)
      .all<{ detail: string }>();
    const plan = results.map((row) => row.detail);

    expect(plan.some((step) => step.includes(indexName))).toBe(true);
    // No full scan of the table anywhere in the statement.
    expect(plan.filter((step) => /^SCAN \w+$/.test(step))).toEqual([]);
  });
});

// ── site-feedback screenshots ─────────────────────────────────────────

async function seedReportWithScreenshot(opts: {
  status?: schema.SiteFeedbackStatus;
  statusChangedAt?: Temporal.Instant | null;
}): Promise<{ id: string; key: string }> {
  const id = uid("sfb");
  const key = `site-feedback/screenshots/${id}.webp`;
  await getPrivateBucket().put(key, new Uint8Array([1, 2, 3]));
  await getDb()
    .insert(schema.siteFeedback)
    .values({
      id,
      kind: "bug",
      title: "t",
      body: "b",
      status: opts.status ?? "open",
      statusChangedAt: opts.statusChangedAt ?? null,
      screenshotKey: key,
      screenshotBytes: 3,
    });
  return { id, key };
}

async function linkToIssue(
  feedbackId: string,
  state: "draft" | "open" | "closed",
  closedAt: Temporal.Instant | null,
): Promise<void> {
  const issueId = uid("sfi");
  await getDb()
    .insert(schema.siteFeedbackIssues)
    .values({ id: issueId, state, title: "i", closedAt });
  await getDb()
    .insert(schema.siteFeedbackIssueLinks)
    .values({ issueId, feedbackId, quotedMd: "q" });
}

async function reportRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.siteFeedback)
    .where(eq(schema.siteFeedback.id, id));
  return row;
}

describe("sweepResolvedSiteFeedbackScreenshots", () => {
  it("deletes due screenshots in one batch, nulls screenshot_key and stamps screenshot_purged_at", async () => {
    const disposed = await seedReportWithScreenshot({
      status: "wont_fix",
      statusChangedAt: NOW.subtract({ milliseconds: 31 * DAY_MS }),
    });
    const filed = await seedReportWithScreenshot({});
    await linkToIssue(
      filed.id,
      "closed",
      NOW.subtract({ milliseconds: 40 * DAY_MS }),
    );

    expect(await sweepResolvedSiteFeedbackScreenshots(NOW)).toBe(2);

    for (const report of [disposed, filed]) {
      expect(await getPrivateBucket().head(report.key)).toBeNull();
      const row = await reportRow(report.id);
      expect(row.screenshotKey).toBeNull();
      expect(row.screenshotPurgedAt?.epochMilliseconds).toBe(
        NOW.epochMilliseconds,
      );
    }
  });

  it("leaves not-yet-due rows and objects alone", async () => {
    const recent = await seedReportWithScreenshot({
      status: "duplicate",
      statusChangedAt: NOW.subtract({ milliseconds: 29 * DAY_MS }),
    });
    const open = await seedReportWithScreenshot({
      status: "open",
      statusChangedAt: NOW.subtract({ milliseconds: 90 * DAY_MS }),
    });
    const stillTracked = await seedReportWithScreenshot({});
    await linkToIssue(
      stillTracked.id,
      "closed",
      NOW.subtract({ milliseconds: 90 * DAY_MS }),
    );
    await linkToIssue(stillTracked.id, "open", null);
    const drafted = await seedReportWithScreenshot({
      status: "wont_fix",
      statusChangedAt: NOW.subtract({ milliseconds: 90 * DAY_MS }),
    });
    await linkToIssue(drafted.id, "draft", null);

    expect(await sweepResolvedSiteFeedbackScreenshots(NOW)).toBe(0);
    for (const report of [recent, open, stillTracked, drafted]) {
      expect(await getPrivateBucket().head(report.key)).not.toBeNull();
      expect((await reportRow(report.id)).screenshotKey).toBe(report.key);
    }
  });
});

describe("sweepOrphanPrivateR2Keys", () => {
  it("orphan sweep deletes an unreferenced site-feedback/screenshots/ object older than the age guard", async () => {
    const key = "site-feedback/screenshots/sfb_gone.webp";
    await getPrivateBucket().put(key, new Uint8Array([1]));
    expect(await sweepOrphanPrivateR2Keys(NOW, 0)).toBe(1);
    expect(await getPrivateBucket().head(key)).toBeNull();
  });

  it("orphan sweep keeps a referenced screenshot and a fresh unreferenced one", async () => {
    const live = await seedReportWithScreenshot({});
    const fresh = "site-feedback/screenshots/sfb_inflight.webp";
    await getPrivateBucket().put(fresh, new Uint8Array([1]));
    expect(
      await sweepOrphanPrivateR2Keys(Temporal.Now.instant(), 5 * 60 * 1000),
    ).toBe(0);
    expect(await sweepOrphanPrivateR2Keys(NOW, 5 * 60 * 1000)).toBe(1);
    expect(await getPrivateBucket().head(live.key)).not.toBeNull();
    expect(await getPrivateBucket().head(fresh)).toBeNull();
  });

  it("never touches objects outside its prefixes", async () => {
    await getPrivateBucket().put("waivers/x.pdf", new Uint8Array([1]));
    expect(await sweepOrphanPrivateR2Keys(NOW, 0)).toBe(0);
    expect(await getPrivateBucket().head("waivers/x.pdf")).not.toBeNull();
  });
});

describe("sweepOrphanPrivateR2Keys album originals", () => {
  const photoId = "0190b6a2-7c1e-7a3b-8f2d-1c2d3e4f5a6b";
  const originalKey = `album-originals/${photoId}/0123456789abcdef.jpg`;
  const fullKey = `album-full/${photoId}/0123456789abcdef.webp`;

  async function putBoth(): Promise<void> {
    await getPrivateBucket().put(originalKey, new Uint8Array([1]));
    await getPrivateBucket().put(fullKey, new Uint8Array([2]));
  }

  it("sweeps an old unreferenced album original and full copy", async () => {
    await putBoth();
    expect(await sweepOrphanPrivateR2Keys(NOW, 0)).toBe(2);
    expect(await getPrivateBucket().head(originalKey)).toBeNull();
    expect(await getPrivateBucket().head(fullKey)).toBeNull();
  });

  it("keeps album keys a row references", async () => {
    await putBoth();
    await getDb()
      .insert(schema.albumPhotos)
      .values({
        id: photoId,
        publicId: uid("pub").slice(0, 12),
        altText: "alt",
        imageKey: `gallery/${photoId}/aaaaaaaaaaaaaaaa.webp`,
        imageBytes: 1,
        widthPx: 1600,
        heightPx: 1200,
        originalKey,
        fullKey,
      });
    expect(await sweepOrphanPrivateR2Keys(NOW, 0)).toBe(0);
    expect(await getPrivateBucket().head(originalKey)).not.toBeNull();
    expect(await getPrivateBucket().head(fullKey)).not.toBeNull();
  });

  it("keeps a young unreferenced original", async () => {
    await putBoth();
    expect(await sweepOrphanPrivateR2Keys(Temporal.Now.instant())).toBe(0);
    expect(await getPrivateBucket().head(originalKey)).not.toBeNull();
    expect(await getPrivateBucket().head(fullKey)).not.toBeNull();
    // Once they are old enough, the same objects are swept.
    expect(await sweepOrphanPrivateR2Keys(NOW)).toBe(2);
  });

  // The upload waits on a member cropping and captioning, so a dialog
  // open over the daily sweep must not lose its original.
  it("keeps a 30-minute-old unreferenced original while sweeping a screenshot that age", async () => {
    await putBoth();
    const screenshot = "site-feedback/screenshots/sfb_old.webp";
    await getPrivateBucket().put(screenshot, new Uint8Array([1]));
    const thirtyMinutesOn = Temporal.Now.instant().add({ minutes: 30 });
    expect(await sweepOrphanPrivateR2Keys(thirtyMinutesOn)).toBe(1);
    expect(await getPrivateBucket().head(screenshot)).toBeNull();
    expect(await getPrivateBucket().head(originalKey)).not.toBeNull();
    expect(await getPrivateBucket().head(fullKey)).not.toBeNull();
  });

  it("sweeps a 25-hour-old unreferenced original", async () => {
    await putBoth();
    const twentyFiveHoursOn = Temporal.Now.instant().add({ hours: 25 });
    expect(await sweepOrphanPrivateR2Keys(twentyFiveHoursOn)).toBe(2);
    expect(await getPrivateBucket().head(originalKey)).toBeNull();
    expect(await getPrivateBucket().head(fullKey)).toBeNull();
  });
});

describe("runRetentionSweeps screenshots", () => {
  it("runRetentionSweeps reports resolvedScreenshots and orphanPrivateR2Keys", async () => {
    await seedReportWithScreenshot({
      status: "resolved",
      statusChangedAt: NOW.subtract({ milliseconds: 31 * DAY_MS }),
    });
    await getPrivateBucket().put(
      "site-feedback/screenshots/sfb_orphan.webp",
      new Uint8Array([1]),
    );
    const counts = await runRetentionSweeps(NOW, { minOrphanAgeMs: 0 });
    expect(counts).toMatchObject({
      resolvedScreenshots: 1,
      orphanPrivateR2Keys: 1,
    });
  });
});
