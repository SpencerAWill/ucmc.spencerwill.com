import { and, desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
import { createRole, createUser } from "#/test-support/factories/users";
import type { SubmitReportInput } from "#/features/conduct/server/limits";
import type * as ReportRepoNs from "#/features/conduct/server/report-repo.server";

type ReportRepo = typeof ReportRepoNs;

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
const sendBehaviour = vi.hoisted(() => ({ fail: false }));
vi.mock("#/server/email/resend", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    sendEmail: vi.fn(async (message: Record<string, unknown>) => {
      if (sendBehaviour.fail) {
        throw new Error("provider exploded");
      }
      sent.push(message);
    }),
  };
});

// Pass-through, so the race test can hand `accept` the report as it was
// before a competing request triaged it.
vi.mock(
  "#/features/conduct/server/report-repo.server",
  async (importOriginal) => {
    const actual = await importOriginal<ReportRepo>();
    return {
      ...actual,
      findReportForTriage: vi.fn(actual.findReportForTriage),
    };
  },
);

const repo = await import("#/features/conduct/server/report-repo.server");
const reports = await import("#/features/conduct/server/report-actions.server");
const records = await import("#/features/conduct/server/record-actions.server");
const { createRecordSchema, submitReportSchema } =
  await import("#/features/conduct/server/limits");
const { openSession } = await import("#/server/auth/session.server");

// ── helpers ────────────────────────────────────────────────────────────

const BODY = "SECRET-BODY of what happened at the crag.";
const LOCATION = "SECRET-LOCATION Red River Gorge";

async function signInAs(userId: string): Promise<void> {
  cookieJar.clear();
  await openSession(userId);
}

async function member(fullName = "Rita Reporter") {
  return createUser({ roles: ["role_member"], profile: { fullName } });
}

async function manager(fullName = "Pat President") {
  return createUser({ roles: ["role_president"], profile: { fullName } });
}

async function viewerOnly() {
  const role = await createRole({ permissions: ["perm_conduct_view"] });
  return createUser({ roles: [role.id] });
}

function submit(input: Partial<SubmitReportInput>) {
  return reports.submitConductReportAction(
    submitReportSchema.parse({
      occurredOn: "2026-10-01",
      location: LOCATION,
      body: BODY,
      possibleScoc: false,
      ...input,
    }),
  );
}

async function onlyReport() {
  const rows = await getDb().select().from(schema.conductReports);
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function reportAudits(publicId: string, action: string) {
  return getDb()
    .select()
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.targetType, "conduct_report"),
        eq(schema.auditLog.targetId, publicId),
        eq(schema.auditLog.action, action as never),
      ),
    );
}

function addYears(instant: Temporal.Instant, years: number) {
  return instant.toZonedDateTimeISO("America/New_York").add({ years });
}

function expectAbout(
  actual: Temporal.Instant | null,
  expected: Temporal.ZonedDateTime,
) {
  expect(actual).not.toBeNull();
  const diff = Math.abs(
    actual!.epochMilliseconds - expected.toInstant().epochMilliseconds,
  );
  expect(diff).toBeLessThan(60_000);
}

// ── setup ──────────────────────────────────────────────────────────────

beforeEach(async () => {
  cookieJar.clear();
  sent.length = 0;
  sendBehaviour.fail = false;
  const db = getDb();
  await db.delete(schema.auditLog);
  await db.delete(schema.siteSettings);
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

// ── submit ─────────────────────────────────────────────────────────────

describe("searchReportSubjectsAction", () => {
  it("needs conduct:report", async () => {
    await signInAs((await viewerOnly()).id);
    await expect(
      reports.searchReportSubjectsAction({ q: "Sam" }),
    ).rejects.toThrow("Forbidden: missing conduct:report");
  });

  it("returns public ids and names only, leaves the caller out and caps at 10", async () => {
    const r = await member("Sam Reporter");
    await member("Sam Subject");
    for (let i = 0; i < 11; i += 1) {
      await member(`Sam Extra${i}`);
    }
    await signInAs(r.id);
    const found = await reports.searchReportSubjectsAction({ q: "Sam" });
    expect(found).toHaveLength(10);
    expect(found.map((f) => f.fullName)).not.toContain("Sam Reporter");
    for (const option of found) {
      expect(Object.keys(option).sort()).toEqual(["fullName", "publicId"]);
    }
    await expect(
      reports.searchReportSubjectsAction({ q: "  " }),
    ).resolves.toEqual([]);
  });
});

describe("manager notice", () => {
  it("emails each opted-in manager once, with no report text", async () => {
    const m1 = await manager("Pat President");
    const m2 = await manager("Vic Vice");
    const optedOut = await manager("Olly Optout");
    await getDb().insert(schema.userNotificationPreferences).values({
      userId: optedOut.id,
      category: "conduct.report_received",
      channel: "email",
      enabled: false,
      source: "user",
    });
    const s = await member("Sam Subject");
    const r = await member();
    await signInAs(r.id);
    await submit({ subjectPublicId: s.publicId });

    expect(sent.map((m) => m.to).sort()).toEqual([m1.email, m2.email].sort());
    for (const message of sent) {
      expect(message.kind).toBe("conduct.report_received");
      expect(message.subject).toBe("A new conduct report is waiting");
      expect(message.text).toContain("/conduct/reports");
      const everything = JSON.stringify(message);
      for (const secret of [BODY, LOCATION, "Sam Subject", "Rita Reporter"]) {
        expect(everything).not.toContain(secret);
      }
    }
  });

  it("leaves out a manager who is the subject or the reporter", async () => {
    const subject = await manager("Pat President");
    const other = await createUser({
      roles: ["role_member", "role_president"],
      profile: { fullName: "Vic Vice" },
    });
    await signInAs(other.id);
    await submit({ subjectPublicId: subject.publicId });
    expect(sent).toHaveLength(0);

    const r = await member();
    await signInAs(r.id);
    await submit({ subjectDescription: "tall, red jacket" });
    expect(sent.map((m) => m.to).sort()).toEqual(
      [subject.email, other.email].sort(),
    );
  });

  it("also reaches a system_admin who has the preference on", async () => {
    const admin = await createUser({
      roles: ["role_system_admin"],
      profile: { fullName: "Ada Admin" },
    });
    await signInAs((await member()).id);
    await submit({ subjectDescription: "tall" });
    expect(sent.map((m) => m.to)).toEqual([admin.email]);
  });

  it("does not fail the submission when a send fails", async () => {
    await manager();
    sendBehaviour.fail = true;
    await signInAs((await member()).id);
    await expect(submit({ subjectDescription: "tall" })).resolves.toEqual({
      ok: true,
    });
    await onlyReport();
  });
});

describe("submitConductReportAction", () => {
  it("needs conduct:report", async () => {
    const s = await member("Sam Subject");
    await signInAs((await viewerOnly()).id);
    await expect(submit({ subjectPublicId: s.publicId })).rejects.toThrow(
      "Forbidden: missing conduct:report",
    );
  });

  it("files a report with only ok, a 5-year retention and a clean audit row", async () => {
    const s = await member("Sam Subject");
    const r = await member();
    await signInAs(r.id);
    await expect(
      submit({ subjectPublicId: s.publicId, possibleScoc: true }),
    ).resolves.toEqual({ ok: true });

    const row = await onlyReport();
    expect(row.reporterUserId).toBe(r.id);
    expect(row.subjectUserId).toBe(s.id);
    expect(row.status).toBe("new");
    expectAbout(row.retainUntil, addYears(row.createdAt, 5));

    const [audit] = await reportAudits(row.publicId, "conduct.report_filed");
    expect(audit.actorUserId).toBe(r.id);
    expect(audit.targetUserId).toBeNull();
    expect(JSON.parse(audit.metadataJson ?? "{}")).toEqual({
      reportId: row.publicId,
      possibleScoc: true,
    });
    for (const secret of [BODY, LOCATION, "Sam Subject", "Rita Reporter"]) {
      expect(audit.metadataJson).not.toContain(secret);
    }
  });

  it("files a report about someone the reporter cannot name", async () => {
    await signInAs((await member()).id);
    await submit({ subjectDescription: "Tall climber in a red helmet" });
    const row = await onlyReport();
    expect(row.subjectUserId).toBeNull();
    expect(row.subjectDescription).toBe("Tall climber in a red helmet");
  });

  it("needs a subject or a description", () => {
    expect(() =>
      submitReportSchema.parse({
        occurredOn: "2026-10-01",
        location: "",
        body: BODY,
        possibleScoc: false,
      }),
    ).toThrow();
  });

  it("refuses a report naming its own reporter", async () => {
    const r = await member();
    await signInAs(r.id);
    await expect(submit({ subjectPublicId: r.publicId })).rejects.toThrow(
      "You cannot report yourself",
    );
  });

  it("refuses a subject that does not exist", async () => {
    await signInAs((await member()).id);
    await expect(submit({ subjectPublicId: "nobody" })).rejects.toThrow(
      "Member not found",
    );
  });

  it("is disabled by the setting, while list keeps working", async () => {
    const s = await member("Sam Subject");
    await signInAs((await member()).id);
    await submit({ subjectPublicId: s.publicId });
    await getDb().insert(schema.siteSettings).values({
      key: "conduct_reports.submissions_enabled",
      valueJson: "false",
      updatedBy: null,
    });
    await expect(submit({ subjectPublicId: s.publicId })).rejects.toThrow(
      "disabled",
    );

    await signInAs((await viewerOnly()).id);
    await expect(reports.listConductReportsAction()).resolves.toHaveLength(1);
  });

  it("refuses the 6th report in 24 hours", async () => {
    const s = await member("Sam Subject");
    await signInAs((await member()).id);
    for (const n of [1, 2, 3, 4, 5]) {
      await submit({ subjectPublicId: s.publicId, body: `${BODY} ${n}` });
    }
    await expect(submit({ subjectPublicId: s.publicId })).rejects.toThrow(
      "Rate limit",
    );
    const rows = await getDb().select().from(schema.conductReports);
    expect(rows).toHaveLength(5);
  });
});

// ── list ───────────────────────────────────────────────────────────────

describe("listConductReportsAction", () => {
  it("is closed to a reporter, who has no way to read reports back", async () => {
    const s = await member("Sam Subject");
    await signInAs((await member()).id);
    await submit({ subjectPublicId: s.publicId });
    await expect(reports.listConductReportsAction()).rejects.toThrow(
      "Forbidden: missing conduct:view",
    );
    expect(Object.keys(reports).sort()).toEqual([
      "acceptConductReportAction",
      "dismissConductReportAction",
      "listConductReportsAction",
      "searchReportSubjectsAction",
      "submitConductReportAction",
    ]);
  });

  it("projects names and public ids only, and filters by status", async () => {
    const s = await member("Sam Subject");
    const r = await member();
    await signInAs(r.id);
    await submit({ subjectPublicId: s.publicId });
    await submit({ subjectDescription: "Unknown belayer" });

    await signInAs((await viewerOnly()).id);
    const list = await reports.listConductReportsAction();
    expect(list).toHaveLength(2);
    const named = list.find((x) => x.subjectName !== null);
    expect(named).toMatchObject({
      reporterName: "Rita Reporter",
      subjectName: "Sam Subject",
      subjectDescription: null,
      location: LOCATION,
      body: BODY,
      possibleScoc: false,
      status: "new",
      triagedAt: null,
      dismissReason: null,
    });
    expect(named?.occurredOn.toString()).toBe("2026-10-01");
    const raw = await getDb().select().from(schema.conductReports);
    const json = JSON.stringify(list);
    for (const row of raw) {
      expect(json).not.toContain(row.id);
    }
    expect(json).not.toContain(r.id);
    expect(json).not.toContain(s.id);

    await expect(
      reports.listConductReportsAction("dismissed"),
    ).resolves.toEqual([]);
    await expect(reports.listConductReportsAction("new")).resolves.toHaveLength(
      2,
    );
  });

  it("shows a null reporter name once the reporter is purged", async () => {
    const r = await member();
    await signInAs(r.id);
    await submit({ subjectDescription: "Unknown belayer" });
    await getDb().delete(schema.users).where(eq(schema.users.id, r.id));
    await signInAs((await viewerOnly()).id);
    const [row] = await reports.listConductReportsAction();
    expect(row.reporterName).toBeNull();
  });

  it("hides a report from the manager who is its subject", async () => {
    const pres = await manager();
    const s = await member("Sam Subject");
    await signInAs((await member()).id);
    await submit({ subjectPublicId: pres.publicId });
    await submit({ subjectPublicId: s.publicId });

    await signInAs(pres.id);
    const list = await reports.listConductReportsAction();
    expect(list.map((x) => x.subjectName)).toEqual(["Sam Subject"]);

    const hidden = await getDb()
      .select()
      .from(schema.conductReports)
      .where(eq(schema.conductReports.subjectUserId, pres.id));
    await expect(
      reports.acceptConductReportAction({ reportId: hidden[0].publicId }),
    ).rejects.toThrow("Report not found");
    await expect(
      reports.dismissConductReportAction({
        reportId: hidden[0].publicId,
        reason: "no",
      }),
    ).rejects.toThrow("Report not found");
  });

  it("hides a nameless report from the manager a record citing it is about", async () => {
    const m = await manager("Mo Manager");
    const other = await manager("Vic Vice");
    const nameless = await fileAbout(null);
    const unrelated = await fileAbout(null);
    // Another manager files the record about M, citing the nameless report.
    await signInAs(other.id);
    const { publicId } = await createRecord({
      level: "note",
      subjectUserId: m.id,
      reportIds: [nameless.publicId],
    });

    await signInAs(m.id);
    const list = await reports.listConductReportsAction();
    expect(list.map((x) => x.id)).toEqual([unrelated.publicId]);
    await expect(
      reports.acceptConductReportAction({ reportId: nameless.publicId }),
    ).rejects.toThrow("Report not found");
    await expect(
      repo.findReportForTriage(nameless.publicId, m.id),
    ).resolves.toBeNull();
    await expect(repo.listReportsForRecord(publicId, m.id)).resolves.toEqual(
      [],
    );

    // The other manager still sees both.
    await signInAs(other.id);
    expect(
      (await reports.listConductReportsAction()).map((x) => x.id).sort(),
    ).toEqual([nameless.publicId, unrelated.publicId].sort());
  });
});

// ── triage ─────────────────────────────────────────────────────────────

describe("triage", () => {
  async function fileOne(subjectPublicId?: string, possibleScoc = false) {
    await signInAs((await member()).id);
    await submit(
      subjectPublicId
        ? { subjectPublicId, possibleScoc }
        : { subjectDescription: "Unknown belayer" },
    );
    return onlyReport();
  }

  it("needs conduct:manage", async () => {
    const report = await fileOne();
    await signInAs((await viewerOnly()).id);
    await expect(
      reports.acceptConductReportAction({ reportId: report.publicId }),
    ).rejects.toThrow("Forbidden: missing conduct:manage");
    await expect(
      reports.dismissConductReportAction({
        reportId: report.publicId,
        reason: "x",
      }),
    ).rejects.toThrow("Forbidden: missing conduct:manage");
  });

  it("dismiss keeps the report for one year", async () => {
    const report = await fileOne();
    const pres = await manager();
    await signInAs(pres.id);
    await expect(
      reports.dismissConductReportAction({
        reportId: report.publicId,
        reason: "Not a conduct matter",
      }),
    ).resolves.toEqual({ ok: true });

    const row = await onlyReport();
    expect(row.status).toBe("dismissed");
    expect(row.dismissReason).toBe("Not a conduct matter");
    expect(row.triagedBy).toBe(pres.id);
    expect(row.triagedAt).not.toBeNull();
    expectAbout(row.retainUntil, addYears(row.triagedAt!, 1));
    const [audit] = await reportAudits(
      report.publicId,
      "conduct.report_triaged",
    );
    expect(JSON.parse(audit.metadataJson ?? "{}")).toEqual({
      from: "new",
      to: "dismissed",
      recordId: null,
    });
    expect(audit.metadataJson).not.toContain("Not a conduct matter");
  });

  it("accept keeps the report for five years and links an existing record", async () => {
    const s = await member("Sam Subject");
    const report = await fileOne(s.publicId);
    await signInAs((await manager()).id);
    const { publicId } = await records.createConductRecordAction(
      createRecordSchema.parse({
        level: "note",
        subjectUserId: s.id,
        internalNotes: "notes",
        possibleScoc: false,
        reportIds: [],
      }),
    );

    await expect(
      reports.acceptConductReportAction({
        reportId: report.publicId,
        recordPublicId: publicId,
      }),
    ).resolves.toEqual({ ok: true });

    const row = await onlyReport();
    expect(row.status).toBe("accepted");
    expectAbout(row.retainUntil, addYears(row.triagedAt!, 5));
    const links = await getDb().select().from(schema.conductRecordReports);
    expect(links).toHaveLength(1);
    expect(links[0].reportId).toBe(report.id);

    const detail = await records.getConductRecordAction(publicId);
    expect(detail?.reports.map((x) => x.id)).toEqual([report.publicId]);
    expect(detail?.reports[0].status).toBe("accepted");
    const [audit] = await reportAudits(
      report.publicId,
      "conduct.report_triaged",
    );
    expect(JSON.parse(audit.metadataJson ?? "{}")).toEqual({
      from: "new",
      to: "accepted",
      recordId: publicId,
    });
  });

  it("accept without a record only marks the report accepted", async () => {
    const report = await fileOne();
    await signInAs((await manager()).id);
    await reports.acceptConductReportAction({ reportId: report.publicId });
    const row = await onlyReport();
    expect(row.status).toBe("accepted");
    expect(await getDb().select().from(schema.conductRecordReports)).toEqual(
      [],
    );
  });

  it("accept refuses a record about a different member", async () => {
    const s = await member("Sam Subject");
    const other = await member("Olive Other");
    const report = await fileOne(s.publicId);
    await signInAs((await manager()).id);
    const { publicId } = await records.createConductRecordAction(
      createRecordSchema.parse({
        level: "note",
        subjectUserId: other.id,
        internalNotes: "notes",
        possibleScoc: false,
        reportIds: [],
      }),
    );
    await expect(
      reports.acceptConductReportAction({
        reportId: report.publicId,
        recordPublicId: publicId,
      }),
    ).rejects.toThrow("Report is about a different member");
    expect((await onlyReport()).status).toBe("new");
  });

  it("accept refuses an unknown record", async () => {
    const report = await fileOne();
    await signInAs((await manager()).id);
    await expect(
      reports.acceptConductReportAction({
        reportId: report.publicId,
        recordPublicId: "nope",
      }),
    ).rejects.toThrow("Record not found");
  });

  it("a second accept is already triaged and leaves one audit row", async () => {
    const report = await fileOne();
    await signInAs((await manager()).id);
    await reports.acceptConductReportAction({ reportId: report.publicId });
    await expect(
      reports.acceptConductReportAction({ reportId: report.publicId }),
    ).rejects.toThrow("already triaged");
    await expect(
      reports.dismissConductReportAction({
        reportId: report.publicId,
        reason: "x",
      }),
    ).rejects.toThrow("already triaged");
    expect(
      await reportAudits(report.publicId, "conduct.report_triaged"),
    ).toHaveLength(1);
  });

  it("an accept that loses the race writes nothing", async () => {
    const s = await member("Sam Subject");
    const report = await fileOne(s.publicId);
    await signInAs((await manager()).id);
    const { publicId } = await records.createConductRecordAction(
      createRecordSchema.parse({
        level: "note",
        subjectUserId: s.id,
        internalNotes: "notes",
        possibleScoc: false,
        reportIds: [],
      }),
    );
    const stale = await repo.findReportForTriage(report.publicId, "nobody");
    await reports.dismissConductReportAction({
      reportId: report.publicId,
      reason: "x",
    });

    vi.mocked(repo.findReportForTriage).mockResolvedValueOnce(stale);
    await expect(
      reports.acceptConductReportAction({
        reportId: report.publicId,
        recordPublicId: publicId,
      }),
    ).rejects.toThrow("already triaged");

    expect((await onlyReport()).status).toBe("dismissed");
    expect(
      await reportAudits(report.publicId, "conduct.report_triaged"),
    ).toHaveLength(1);
    expect(await getDb().select().from(schema.conductRecordReports)).toEqual(
      [],
    );
  });
});

// ── fix round 1 ────────────────────────────────────────────────────────

async function fileAbout(
  subjectPublicId: string | null,
  possibleScoc = false,
): Promise<{ id: string; publicId: string }> {
  await signInAs((await member()).id);
  await submit(
    subjectPublicId === null
      ? { subjectDescription: "Unknown belayer", possibleScoc }
      : { subjectPublicId, possibleScoc },
  );
  const [row] = await getDb()
    .select()
    .from(schema.conductReports)
    .orderBy(desc(schema.conductReports.createdAt))
    .limit(1);
  return row;
}

function createRecord(input: Record<string, unknown>) {
  return records.createConductRecordAction(
    createRecordSchema.parse({
      internalNotes: "notes",
      possibleScoc: false,
      reportIds: [],
      ...input,
    }),
  );
}

async function reportRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.conductReports)
    .where(eq(schema.conductReports.id, id));
  return row;
}

describe("submit names the subject by public id", () => {
  it("refuses a member who is not approved", async () => {
    const pending = await createUser({ status: "pending" });
    await signInAs((await member()).id);
    await expect(submit({ subjectPublicId: pending.publicId })).rejects.toThrow(
      "Member not found",
    );
  });

  it("refuses an internal user id", async () => {
    const s = await member("Sam Subject");
    await signInAs((await member()).id);
    await expect(submit({ subjectPublicId: s.id })).rejects.toThrow(
      "Member not found",
    );
  });
});

describe("accept onto an existing record", () => {
  it("refuses a flagged report onto an unreferred note or a warning", async () => {
    const s = await member("Sam Subject");
    const report = await fileAbout(s.publicId, true);
    await signInAs((await manager()).id);
    const { publicId: noteId } = await createRecord({
      level: "note",
      subjectUserId: s.id,
    });
    const { publicId: warningId } = await createRecord({
      level: "warning",
      subjectUserId: s.id,
      memberStatement: "You are warned.",
    });
    for (const recordPublicId of [noteId, warningId]) {
      await expect(
        reports.acceptConductReportAction({
          reportId: report.publicId,
          recordPublicId,
        }),
      ).rejects.toThrow("Referred to SCCS");
    }
    expect((await reportRow(report.id)).status).toBe("new");
  });

  it("allows a flagged report onto a referred record", async () => {
    const s = await member("Sam Subject");
    const report = await fileAbout(s.publicId, true);
    await signInAs((await manager()).id);
    const { publicId } = await createRecord({
      level: "note",
      subjectUserId: s.id,
      possibleScoc: true,
    });
    await reports.acceptConductReportAction({
      reportId: report.publicId,
      recordPublicId: publicId,
    });
    expect((await reportRow(report.id)).status).toBe("accepted");
  });

  it("refuses a record whose member was purged", async () => {
    const s = await member("Sam Subject");
    const gone = await member("Gone Member");
    const report = await fileAbout(s.publicId);
    await signInAs((await manager()).id);
    const { publicId } = await createRecord({
      level: "note",
      subjectUserId: gone.id,
    });
    await getDb().delete(schema.users).where(eq(schema.users.id, gone.id));
    await expect(
      reports.acceptConductReportAction({
        reportId: report.publicId,
        recordPublicId: publicId,
      }),
    ).rejects.toThrow("Record's member no longer exists");
  });
});

describe("a record created citing a report", () => {
  it("accepts a new report, with one triage audit row", async () => {
    const s = await member("Sam Subject");
    const report = await fileAbout(s.publicId);
    const pres = await manager();
    await signInAs(pres.id);
    const { publicId } = await createRecord({
      level: "note",
      subjectUserId: s.id,
      reportIds: [report.publicId],
    });

    const row = await reportRow(report.id);
    expect(row.status).toBe("accepted");
    expect(row.triagedBy).toBe(pres.id);
    expect(row.triagedAt).not.toBeNull();
    expectAbout(row.retainUntil, addYears(row.triagedAt!, 5));
    const audits = await reportAudits(
      report.publicId,
      "conduct.report_triaged",
    );
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0].metadataJson ?? "{}")).toEqual({
      from: "new",
      to: "accepted",
      recordId: publicId,
    });
  });

  it("leaves an already accepted report as it was", async () => {
    const s = await member("Sam Subject");
    const report = await fileAbout(s.publicId);
    await signInAs((await manager()).id);
    await reports.acceptConductReportAction({ reportId: report.publicId });
    const before = await reportRow(report.id);

    await signInAs((await manager("Vic Vice")).id);
    await createRecord({
      level: "note",
      subjectUserId: s.id,
      reportIds: [report.publicId],
    });
    const after = await reportRow(report.id);
    expect(after.triagedBy).toBe(before.triagedBy);
    expect(after.triagedAt).toEqual(before.triagedAt);
    expect(
      await reportAudits(report.publicId, "conduct.report_triaged"),
    ).toHaveLength(1);
  });

  it("refuses a dismissed report", async () => {
    const s = await member("Sam Subject");
    const report = await fileAbout(s.publicId);
    await signInAs((await manager()).id);
    await reports.dismissConductReportAction({
      reportId: report.publicId,
      reason: "No",
    });
    await expect(
      createRecord({
        level: "note",
        subjectUserId: s.id,
        reportIds: [report.publicId],
      }),
    ).rejects.toThrow("Report was dismissed");
  });

  it("makes the report impossible to dismiss", async () => {
    const s = await member("Sam Subject");
    const report = await fileAbout(s.publicId);
    await signInAs((await manager()).id);
    await createRecord({
      level: "note",
      subjectUserId: s.id,
      reportIds: [report.publicId],
    });
    await expect(
      reports.dismissConductReportAction({
        reportId: report.publicId,
        reason: "No",
      }),
    ).rejects.toThrow("Report is attached to a record");
  });

  it("dismiss refuses a linked report even while it is still new", async () => {
    const s = await member("Sam Subject");
    const report = await fileAbout(s.publicId);
    await signInAs((await manager()).id);
    const { publicId } = await createRecord({
      level: "note",
      subjectUserId: s.id,
    });
    const [rec] = await getDb()
      .select({ id: schema.conductRecords.id })
      .from(schema.conductRecords)
      .where(eq(schema.conductRecords.publicId, publicId));
    // A stale pre-check, then a link landing before the dismiss batch.
    const stale = await repo.findReportForTriage(report.publicId, "nobody");
    await getDb()
      .insert(schema.conductRecordReports)
      .values({ recordId: rec.id, reportId: report.id });
    vi.mocked(repo.findReportForTriage).mockResolvedValueOnce(stale);
    await expect(
      reports.dismissConductReportAction({
        reportId: report.publicId,
        reason: "No",
      }),
    ).rejects.toThrow("already triaged");
    expect((await reportRow(report.id)).status).toBe("new");
    expect(
      await reportAudits(report.publicId, "conduct.report_triaged"),
    ).toHaveLength(0);
  });
});
