/**
 * The gear reminder job, end to end against real D1 with the email
 * provider stubbed.
 *
 * The ladder's policy is covered exhaustively and without a database in
 * `features/gear/lib/__tests__/loan-reminders.test.ts`. What is left
 * here is everything the pure function can't answer: the kill switch,
 * batching by member, the opt-out rules, who the mail actually goes to,
 * and — the one that matters most — that a stage is advanced only after
 * a send that actually succeeded.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CLUB_TIME_ZONE } from "#/config/time";
import type * as Resend from "#/server/email/resend";
import { getDb, schema } from "#/server/db";

// ── mocks ──────────────────────────────────────────────────────────────

const sent: Resend.EmailMessage[] = [];
const sendBehaviour = vi.hoisted(() => ({ fail: false }));

vi.mock("#/server/email/resend", async (importOriginal) => {
  const actual = await importOriginal<typeof Resend>();
  return {
    ...actual,
    sendEmail: vi.fn(async (message: Resend.EmailMessage) => {
      if (sendBehaviour.fail) throw new Error("provider exploded");
      sent.push(message);
    }),
  };
});

const { runGearLoanReminders } =
  await import("#/server/cron/gear-reminders.server");
const { setNotificationPreference } =
  await import("#/server/notifications/notification-prefs-repo.server");

// ── helpers ────────────────────────────────────────────────────────────

const at = (isoDate: string): Temporal.Instant =>
  Temporal.ZonedDateTime.from(
    `${isoDate}T09:00:00[${CLUB_TIME_ZONE}]`,
  ).toInstant();

/** End-of-day Cincinnati, the way `computeDueAt` stamps a due date. */
const dueOn = (isoDate: string): Temporal.Instant =>
  Temporal.ZonedDateTime.from(
    `${isoDate}T23:59:59.999[${CLUB_TIME_ZONE}]`,
  ).toInstant();

async function setSetting(key: string, value: unknown): Promise<void> {
  await getDb()
    .insert(schema.siteSettings)
    .values({ key, valueJson: JSON.stringify(value) })
    .onConflictDoUpdate({
      target: schema.siteSettings.key,
      set: { valueJson: JSON.stringify(value) },
    });
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${(seq += 1)}`;

async function seedMember(options: {
  preferredName?: string;
  /** Omit to model a member with no verified primary address. */
  email?: string | null;
}): Promise<string> {
  const id = nextId("user");
  const db = getDb();
  await db.insert(schema.users).values({
    id,
    publicId: `${id}pub`.padEnd(12, "0").slice(0, 12),
    status: "approved",
  });
  await db.insert(schema.profiles).values({
    userId: id,
    fullName: "Test Member",
    preferredName: options.preferredName ?? "Sam",
    phone: "+15135550100",
    ucAffiliation: "student",
  });
  if (options.email !== null) {
    await db.insert(schema.userEmails).values({
      id: nextId("uem"),
      userId: id,
      email: options.email ?? `${id}@example.com`,
      isPrimary: true,
      verifiedAt: at("2026-01-01"),
    });
  }
  return id;
}

let typeId: string | null = null;
let modelId: string | null = null;

async function seedCatalog(): Promise<string> {
  if (modelId) return modelId;
  const db = getDb();
  typeId = nextId("gt");
  await db
    .insert(schema.gearTypes)
    .values({ id: typeId, publicId: nextId("gtp"), name: "Harness" });
  modelId = nextId("gm");
  await db.insert(schema.gearModels).values({
    id: modelId,
    publicId: nextId("gmp"),
    typeId,
    manufacturer: "Petzl",
    name: "Corax",
    tracking: "coded",
  });
  return modelId;
}

async function seedLoan(options: {
  memberUserId: string;
  dueAt: Temporal.Instant;
  code?: string;
  reminderStage?: "none" | "due_soon" | "overdue" | "flagged" | "blocked";
}): Promise<string> {
  const db = getDb();
  const model = await seedCatalog();
  const itemId = nextId("gi");
  await db.insert(schema.gearItems).values({
    id: itemId,
    publicId: nextId("gip"),
    modelId: model,
    code: options.code ?? nextId("CH"),
  });
  const loanId = nextId("gl");
  await db.insert(schema.gearLoans).values({
    id: loanId,
    publicId: nextId("glp"),
    itemId,
    modelId: null,
    quantity: 1,
    memberUserId: options.memberUserId,
    checkedOutAt: at("2026-03-01"),
    dueAt: options.dueAt,
    reminderStage: options.reminderStage ?? "none",
  });
  return loanId;
}

const stageOf = async (loanId: string) =>
  (
    await getDb()
      .select({
        stage: schema.gearLoans.reminderStage,
        lastRemindedAt: schema.gearLoans.lastRemindedAt,
      })
      .from(schema.gearLoans)
      .where(eq(schema.gearLoans.id, loanId))
  ).at(0);

beforeEach(async () => {
  sent.length = 0;
  sendBehaviour.fail = false;
  typeId = null;
  modelId = null;
  const db = getDb();
  await db.delete(schema.gearLoans);
  await db.delete(schema.gearItems);
  await db.delete(schema.gearModels);
  await db.delete(schema.gearTypes);
  await db.delete(schema.userNotificationPreferences);
  await db.delete(schema.profiles);
  await db.delete(schema.userEmails);
  await db.delete(schema.users);
  await db.delete(schema.siteSettings);
  await setSetting("gear.remindersEnabled", true);
});

// ── tests ──────────────────────────────────────────────────────────────

describe("the kill switch", () => {
  it("sends nothing and reads nothing when disabled", async () => {
    await setSetting("gear.remindersEnabled", false);
    const member = await seedMember({});
    await seedLoan({ memberUserId: member, dueAt: dueOn("2026-03-01") });

    const result = await runGearLoanReminders({ now: at("2026-04-01") });

    // The switch an operator reaches for during a bad send has to be the
    // first thing in the path, not a filter near the end.
    expect(result.skipped).toBe(true);
    expect(result.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("defaults to off, so the ladder can land before anyone is mailed", async () => {
    await getDb().delete(schema.siteSettings);
    const member = await seedMember({});
    await seedLoan({ memberUserId: member, dueAt: dueOn("2026-03-01") });

    await expect(
      runGearLoanReminders({ now: at("2026-04-01") }),
    ).resolves.toMatchObject({ skipped: true });
  });
});

describe("batching", () => {
  it("sends one email per member listing every affected loan", async () => {
    const member = await seedMember({ preferredName: "Robin" });
    await seedLoan({
      memberUserId: member,
      dueAt: dueOn("2026-03-01"),
      code: "CH1",
    });
    await seedLoan({
      memberUserId: member,
      dueAt: dueOn("2026-03-02"),
      code: "CH2",
    });

    const result = await runGearLoanReminders({ now: at("2026-03-05") });

    // Four overdue items must not mean four emails — that is how a
    // reminder system teaches people to filter it.
    expect(result.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("CH1");
    expect(sent[0].text).toContain("CH2");
    expect(sent[0].text).toContain("Robin");
  });

  it("writes the message at the worst rung in the batch", async () => {
    const member = await seedMember({});
    // One merely overdue, one long past the block threshold.
    await seedLoan({ memberUserId: member, dueAt: dueOn("2026-03-04") });
    await seedLoan({ memberUserId: member, dueAt: dueOn("2026-02-01") });

    await runGearLoanReminders({ now: at("2026-03-05") });

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/can't borrow/i);
  });

  it("keeps two members' gear in two emails", async () => {
    const a = await seedMember({ email: "a@example.com" });
    const b = await seedMember({ email: "b@example.com" });
    await seedLoan({ memberUserId: a, dueAt: dueOn("2026-03-01") });
    await seedLoan({ memberUserId: b, dueAt: dueOn("2026-03-01") });

    await runGearLoanReminders({ now: at("2026-03-05") });

    expect(sent.map((m) => m.to).sort()).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("does not merge a due-soon nudge into an overdue notice", async () => {
    const member = await seedMember({});
    await seedLoan({ memberUserId: member, dueAt: dueOn("2026-03-01") });
    await seedLoan({ memberUserId: member, dueAt: dueOn("2026-03-06") });
    await setSetting("gear.dueSoonLeadDays", 2);

    await runGearLoanReminders({ now: at("2026-03-05") });

    // Two categories with different opt-out rules. Merging them would
    // put courtesy content inside mail that carries no unsubscribe.
    expect(sent).toHaveLength(2);
    const withUnsub = sent.filter((m) => m.headers?.["List-Unsubscribe"]);
    expect(withUnsub).toHaveLength(1);
  });
});

describe("idempotence", () => {
  it("advances the stage and says nothing on a second run", async () => {
    const member = await seedMember({});
    const loan = await seedLoan({
      memberUserId: member,
      dueAt: dueOn("2026-03-01"),
    });

    await runGearLoanReminders({ now: at("2026-03-05") });
    expect(sent).toHaveLength(1);
    expect((await stageOf(loan))?.stage).toBe("overdue");

    sent.length = 0;
    const second = await runGearLoanReminders({ now: at("2026-03-05") });

    expect(second.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("stamps lastRemindedAt without using it as the dedupe", async () => {
    const member = await seedMember({});
    const loan = await seedLoan({
      memberUserId: member,
      dueAt: dueOn("2026-03-01"),
    });
    const now = at("2026-03-05");

    await runGearLoanReminders({ now });

    expect((await stageOf(loan))?.lastRemindedAt?.epochMilliseconds).toBe(
      now.epochMilliseconds,
    );
  });

  it("climbs to the next rung when one is actually reached", async () => {
    const member = await seedMember({});
    const loan = await seedLoan({
      memberUserId: member,
      dueAt: dueOn("2026-03-01"),
      reminderStage: "overdue",
    });

    await runGearLoanReminders({ now: at("2026-03-08") });

    expect(sent).toHaveLength(1);
    expect((await stageOf(loan))?.stage).toBe("flagged");
  });
});

describe("opt-out rules", () => {
  it("honours an opt-out from the courtesy nudge, and still advances the rung", async () => {
    const member = await seedMember({});
    await setSetting("gear.dueSoonLeadDays", 2);
    const loan = await seedLoan({
      memberUserId: member,
      dueAt: dueOn("2026-03-06"),
    });
    await setNotificationPreference({
      userId: member,
      category: "gear.loan_due_soon",
      channel: "email",
      enabled: false,
      source: "user",
    });

    const result = await runGearLoanReminders({ now: at("2026-03-05") });

    expect(result.suppressed).toBe(1);
    expect(sent).toHaveLength(0);
    // Advanced anyway: the member made a choice, and leaving the rung
    // unrecorded would re-evaluate them every morning forever.
    expect((await stageOf(loan))?.stage).toBe("due_soon");
  });

  it("sends the overdue notice despite a stored opt-out row", async () => {
    const member = await seedMember({});
    await seedLoan({ memberUserId: member, dueAt: dueOn("2026-03-01") });
    // The action refuses to write this; a bug, a migration or a future
    // unsubscribe link could still plant it. The notice must go anyway.
    await setNotificationPreference({
      userId: member,
      category: "gear.loan_overdue",
      channel: "email",
      enabled: false,
      source: "unsubscribe_link",
    });

    await runGearLoanReminders({ now: at("2026-03-05") });

    expect(sent).toHaveLength(1);
  });
});

describe("the unsubscribe header", () => {
  it("is on the courtesy nudge and absent from the overdue notice", async () => {
    const member = await seedMember({});
    await setSetting("gear.dueSoonLeadDays", 2);
    await seedLoan({ memberUserId: member, dueAt: dueOn("2026-03-06") });
    await runGearLoanReminders({ now: at("2026-03-05") });
    expect(sent[0].headers?.["List-Unsubscribe"]).toBeTruthy();

    sent.length = 0;
    const other = await seedMember({ email: "late@example.com" });
    await seedLoan({ memberUserId: other, dueAt: dueOn("2026-03-01") });
    await runGearLoanReminders({ now: at("2026-03-05") });

    // An overdue notice is a relationship message about club property
    // the member is holding. There is no opt-out to offer, so offering
    // one would be a lie.
    expect(sent[0].headers?.["List-Unsubscribe"]).toBeUndefined();
  });
});

describe("failure handling", () => {
  it("leaves the stage alone when the send throws, so tomorrow retries", async () => {
    const member = await seedMember({});
    const loan = await seedLoan({
      memberUserId: member,
      dueAt: dueOn("2026-03-01"),
    });
    sendBehaviour.fail = true;

    const result = await runGearLoanReminders({ now: at("2026-03-05") });

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    // The whole point of sending before advancing: marking unsent mail
    // as sent means the member never hears anything at all.
    expect((await stageOf(loan))?.stage).toBe("none");
  });

  it("skips a member with no verified primary address without advancing", async () => {
    const member = await seedMember({ email: null });
    const loan = await seedLoan({
      memberUserId: member,
      dueAt: dueOn("2026-03-01"),
    });

    const result = await runGearLoanReminders({ now: at("2026-03-05") });

    expect(result.noEmail).toBe(1);
    expect(sent).toHaveLength(0);
    // Not advanced: if they verify an address later, the ladder picks
    // them up where they actually are.
    expect((await stageOf(loan))?.stage).toBe("none");
  });
});

describe("scope", () => {
  it("ignores returned loans", async () => {
    const member = await seedMember({});
    const loanId = await seedLoan({
      memberUserId: member,
      dueAt: dueOn("2026-03-01"),
    });
    await getDb()
      .update(schema.gearLoans)
      .set({ returnedAt: at("2026-03-02") })
      .where(eq(schema.gearLoans.id, loanId));

    await runGearLoanReminders({ now: at("2026-03-05") });

    expect(sent).toHaveLength(0);
  });

  it("ignores loans already at the terminal rung", async () => {
    const member = await seedMember({});
    await seedLoan({
      memberUserId: member,
      dueAt: dueOn("2026-01-01"),
      reminderStage: "blocked",
    });

    await runGearLoanReminders({ now: at("2026-06-01") });

    // Terminal on purpose — past the block threshold it is officer
    // chasing, not a daily email forever.
    expect(sent).toHaveLength(0);
  });
});
