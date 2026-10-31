import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
import { createRole, createUser } from "#/test-support/factories/users";
import type { CreateRecordInput } from "#/features/conduct/server/limits";
import type * as RepoModuleNs from "#/features/conduct/server/record-repo.server";

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

const repo = await import("#/features/conduct/server/record-repo.server");
const actions = await import("#/features/conduct/server/record-actions.server");
const { requireConductReporter } =
  await import("#/features/conduct/server/conduct-guards.server");
const { createRecordSchema } = await import("#/features/conduct/server/limits");
const { openSession } = await import("#/server/auth/session.server");

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
  const db = getDb();
  await db.delete(schema.auditLog);
  await db
    .delete(schema.conductRecords)
    .where(eq(schema.conductRecords.level, "termination"));
  await db.delete(schema.conductRecords);
  await db.delete(schema.conductReports);
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
    expect(await ids({ referred: true })).toEqual([n]);
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
