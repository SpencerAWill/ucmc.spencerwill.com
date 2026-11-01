import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
import { createRole, createUser } from "#/test-support/factories/users";
import type { CreateRecordInput } from "#/features/conduct/server/limits";
import type * as RepoModuleNs from "#/features/conduct/server/record-repo.server";
import type * as DeactivateModuleNs from "#/server/members/deactivate.server";

type RepoModule = typeof RepoModuleNs;

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

const sent = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const sendBehaviour = vi.hoisted(() => ({
  fail: false,
  onSend: null as null | (() => Promise<void>),
}));
vi.mock("#/server/email/resend", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    sendEmail: vi.fn(async (message: Record<string, unknown>) => {
      if (sendBehaviour.onSend) {
        await sendBehaviour.onSend();
      }
      if (sendBehaviour.fail) {
        throw new Error("provider exploded");
      }
      sent.push(message);
    }),
  };
});

// Pass-through, so a race test can hand an action the record as it was
// before a competing request changed it.
vi.mock(
  "#/features/conduct/server/record-repo.server",
  async (importOriginal) => {
    const actual = await importOriginal<RepoModule>();
    return {
      ...actual,
      findRecordForMutation: vi.fn(actual.findRecordForMutation),
    };
  },
);

// Pass-through, so a test can make the deactivation step fail.
vi.mock("#/server/members/deactivate.server", async (importOriginal) => {
  const actual = await importOriginal<typeof DeactivateModuleNs>();
  return {
    ...actual,
    deactivateUserStatements: vi.fn(actual.deactivateUserStatements),
  };
});

const repo = await import("#/features/conduct/server/record-repo.server");
const { deactivateUserStatements } =
  await import("#/server/members/deactivate.server");
const actions = await import("#/features/conduct/server/record-actions.server");
const { getMyActiveSanctionsAction } =
  await import("#/features/conduct/server/my-conduct-actions.server");
const { requireConductReporter } =
  await import("#/features/conduct/server/conduct-guards.server");
const { createRecordSchema } = await import("#/features/conduct/server/limits");
const { openSession } = await import("#/server/auth/session.server");
const { isBlockedEmail, standingFor } =
  await import("#/server/conduct/standing.server");
const { getMyTerminationNoticeAction } =
  await import("#/features/conduct/server/termination-notice-actions.server");
const { writeProofCookie } = await import("#/server/auth/proof-cookie.server");
const { APPEAL_LINE } = await import("#/server/email/conduct-email");
const { base64UrlEncode } = await import("#/server/auth/signing.server");

// ── helpers ────────────────────────────────────────────────────────────

const STATEMENT = "You are warned for SECRET-STATEMENT behaviour.";
const NOTES = "SECRET-NOTES about what happened.";

async function signInAs(userId: string): Promise<void> {
  cookieJar.clear();
  await openSession(userId);
}

async function signInManager() {
  const user = await createUser({
    roles: ["role_president"],
    profile: { fullName: "Pat President" },
  });
  await signInAs(user.id);
  return user;
}

async function signInWith(permissions: string[]) {
  const role = await createRole({ permissions });
  const user = await createUser({ roles: [role.id] });
  await signInAs(user.id);
  return user;
}

async function subject(fullName = "Sam Subject") {
  return createUser({ profile: { fullName } });
}

async function insertReport(
  subjectUserId: string | null,
  possibleScoc: boolean,
): Promise<string> {
  const id = `crep_${crypto.randomUUID()}`;
  await getDb()
    .insert(schema.conductReports)
    .values({
      id,
      publicId: id,
      subjectUserId,
      subjectDescription: subjectUserId === null ? "Someone at the crag" : null,
      occurredOn: Temporal.PlainDate.from("2026-10-01"),
      body: "Report body",
      possibleScoc,
    });
  return id;
}

/** Parse as the server fn validator would, then call the action. */
function create(input: CreateRecordInput) {
  return actions.createConductRecordAction(createRecordSchema.parse(input));
}

function note(subjectUserId: string, extra: Partial<CreateRecordInput> = {}) {
  return {
    level: "note",
    subjectUserId,
    internalNotes: NOTES,
    possibleScoc: false,
    reportIds: [],
    ...extra,
  } as CreateRecordInput;
}

function warning(
  subjectUserId: string,
  extra: Partial<CreateRecordInput> = {},
) {
  return {
    level: "warning",
    subjectUserId,
    internalNotes: NOTES,
    memberStatement: STATEMENT,
    possibleScoc: false,
    reportIds: [],
    ...extra,
  } as CreateRecordInput;
}

function termination(
  subjectUserId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    level: "termination",
    subjectUserId,
    internalNotes: NOTES,
    memberStatement: STATEMENT,
    possibleScoc: false,
    reportIds: [],
    vote: {
      heldOn: "2026-10-20",
      for: 5,
      against: 1,
      abstain: 0,
      committeeSize: 7,
    },
    ...extra,
  } as CreateRecordInput;
}

async function recordRow(publicId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.conductRecords)
    .where(eq(schema.conductRecords.publicId, publicId));
  return row;
}

async function auditRows(publicId: string) {
  return getDb()
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.targetType, "conduct_record"),
        eq(schema.auditLog.targetId, publicId),
      ),
    );
}

// ── setup ──────────────────────────────────────────────────────────────

beforeEach(async () => {
  cookieJar.clear();
  sent.length = 0;
  sendBehaviour.fail = false;
  sendBehaviour.onSend = null;
  const db = getDb();
  await db.delete(schema.auditLog);
  await db
    .delete(schema.conductRecords)
    .where(eq(schema.conductRecords.level, "termination"));
  await db.delete(schema.conductRecords);
  await db.delete(schema.conductReports);
  await db.delete(schema.conductBlockedEmails);
  await db.delete(schema.sessions);
  await db.delete(schema.userRoles);
  await db.delete(schema.profiles);
  await db.delete(schema.users);
});

// ── gates ──────────────────────────────────────────────────────────────

describe("conduct record gates", () => {
  it("mutations need conduct:manage", async () => {
    await signInManager();
    const s = await subject();
    const { publicId } = await create(note(s.id));
    await signInWith(["perm_conduct_view"]);

    await expect(create(note(s.id))).rejects.toThrow("Forbidden");
    await expect(
      actions.updateConductRecordAction({
        recordId: publicId,
        internalNotes: "x",
      }),
    ).rejects.toThrow("Forbidden");
    await expect(
      actions.referConductRecordAction({
        recordId: publicId,
        referredOn: Temporal.PlainDate.from("2026-10-21"),
      }),
    ).rejects.toThrow("Forbidden");
    await expect(
      actions.recordSccsOutcomeAction({
        recordId: publicId,
        outcome: "returned",
        note: "n",
      }),
    ).rejects.toThrow("Forbidden");
    await expect(
      actions.liftConductRecordAction({ recordId: publicId, reason: "r" }),
    ).rejects.toThrow("Forbidden");
  });

  it("reads need conduct:view", async () => {
    await signInWith(["perm_conduct_report"]);
    await expect(actions.listConductRecordsAction({})).rejects.toThrow(
      "Forbidden",
    );
    await expect(actions.getConductRecordAction("crec_x")).rejects.toThrow(
      "Forbidden",
    );
    await expect(requireConductReporter()).resolves.toBeDefined();
  });

  it("the member summary is null without conduct:view", async () => {
    const s = await subject();
    await signInWith(["perm_conduct_report"]);
    await expect(actions.memberConductSummaryAction(s.id)).resolves.toBeNull();
    await signInWith([]);
    await expect(requireConductReporter()).rejects.toThrow("Forbidden");
  });

  it("rejects a signed-out caller", async () => {
    await expect(actions.listConductRecordsAction({})).rejects.toThrow(
      "Not signed in",
    );
  });
});

// ── create ─────────────────────────────────────────────────────────────

describe("createConductRecordAction", () => {
  it("snapshots the subject's full name", async () => {
    await signInManager();
    const s = await subject("Alex Legalname");
    const { publicId } = await create(warning(s.id));
    const row = await recordRow(publicId);
    expect(row.subjectNameSnapshot).toBe("Alex Legalname");
    expect(row.level).toBe("warning");
    expect(row.scocState).toBe("none");
    expect(row.retainUntil).not.toBeNull();
  });

  it("rejects a termination short of two thirds in the validator", () => {
    const result = createRecordSchema.safeParse(
      termination("user_x", {
        warningSkipped: true,
        vote: {
          heldOn: "2026-10-20",
          for: 4,
          against: 3,
          abstain: 0,
          committeeSize: 7,
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("gives an active termination no retention clock", async () => {
    await signInManager();
    const s = await subject();
    const { publicId } = await create(
      termination(s.id, { warningSkipped: true }),
    );
    const row = await recordRow(publicId);
    expect(row.retainUntil).toBeNull();
    expect(row.votesFor).toBe(5);
    expect(row.warningSkipped).toBe(true);
  });

  it("requires the prior warning to be a warning on the same subject", async () => {
    await signInManager();
    const s = await subject();
    const other = await subject("Other Person");
    const { publicId: otherWarning } = await create(warning(other.id));
    const { publicId: aNote } = await create(note(s.id));
    const { publicId: ownWarning } = await create(warning(s.id));

    await expect(
      create(termination(s.id, { priorWarningId: otherWarning })),
    ).rejects.toThrow("Prior warning not found");
    await expect(
      create(termination(s.id, { priorWarningId: aNote })),
    ).rejects.toThrow("Prior warning not found");

    const { publicId } = await create(
      termination(s.id, { priorWarningId: ownWarning }),
    );
    const row = await recordRow(publicId);
    const warningRow = await recordRow(ownWarning);
    expect(row.priorWarningId).toBe(warningRow.id);
  });

  it("cites only reports about the same member, or about no one named", async () => {
    await signInManager();
    const a = await subject("Member A");
    const b = await subject("Member B");
    const aboutA = await insertReport(a.id, false);
    const unnamed = await insertReport(null, false);
    await expect(
      create(warning(b.id, { reportIds: [aboutA] })),
    ).rejects.toThrow("Report not found");
    await expect(
      create(warning(b.id, { reportIds: [unnamed] })),
    ).resolves.toHaveProperty("publicId");
  });

  it("refuses an unknown report", async () => {
    await signInManager();
    const s = await subject();
    await expect(
      create(note(s.id, { reportIds: ["crep_missing"] })),
    ).rejects.toThrow("Report not found");
  });
});

// ── SCOC lock ─────────────────────────────────────────────────────────

describe("the SCOC lock", () => {
  it("refuses a possible-SCOC warning but refers a possible-SCOC note", async () => {
    const manager = await signInManager();
    const s = await subject();
    await expect(create(warning(s.id, { possibleScoc: true }))).rejects.toThrow(
      "Referred to SCCS",
    );

    const { publicId } = await create(note(s.id, { possibleScoc: true }));
    const row = await recordRow(publicId);
    expect(row.scocState).toBe("referred");
    expect(row.referredBy).toBe(manager.id);
    expect(row.referredOn).not.toBeNull();
  });

  it("refers a note that attaches a possible-SCOC report", async () => {
    await signInManager();
    const s = await subject();
    const report = await insertReport(s.id, true);
    const { publicId } = await create(note(s.id, { reportIds: [report] }));
    expect((await recordRow(publicId)).scocState).toBe("referred");
    const links = await getDb()
      .select()
      .from(schema.conductRecordReports)
      .where(eq(schema.conductRecordReports.reportId, report));
    expect(links).toHaveLength(1);
  });

  it("locks a referred record's reports until an outcome is recorded", async () => {
    await signInManager();
    const s = await subject();
    const report = await insertReport(s.id, false);
    const { publicId } = await create(
      note(s.id, { possibleScoc: true, reportIds: [report] }),
    );

    await expect(
      create(warning(s.id, { reportIds: [report] })),
    ).rejects.toThrow("Referred to SCCS");

    await actions.recordSccsOutcomeAction({
      recordId: publicId,
      outcome: "returned",
      note: "SCCS returned it",
    });
    expect((await recordRow(publicId)).scocState).toBe("returned");

    await expect(
      create(warning(s.id, { reportIds: [report] })),
    ).resolves.toHaveProperty("publicId");
  });

  it("clears a possible-SCOC report once SCCS has returned its record", async () => {
    await signInManager();
    const s = await subject();
    const report = await insertReport(s.id, true);
    await expect(
      create(warning(s.id, { reportIds: [report] })),
    ).rejects.toThrow("Referred to SCCS");
    const { publicId } = await create(note(s.id, { reportIds: [report] }));
    await actions.recordSccsOutcomeAction({
      recordId: publicId,
      outcome: "sccs_sanctioned",
      note: "SCCS acted",
    });
    await expect(
      create(warning(s.id, { reportIds: [report] })),
    ).resolves.toHaveProperty("publicId");
  });

  it("refers only from none, and records an outcome only when referred", async () => {
    await signInManager();
    const s = await subject();
    const { publicId } = await create(note(s.id));
    await expect(
      actions.recordSccsOutcomeAction({
        recordId: publicId,
        outcome: "returned",
        note: "n",
      }),
    ).rejects.toThrow("Not referred to SCCS");
    await actions.referConductRecordAction({
      recordId: publicId,
      referredOn: Temporal.PlainDate.from("2026-10-21"),
    });
    const row = await recordRow(publicId);
    expect(row.scocState).toBe("referred");
    expect(row.referredOn?.toString()).toBe("2026-10-21");
    await expect(
      actions.referConductRecordAction({
        recordId: publicId,
        referredOn: Temporal.PlainDate.from("2026-10-21"),
      }),
    ).rejects.toThrow("Already referred");
  });
});

// ── lift ──────────────────────────────────────────────────────────────

describe("liftConductRecordAction", () => {
  it("sets lifted_at, restarts the clock, and refuses a second lift", async () => {
    const manager = await signInManager();
    const s = await subject();
    const { publicId } = await create(
      termination(s.id, { warningSkipped: true }),
    );
    await actions.liftConductRecordAction({
      recordId: publicId,
      reason: "Appeal upheld",
      appealOutcome: "Reinstated",
    });
    const row = await recordRow(publicId);
    expect(row.liftedAt).not.toBeNull();
    expect(row.liftedBy).toBe(manager.id);
    expect(row.liftReason).toBe("Appeal upheld");
    expect(row.retainUntil?.epochMilliseconds).toBe(
      row
        .liftedAt!.toZonedDateTimeISO("America/New_York")
        .add({ years: 5 })
        .toInstant().epochMilliseconds,
    );
    await expect(
      actions.liftConductRecordAction({ recordId: publicId, reason: "again" }),
    ).rejects.toThrow("already lifted");
  });
});

// ── email block ───────────────────────────────────────────────────────

describe("the termination email block", () => {
  async function blockedRows() {
    return getDb().select().from(schema.conductBlockedEmails);
  }

  it("fingerprints every address on the account and drops them on lift", async () => {
    await signInManager();
    const s = await subject();
    // A second, unverified address: the spec blocks every email on the
    // account, not only the verified ones.
    await getDb()
      .insert(schema.userEmails)
      .values({
        id: `uem_${crypto.randomUUID()}`,
        userId: s.id,
        email: "second@example.com",
        isPrimary: false,
        verifiedAt: null,
      });
    const { publicId } = await create(
      termination(s.id, { warningSkipped: true }),
    );
    const row = await recordRow(publicId);
    const blocked = await blockedRows();
    expect(blocked).toHaveLength(2);
    expect(blocked.every((b) => b.recordId === row.id)).toBe(true);
    // Keyed hashes only: no readable address is stored.
    expect(blocked.every((b) => /^[0-9a-f]{64}$/.test(b.emailHmac))).toBe(true);
    expect(await isBlockedEmail(s.email)).toBe(true);
    expect(await isBlockedEmail("Second@Example.com")).toBe(true);

    await actions.liftConductRecordAction({ recordId: publicId, reason: "r" });
    expect(await blockedRows()).toHaveLength(0);
    expect(await isBlockedEmail(s.email)).toBe(false);
    expect(await isBlockedEmail("second@example.com")).toBe(false);
  });

  it("blocks nothing for a lower level", async () => {
    await signInManager();
    const s = await subject();
    await create(warning(s.id));
    await create(note(s.id));
    expect(await blockedRows()).toHaveLength(0);
    expect(await isBlockedEmail(s.email)).toBe(false);
  });
});

describe("a termination deactivates the account", () => {
  async function userRow(userId: string) {
    const [row] = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    return row;
  }

  async function sessionCount(userId: string) {
    return (
      await getDb()
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.userId, userId))
    ).length;
  }

  async function deactivationAudits(userId: string) {
    return getDb()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, "member.deactivated"),
          eq(schema.auditLog.targetUserId, userId),
        ),
      );
  }

  /** Give the subject a live session, then sign the manager back in. */
  async function subjectWithSession() {
    const s = await subject();
    await openSession(s.id);
    return s;
  }

  it("deactivates, signs out and audits with the conduct manager as actor", async () => {
    const s = await subjectWithSession();
    const manager = await signInManager();
    expect(await sessionCount(s.id)).toBe(1);

    await create(termination(s.id, { warningSkipped: true }));

    const row = await userRow(s.id);
    expect(row.status).toBe("deactivated");
    expect(row.deactivatedAt).not.toBeNull();
    expect(await sessionCount(s.id)).toBe(0);
    const audits = await deactivationAudits(s.id);
    expect(audits).toHaveLength(1);
    expect(audits[0].actorUserId).toBe(manager.id);
  });

  it("sends the notice before the sessions are deleted", async () => {
    const s = await subjectWithSession();
    await signInManager();
    const atSend: number[] = [];
    sendBehaviour.onSend = async () => {
      atSend.push(await sessionCount(s.id));
    };

    await create(termination(s.id, { warningSkipped: true }));

    expect(atSend).toEqual([1]);
    expect(await sessionCount(s.id)).toBe(0);
  });

  it("still deactivates when the notice fails to send", async () => {
    const s = await subjectWithSession();
    await signInManager();
    sendBehaviour.fail = true;

    const { publicId } = await create(
      termination(s.id, { warningSkipped: true }),
    );

    expect((await recordRow(publicId)).noticeSentAt).toBeNull();
    expect((await userRow(s.id)).status).toBe("deactivated");
    expect(await sessionCount(s.id)).toBe(0);
  });

  it("does nothing to the account for a lower level", async () => {
    const s = await subjectWithSession();
    await signInManager();
    await create(warning(s.id));
    expect((await userRow(s.id)).status).toBe("approved");
    expect(await sessionCount(s.id)).toBe(1);
  });

  it("terminates a subject who is not approved without failing", async () => {
    const s = await createUser({ status: "pending" });
    await signInManager();
    const { publicId } = await create(
      termination(s.id, { warningSkipped: true }),
    );
    expect(await recordRow(publicId)).toBeDefined();
    expect((await userRow(s.id)).status).toBe("pending");
    expect(await deactivationAudits(s.id)).toHaveLength(0);
  });

  it("keeps the record and says so when deactivation fails", async () => {
    const s = await subjectWithSession();
    await signInManager();
    vi.mocked(deactivateUserStatements).mockRejectedValueOnce(
      new Error("d1 down"),
    );

    await expect(
      create(termination(s.id, { warningSkipped: true })),
    ).rejects.toThrow(
      "Record saved, but deactivating the account failed; check the member's status on /members.",
    );

    const records = await getDb().select().from(schema.conductRecords);
    expect(records).toHaveLength(1);
    expect(records[0].noticeSentAt).not.toBeNull();
    expect((await userRow(s.id)).status).toBe("approved");
    expect(await isBlockedEmail(s.email)).toBe(true);
  });

  it("refuses a second termination while one is active, even after a failed deactivation", async () => {
    const s = await subjectWithSession();
    await signInManager();
    vi.mocked(deactivateUserStatements).mockRejectedValueOnce(
      new Error("d1 down"),
    );
    await expect(
      create(termination(s.id, { warningSkipped: true })),
    ).rejects.toThrow("Record saved, but deactivating");
    const blockedBefore = await getDb()
      .select()
      .from(schema.conductBlockedEmails);

    await expect(
      create(termination(s.id, { warningSkipped: true })),
    ).rejects.toThrow("Member already has an active termination");

    expect(await getDb().select().from(schema.conductRecords)).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(
      await getDb().select().from(schema.conductBlockedEmails),
    ).toHaveLength(blockedBefore.length);
    // A lower level is still allowed, and a lift reopens termination.
    await create(warning(s.id));
    const [record] = await getDb()
      .select()
      .from(schema.conductRecords)
      .where(eq(schema.conductRecords.level, "termination"));
    await actions.liftConductRecordAction({
      recordId: record.publicId,
      reason: "r",
    });
    await create(termination(s.id, { warningSkipped: true }));
  });
});

// ── races ─────────────────────────────────────────────────────────────

describe("a transition that lost a race", () => {
  async function stale(publicId: string, viewerUserId: string) {
    const record = await repo.findRecordForMutation(publicId, viewerUserId);
    expect(record).not.toBeNull();
    return record;
  }

  it("a second lift writes nothing and throws", async () => {
    const manager = await signInManager();
    const s = await subject();
    const { publicId } = await create(
      termination(s.id, { warningSkipped: true }),
    );
    const before = await stale(publicId, manager.id);
    await actions.liftConductRecordAction({ recordId: publicId, reason: "r" });
    const lifted = await recordRow(publicId);

    // A row the first lift did not see; the losing lift must not delete it.
    await getDb()
      .insert(schema.conductBlockedEmails)
      .values({ recordId: lifted.id, emailHmac: "hmac" });
    vi.mocked(repo.findRecordForMutation).mockResolvedValueOnce(before);
    await expect(
      actions.liftConductRecordAction({ recordId: publicId, reason: "again" }),
    ).rejects.toThrow("already lifted");

    const lifts = (await auditRows(publicId)).filter(
      (r) => r.action === "conduct.lifted",
    );
    expect(lifts).toHaveLength(1);
    expect((await recordRow(publicId)).liftReason).toBe("r");
    const blocked = await getDb()
      .select()
      .from(schema.conductBlockedEmails)
      .where(eq(schema.conductBlockedEmails.recordId, lifted.id));
    expect(blocked).toHaveLength(1);
  });

  it("a second referral writes nothing and throws", async () => {
    const manager = await signInManager();
    const s = await subject();
    const { publicId } = await create(note(s.id));
    const before = await stale(publicId, manager.id);
    await actions.referConductRecordAction({
      recordId: publicId,
      referredOn: Temporal.PlainDate.from("2026-10-21"),
    });
    vi.mocked(repo.findRecordForMutation).mockResolvedValueOnce(before);
    await expect(
      actions.referConductRecordAction({
        recordId: publicId,
        referredOn: Temporal.PlainDate.from("2026-10-25"),
      }),
    ).rejects.toThrow("Already referred");
    const referrals = (await auditRows(publicId)).filter(
      (r) => r.action === "conduct.referred",
    );
    expect(referrals).toHaveLength(1);
    expect((await recordRow(publicId)).referredOn?.toString()).toBe(
      "2026-10-21",
    );
  });
});

// ── audit ─────────────────────────────────────────────────────────────

describe("audit rows", () => {
  it("writes one row per mutation, carrying no statement or notes", async () => {
    await signInManager();
    const s = await subject();
    const { publicId } = await create(warning(s.id));
    expect(await auditRows(publicId)).toHaveLength(1);

    await actions.updateConductRecordAction({
      recordId: publicId,
      internalNotes: `${NOTES} more`,
    });
    expect(await auditRows(publicId)).toHaveLength(2);

    await actions.referConductRecordAction({
      recordId: publicId,
      referredOn: Temporal.PlainDate.from("2026-10-21"),
    });
    expect(await auditRows(publicId)).toHaveLength(3);

    await actions.recordSccsOutcomeAction({
      recordId: publicId,
      outcome: "returned",
      note: "SECRET-OUTCOME",
    });
    expect(await auditRows(publicId)).toHaveLength(4);

    await actions.liftConductRecordAction({
      recordId: publicId,
      reason: "SECRET-REASON",
    });
    const rows = await auditRows(publicId);
    expect(rows.map((r) => r.action).sort()).toEqual(
      [
        "conduct.lifted",
        "conduct.record_created",
        "conduct.record_updated",
        "conduct.referred",
        "conduct.sccs_outcome",
      ].sort(),
    );
    for (const row of rows) {
      const metadata = row.metadataJson ?? "";
      expect(metadata).not.toContain("SECRET");
      expect(metadata).not.toContain("Sam Subject");
    }

    const detail = await actions.getConductRecordAction(publicId);
    expect(detail?.history).toHaveLength(5);
  });
});

// ── reads ─────────────────────────────────────────────────────────────

describe("searchConductSubjectsAction", () => {
  it("finds approved members by name, never the caller, and needs conduct:manage", async () => {
    const me = await signInManager();
    await subject("Pat Climber");
    await subject("Zed Other");
    const found = await actions.searchConductSubjectsAction({ q: "climber" });
    expect(found.map((m) => m.fullName)).toEqual(["Pat Climber"]);
    expect(found.every((m) => m.userId !== me.id)).toBe(true);
    const self = await actions.searchConductSubjectsAction({ q: "President" });
    expect(self).toEqual([]);

    await signInWith(["perm_conduct_view"]);
    await expect(
      actions.searchConductSubjectsAction({ q: "climber" }),
    ).rejects.toThrow("Forbidden");
  });
});

describe("getConductSubjectAction", () => {
  it("returns the picker shape for an approved member, null otherwise, and needs conduct:manage", async () => {
    const me = await signInManager();
    const s = await subject("Pat Climber");
    await expect(
      actions.getConductSubjectAction({ publicId: s.publicId }),
    ).resolves.toEqual({
      userId: s.id,
      publicId: s.publicId,
      fullName: "Pat Climber",
    });
    await expect(
      actions.getConductSubjectAction({ publicId: "nobody" }),
    ).resolves.toBeNull();
    await expect(
      actions.getConductSubjectAction({ publicId: me.publicId }),
    ).resolves.toBeNull();

    await signInWith(["perm_conduct_view"]);
    await expect(
      actions.getConductSubjectAction({ publicId: s.publicId }),
    ).rejects.toThrow("Forbidden");
  });
});

describe("reads", () => {
  it("puts no internal id in the detail", async () => {
    await signInManager();
    const s = await subject();
    const { publicId: prior } = await create(warning(s.id));
    const { publicId } = await create(
      termination(s.id, { priorWarningId: prior }),
    );
    const detail = await actions.getConductRecordAction(publicId);
    expect(detail?.priorWarningPublicId).toBe(prior);
    expect(detail?.supersedesPublicId).toBeNull();
    expect(detail?.subjectPublicId).toBe(s.publicId);
    expect(detail?.createdByName).toBe("Test");
    for (const key of [
      "id",
      "subjectUserId",
      "createdBy",
      "referredBy",
      "liftedBy",
      "priorWarningId",
      "supersedesId",
    ]) {
      expect(detail).not.toHaveProperty(key);
    }
    const internal = await recordRow(publicId);
    expect(JSON.stringify(detail)).not.toContain(internal.id);
    expect(JSON.stringify(detail)).not.toContain(s.id);
  });

  it("keeps the name snapshot after the subject's account is deleted", async () => {
    await signInManager();
    const s = await subject("Gone Member");
    const { publicId } = await create(warning(s.id));
    await getDb().delete(schema.users).where(eq(schema.users.id, s.id));
    const detail = await actions.getConductRecordAction(publicId);
    expect(detail?.subjectName).toBe("Gone Member");
    expect(detail?.subjectPublicId).toBeNull();
    expect(detail?.reports).toEqual([]);
  });

  it("hides a record from the manager who is its subject", async () => {
    await signInManager();
    const manager = await createUser({ roles: ["role_president"] });
    const s = await subject();
    const { publicId } = await create(warning(manager.id));
    const { publicId: visible } = await create(warning(s.id));

    await signInAs(manager.id);
    await expect(actions.getConductRecordAction(publicId)).resolves.toBeNull();
    const list = await actions.listConductRecordsAction({});
    expect(list.map((r) => r.publicId)).toEqual([visible]);
    await expect(
      actions.updateConductRecordAction({
        recordId: publicId,
        internalNotes: "x",
      }),
    ).rejects.toThrow("Record not found");
    await expect(
      actions.memberConductSummaryAction(manager.id),
    ).resolves.toBeNull();
    await expect(create(note(manager.id))).rejects.toThrow("Member not found");
  });

  it("filters the list by level, active and referred", async () => {
    await signInManager();
    const s = await subject();
    const { publicId: n } = await create(note(s.id, { possibleScoc: true }));
    const { publicId: w } = await create(warning(s.id));
    await actions.liftConductRecordAction({ recordId: w, reason: "done" });

    const ids = async (
      filter: Parameters<typeof actions.listConductRecordsAction>[0],
    ) =>
      (await actions.listConductRecordsAction(filter)).map((r) => r.publicId);

    expect(await ids({})).toEqual(expect.arrayContaining([n, w]));
    expect(await ids({ level: "warning" })).toEqual([w]);
    expect(await ids({ active: true })).toEqual([n]);
    expect(await ids({ active: false })).toEqual([w]);
    expect(await ids({ lifted: true })).toEqual([w]);
    expect(await ids({ lifted: false })).toEqual([n]);
    expect(await ids({ referred: true })).toEqual([n]);
  });

  it("counts as active only what is in force today, in club time", async () => {
    await signInManager();
    const s = await subject();
    const today = Temporal.Now.plainDateISO("America/New_York");
    const day = (offset: number) => today.add({ days: offset }).toString();
    const { publicId: ended } = await create(
      warning(s.id, { startsOn: day(-10), endsOn: day(-1) }),
    );
    const { publicId: endsToday } = await create(
      warning(s.id, { startsOn: day(-10), endsOn: day(0) }),
    );
    const { publicId: upcoming } = await create(
      warning(s.id, { startsOn: day(2), endsOn: day(9) }),
    );
    const { publicId: open } = await create(warning(s.id));

    const ids = async (active: boolean) =>
      (await actions.listConductRecordsAction({ active }))
        .map((r) => r.publicId)
        .sort();
    expect(await ids(true)).toEqual([endsToday, open, upcoming].sort());
    expect(await ids(false)).toEqual([ended]);
    // Lapsed but never lifted: the "Lifted" filter does not claim it.
    expect(
      (await actions.listConductRecordsAction({ lifted: true })).map(
        (r) => r.publicId,
      ),
    ).toEqual([]);
  });

  it("summarises a member's records and standing", async () => {
    await signInManager();
    const s = await subject();
    await create(note(s.id));
    await create(
      termination(s.id, {
        warningSkipped: true,
      }),
    );
    const summary = await actions.memberConductSummaryAction(s.id);
    expect(summary?.counts).toEqual({
      note: 1,
      warning: 0,
      suspension: 0,
      termination: 1,
    });
    expect(summary?.standing.terminated).toBe(true);
    expect(summary?.records).toHaveLength(2);
    expect(Object.keys(summary?.standing ?? {}).sort()).toEqual([
      "suspendedUntil",
      "terminated",
    ]);
    const internalIds = (
      await getDb()
        .select({ id: schema.conductRecords.id })
        .from(schema.conductRecords)
    ).map((r) => r.id);
    expect(internalIds.length).toBeGreaterThan(0);
    for (const id of internalIds) {
      expect(JSON.stringify(summary)).not.toContain(id);
    }
  });
});

describe("conduct.notice", () => {
  it("emails the subject's primary address once, matching the preview", async () => {
    await signInManager();
    const s = await subject();
    await getDb().insert(schema.userNotificationPreferences).values({
      userId: s.id,
      category: "conduct.notice",
      channel: "email",
      enabled: false,
      source: "user",
    });
    const input = warning(s.id, { startsOn: "2026-11-01" });
    const preview = await actions.previewConductNoticeAction({
      level: "warning",
      memberStatement: STATEMENT,
      startsOn: Temporal.PlainDate.from("2026-11-01"),
    });
    const { publicId } = await create(input);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(s.email);
    expect(sent[0].kind).toBe("conduct.notice");
    expect(sent[0].subject).toBe(preview.subject);
    expect(sent[0].text).toBe(preview.text);
    expect(preview.text).toContain(STATEMENT);
    expect(preview.text).toContain("2026-11-01");
    expect(preview.text).toContain("appeal");
    expect((await recordRow(publicId)).noticeSentAt).not.toBeNull();
    for (const row of await auditRows(publicId)) {
      expect(row.metadataJson ?? "").not.toContain("SECRET-STATEMENT");
      expect(row.metadataJson ?? "").not.toContain(s.email);
    }
  });

  it("previews without writing or sending, and needs conduct:manage", async () => {
    await signInManager();
    await actions.previewConductNoticeAction({
      level: "suspension",
      memberStatement: STATEMENT,
    });
    expect(sent).toHaveLength(0);
    expect(await getDb().select().from(schema.conductRecords)).toHaveLength(0);
    await signInWith(["perm_conduct_view"]);
    await expect(
      actions.previewConductNoticeAction({
        level: "warning",
        memberStatement: STATEMENT,
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("sends nothing for a note", async () => {
    await signInManager();
    const s = await subject();
    const { publicId } = await create(note(s.id));
    expect(sent).toHaveLength(0);
    expect((await recordRow(publicId)).noticeSentAt).toBeNull();
  });

  it("keeps the record and leaves the notice unsent when the send fails", async () => {
    await signInManager();
    const s = await subject();
    sendBehaviour.fail = true;
    const { publicId } = await create(warning(s.id));
    const row = await recordRow(publicId);
    expect(row).toBeDefined();
    expect(row.noticeSentAt).toBeNull();
  });

  it("skips the send when the subject has no verified primary address", async () => {
    await signInManager();
    const s = await subject();
    await getDb()
      .delete(schema.userEmails)
      .where(eq(schema.userEmails.userId, s.id));
    const { publicId } = await create(warning(s.id));
    expect(sent).toHaveLength(0);
    expect((await recordRow(publicId)).noticeSentAt).toBeNull();
  });

  it("sends a lifted notice without the internal reason", async () => {
    await signInManager();
    const s = await subject();
    const { publicId } = await create(warning(s.id));
    sent.length = 0;
    await actions.liftConductRecordAction({
      recordId: publicId,
      reason: "SECRET-LIFT-REASON",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(s.email);
    expect(sent[0].text).toContain("lifted");
    expect(JSON.stringify(sent[0])).not.toContain("SECRET-LIFT-REASON");
  });

  it("sends no lifted notice for a note", async () => {
    await signInManager();
    const s = await subject();
    const { publicId } = await create(note(s.id));
    await actions.liftConductRecordAction({ recordId: publicId, reason: "ok" });
    expect(sent).toHaveLength(0);
  });

  it("locks the statement: an update touches internal notes only", async () => {
    await signInManager();
    const s = await subject();
    const { publicId } = await create(warning(s.id));
    const before = await recordRow(publicId);
    await actions.updateConductRecordAction({
      ...({ memberStatement: "changed", level: "note" } as object),
      recordId: publicId,
      internalNotes: "new notes",
    });
    const after = await recordRow(publicId);
    expect(after.internalNotes).toBe("new notes");
    expect(after.memberStatement).toBe(before.memberStatement);
    expect(after.level).toBe("warning");
    expect(after.noticeSentAt).not.toBeNull();
  });

  it("refuses to empty a note's text, but not a warning's internal notes", async () => {
    await signInManager();
    const s = await subject();
    const { publicId: n } = await create(note(s.id));
    await expect(
      actions.updateConductRecordAction({ recordId: n, internalNotes: "" }),
    ).rejects.toThrow("A note needs its text");
    expect((await recordRow(n)).internalNotes).toBe(NOTES);
    expect(await auditRows(n)).toHaveLength(1);

    const { publicId: w } = await create(warning(s.id));
    await actions.updateConductRecordAction({ recordId: w, internalNotes: "" });
    expect((await recordRow(w)).internalNotes).toBeNull();
  });

  it("links a correction to the old record and leaves its statement alone", async () => {
    await signInManager();
    const s = await subject();
    const { publicId: old } = await create(warning(s.id));
    const { publicId } = await create(
      warning(s.id, { supersedesPublicId: old, memberStatement: "Corrected." }),
    );
    const detail = await actions.getConductRecordAction(publicId);
    expect(detail?.supersedesPublicId).toBe(old);
    expect((await recordRow(old)).memberStatement).toBe(STATEMENT);
  });

  it("refuses to supersede another member's record, or one about the caller", async () => {
    const manager = await signInManager();
    const a = await subject("Ann A");
    const b = await subject("Bob B");
    const { publicId: aRecord } = await create(warning(a.id));
    await expect(
      create(warning(b.id, { supersedesPublicId: aRecord })),
    ).rejects.toThrow("Record not found");
    await expect(
      create(warning(a.id, { supersedesPublicId: "nope" })),
    ).rejects.toThrow("Record not found");
    expect(manager.id).toBeDefined();
  });
});

describe("correcting a sent notice", () => {
  function notices() {
    return sent.filter((m) => m.kind === "conduct.notice");
  }

  function suspension(
    subjectUserId: string,
    startsOn: string,
    endsOn: string,
    extra: Record<string, unknown> = {},
  ) {
    return {
      level: "suspension",
      subjectUserId,
      internalNotes: NOTES,
      memberStatement: STATEMENT,
      possibleScoc: false,
      reportIds: [],
      startsOn,
      endsOn,
      ...extra,
    } as CreateRecordInput;
  }

  it("lifts the old record in the same write and sends only the correction", async () => {
    const manager = await signInManager();
    const s = await subject();
    const { publicId: old } = await create(warning(s.id));
    sent.length = 0;

    const { publicId } = await create(
      warning(s.id, { supersedesPublicId: old, memberStatement: "Corrected." }),
    );

    const oldRow = await recordRow(old);
    expect(oldRow.liftedAt).not.toBeNull();
    expect(oldRow.liftedBy).toBe(manager.id);
    expect(oldRow.liftReason).toBe(`Superseded by ${publicId}`);
    // Lifted, so the five-year clock runs from the lift.
    expect(oldRow.retainUntil).not.toBeNull();
    expect(oldRow.memberStatement).toBe(STATEMENT);

    const lifts = (await auditRows(old)).filter(
      (r) => r.action === "conduct.lifted",
    );
    expect(lifts).toHaveLength(1);
    expect(JSON.parse(lifts[0].metadataJson ?? "{}")).toEqual({
      supersededBy: publicId,
    });

    // One email: the correction. No "has been lifted" notice.
    expect(notices()).toHaveLength(1);
    const [message] = notices();
    expect(message.to).toBe(s.email);
    expect(message.subject).toBe(
      "Corrected notice from the UCMC Executive Committee: warning",
    );
    expect(String(message.text)).toMatch(
      /^This notice corrects an earlier one\./,
    );
    expect(String(message.text)).toContain("Corrected.");
    expect((await recordRow(publicId)).noticeSentAt).not.toBeNull();

    const oldDetail = await actions.getConductRecordAction(old);
    expect(oldDetail?.supersededByPublicId).toBe(publicId);
    const newDetail = await actions.getConductRecordAction(publicId);
    expect(newDetail?.supersedesPublicId).toBe(old);
    expect(newDetail?.supersededByPublicId).toBeNull();
  });

  it("previews the correction exactly as it is sent", async () => {
    await signInManager();
    const s = await subject();
    const { publicId: old } = await create(warning(s.id));
    sent.length = 0;
    const preview = await actions.previewConductNoticeAction({
      level: "warning",
      memberStatement: "Corrected.",
      supersedesPublicId: old,
    });
    await create(
      warning(s.id, { supersedesPublicId: old, memberStatement: "Corrected." }),
    );
    const [message] = notices();
    expect({ subject: message.subject, text: message.text }).toEqual(preview);
  });

  it("leaves only the new record in standing and on /my", async () => {
    await signInManager();
    const s = await subject();
    const today = Temporal.Now.plainDateISO("America/New_York");
    const { publicId: old } = await create(
      suspension(
        s.id,
        today.subtract({ days: 1 }).toString(),
        today.add({ days: 30 }).toString(),
      ),
    );
    await create(
      suspension(
        s.id,
        today.subtract({ days: 1 }).toString(),
        today.add({ days: 10 }).toString(),
        { supersedesPublicId: old, memberStatement: "Corrected." },
      ),
    );

    const standing = await standingFor(s.id);
    expect(standing.suspendedUntil?.toString()).toBe(
      today.add({ days: 10 }).toString(),
    );
    expect(standing.activeRecordIds).toHaveLength(1);

    await signInAs(s.id);
    const mine = await getMyActiveSanctionsAction();
    expect(mine.map((m) => m.statement)).toEqual(["Corrected."]);
  });

  it("replaces an active termination with exactly one, keeping the block", async () => {
    const manager = await signInManager();
    const s = await subject();
    const { publicId: old } = await create(
      termination(s.id, { warningSkipped: true }),
    );
    const oldRow = await recordRow(old);
    // An address the member removed after the termination: only the old
    // record's fingerprint still covers it.
    await getDb()
      .insert(schema.conductBlockedEmails)
      .values({ recordId: oldRow.id, emailHmac: "removed-address-hmac" });
    sent.length = 0;

    const { publicId } = await create(
      termination(s.id, {
        warningSkipped: true,
        supersedesPublicId: old,
        memberStatement: "Corrected termination.",
      }),
    );
    const newRow = await recordRow(publicId);

    const active = await getDb()
      .select()
      .from(schema.conductRecords)
      .where(
        and(
          eq(schema.conductRecords.subjectUserId, s.id),
          eq(schema.conductRecords.level, "termination"),
        ),
      );
    expect(active.filter((r) => r.liftedAt === null).map((r) => r.id)).toEqual([
      newRow.id,
    ]);
    expect(newRow.retainUntil).toBeNull();

    const blocked = await getDb().select().from(schema.conductBlockedEmails);
    expect(blocked.every((b) => b.recordId === newRow.id)).toBe(true);
    expect(blocked.map((b) => b.emailHmac)).toContain("removed-address-hmac");
    expect(await isBlockedEmail(s.email)).toBe(true);
    expect((await standingFor(s.id)).terminated).toBe(true);

    // Still deactivated; the second deactivation transitions nothing.
    const [user] = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, s.id));
    expect(user.status).toBe("deactivated");
    const deactivations = await getDb()
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "member.deactivated"));
    expect(deactivations).toHaveLength(1);
    expect(notices().map((m) => m.subject)).toEqual([
      "Corrected notice from the UCMC Executive Committee: termination",
    ]);
    expect(manager.id).toBeDefined();
  });

  it("a correction that lost a race writes nothing", async () => {
    const manager = await signInManager();
    const s = await subject();
    const { publicId: old } = await create(warning(s.id));
    const before = await repo.findRecordForMutation(old, manager.id);
    expect(before).not.toBeNull();
    // A lift lands between the correction's read and its write.
    await actions.liftConductRecordAction({ recordId: old, reason: "r" });
    const auditCount = (await getDb().select().from(schema.auditLog)).length;
    sent.length = 0;

    vi.mocked(repo.findRecordForMutation).mockResolvedValueOnce(before);
    await expect(
      create(warning(s.id, { supersedesPublicId: old })),
    ).rejects.toThrow("The record being corrected changed");

    const rows = await getDb().select().from(schema.conductRecords);
    expect(rows).toHaveLength(1);
    expect((await recordRow(old)).liftReason).toBe("r");
    expect(await getDb().select().from(schema.auditLog)).toHaveLength(
      auditCount,
    );
    expect(sent).toHaveLength(0);
  });

  it("a second correction of the same record writes nothing", async () => {
    const manager = await signInManager();
    const s = await subject();
    const { publicId: old } = await create(warning(s.id));
    const before = await repo.findRecordForMutation(old, manager.id);
    await create(warning(s.id, { supersedesPublicId: old }));
    const count = (await getDb().select().from(schema.conductRecords)).length;

    vi.mocked(repo.findRecordForMutation).mockResolvedValueOnce(before);
    await expect(
      create(warning(s.id, { supersedesPublicId: old })),
    ).rejects.toThrow("The record being corrected changed");
    expect(await getDb().select().from(schema.conductRecords)).toHaveLength(
      count,
    );
    // Without the stale read it is refused up front.
    await expect(
      create(warning(s.id, { supersedesPublicId: old })),
    ).rejects.toThrow("Record already corrected");
  });

  it("refuses to correct a note, or to correct into one", async () => {
    await signInManager();
    const s = await subject();
    const { publicId: n } = await create(note(s.id));
    await expect(
      create(warning(s.id, { supersedesPublicId: n })),
    ).rejects.toThrow("A note has no notice to correct");
    const { publicId: w } = await create(warning(s.id));
    await expect(create(note(s.id, { supersedesPublicId: w }))).rejects.toThrow(
      "A correction must be a warning",
    );
  });

  it("drafts the prefill, including for a deactivated member, and needs conduct:manage", async () => {
    await signInManager();
    const s = await subject();
    const { publicId: old } = await create(
      termination(s.id, { warningSkipped: true }),
    );
    const draft = await actions.getCorrectionDraftAction({ publicId: old });
    expect(draft).toMatchObject({
      subject: { userId: s.id, publicId: s.publicId, fullName: "Sam Subject" },
      level: "termination",
      memberStatement: STATEMENT,
      endsOn: null,
      warningSkipped: true,
      priorWarningPublicId: null,
      vote: { for: 5, against: 1, abstain: 0, committeeSize: 7 },
    });
    expect(draft?.vote?.heldOn.toString()).toBe("2026-10-20");

    const { publicId: n } = await create(note(s.id));
    await expect(
      actions.getCorrectionDraftAction({ publicId: n }),
    ).resolves.toBeNull();

    await signInWith(["perm_conduct_view"]);
    await expect(
      actions.getCorrectionDraftAction({ publicId: old }),
    ).rejects.toThrow("Forbidden");
  });
});

describe("getMyActiveSanctionsAction", () => {
  const today = Temporal.Now.plainDateISO("America/New_York");
  const day = (offset: number) => today.add({ days: offset }).toString();

  it("needs a session but no conduct permission", async () => {
    cookieJar.clear();
    await expect(getMyActiveSanctionsAction()).rejects.toThrow("Not signed in");
    const member = await createUser({});
    await signInAs(member.id);
    await expect(getMyActiveSanctionsAction()).resolves.toEqual([]);
  });

  it("returns only the caller's own active sanctions, as statement and dates", async () => {
    await signInManager();
    const me = await subject("Me Myself");
    const other = await subject("Other One");
    await create(note(me.id));
    await create(warning(me.id, { endsOn: day(5) }));
    await create(
      warning(me.id, {
        memberStatement: "Open-ended warning.",
      }),
    );
    await create(
      warning(me.id, {
        memberStatement: "Expired warning.",
        startsOn: day(-30),
        endsOn: day(-1),
      }),
    );
    await create(
      warning(me.id, {
        level: "suspension",
        memberStatement: "Upcoming suspension.",
        startsOn: day(10),
        endsOn: day(20),
      } as never),
    );
    const { publicId: lifted } = await create(
      warning(me.id, { memberStatement: "Lifted warning." }),
    );
    await getDb()
      .update(schema.conductRecords)
      .set({ liftedAt: Temporal.Now.instant() })
      .where(eq(schema.conductRecords.publicId, lifted));
    await create(warning(other.id, { memberStatement: "Someone else's." }));

    await signInAs(me.id);
    const mine = await getMyActiveSanctionsAction();
    expect(mine.map((m) => m.statement).sort()).toEqual(
      [STATEMENT, "Open-ended warning.", "Upcoming suspension."].sort(),
    );
    const upcoming = mine.find((m) => m.level === "suspension");
    expect(upcoming?.startsOn?.toString()).toBe(day(10));
    expect(upcoming?.endsOn?.toString()).toBe(day(20));
    for (const row of mine) {
      expect(Object.keys(row).sort()).toEqual([
        "endsOn",
        "level",
        "startsOn",
        "statement",
      ]);
    }
    expect(JSON.stringify(mine)).not.toContain(NOTES);
  });

  it("still shows a record whose notice was never sent", async () => {
    await signInManager();
    const me = await subject("No Email");
    sendBehaviour.fail = true;
    const { publicId } = await create(warning(me.id));
    expect((await recordRow(publicId)).noticeSentAt).toBeNull();
    await signInAs(me.id);
    const mine = await getMyActiveSanctionsAction();
    expect(mine.map((m) => m.statement)).toEqual([STATEMENT]);
  });
});

describe("getMyTerminationNoticeAction", () => {
  async function terminated() {
    const s = await subject();
    await signInManager();
    const { publicId } = await create(
      termination(s.id, { warningSkipped: true }),
    );
    cookieJar.clear();
    return { s, publicId };
  }

  async function proveEmail(email: string, issuedAt = Date.now()) {
    cookieJar.clear();
    await writeProofCookie({ email, intent: "login", issuedAt });
  }

  it("answers null to a visitor with no session and no proof", async () => {
    await terminated();
    expect(await getMyTerminationNoticeAction()).toBeNull();
  });

  it("answers the terminated member's own surviving session", async () => {
    const s = await subject();
    await signInManager();
    await create(termination(s.id, { warningSkipped: true }));
    // A session row that outlived the deactivation, as on the request
    // that redirected the member here.
    await signInAs(s.id);
    expect(await getMyTerminationNoticeAction()).toEqual({
      statement: STATEMENT,
      appealText: APPEAL_LINE,
    });
  });

  it("answers null to a signed-in member who is not terminated", async () => {
    await terminated();
    const other = await subject("Other Member");
    await signInAs(other.id);
    expect(await getMyTerminationNoticeAction()).toBeNull();
  });

  it("answers a valid proof cookie for a blocked address, normalized", async () => {
    const { s } = await terminated();
    await proveEmail(` ${s.email.toUpperCase()} `);
    expect(await getMyTerminationNoticeAction()).toEqual({
      statement: STATEMENT,
      appealText: APPEAL_LINE,
    });
  });

  it("still answers the proof after the account is purged", async () => {
    const { s } = await terminated();
    await getDb()
      .delete(schema.userEmails)
      .where(eq(schema.userEmails.userId, s.id));
    await getDb()
      .delete(schema.profiles)
      .where(eq(schema.profiles.userId, s.id));
    await getDb().delete(schema.users).where(eq(schema.users.id, s.id));
    await proveEmail(s.email);
    expect((await getMyTerminationNoticeAction())?.statement).toBe(STATEMENT);
  });

  it("answers null to a proof for an unblocked address", async () => {
    await terminated();
    await proveEmail("someone-else@example.com");
    expect(await getMyTerminationNoticeAction()).toBeNull();
  });

  it("answers null to an expired or forged proof", async () => {
    const { s } = await terminated();
    await proveEmail(s.email, Date.now() - 1000 * 60 * 60);
    expect(await getMyTerminationNoticeAction()).toBeNull();

    await proveEmail(s.email);
    const [name, value] = [...cookieJar.entries()][0];
    const [, signature] = value.split(".");
    // A fresh payload under another payload's signature.
    const forged = base64UrlEncode(
      JSON.stringify({
        email: s.email,
        intent: "login",
        issuedAt: Date.now() + 1,
      }),
    );
    cookieJar.set(name, `${forged}.${signature}`);
    expect(await getMyTerminationNoticeAction()).toBeNull();
  });

  it("answers null to a proof whose fingerprint rows outlived a lifted termination", async () => {
    const { s, publicId } = await terminated();
    // Lifted without the lift's delete: the lifted_at test is the backstop.
    await getDb()
      .update(schema.conductRecords)
      .set({ liftedAt: Temporal.Now.instant() })
      .where(eq(schema.conductRecords.publicId, publicId));
    expect(
      await getDb().select().from(schema.conductBlockedEmails),
    ).not.toHaveLength(0);
    await proveEmail(s.email);
    expect(await getMyTerminationNoticeAction()).toBeNull();
  });

  it("answers null once the termination is lifted", async () => {
    const { s, publicId } = await terminated();
    await signInManager();
    await actions.liftConductRecordAction({ recordId: publicId, reason: "r" });
    await proveEmail(s.email);
    expect(await getMyTerminationNoticeAction()).toBeNull();
    await signInAs(s.id);
    expect(await getMyTerminationNoticeAction()).toBeNull();
  });
});
