import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb, schema } from "#/server/db";
import { recordEmailSend } from "#/server/email/email-send-log.server";

const AT = Temporal.Instant.from("2026-10-09T12:00:00Z");

afterEach(async () => {
  await getDb().delete(schema.emailSends);
  vi.restoreAllMocks();
});

describe("recordEmailSend", () => {
  it("writes one row carrying the kind and outcome", async () => {
    await recordEmailSend({ kind: "auth.magic_link", ok: true, now: AT });

    const rows = await getDb().select().from(schema.emailSends);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("auth.magic_link");
    expect(rows[0].ok).toBe(true);
    expect(rows[0].sentAt.epochMilliseconds).toBe(AT.epochMilliseconds);
  });

  it("records a failed send, not just a successful one", async () => {
    // A rejected send is still volume. Counting only successes would
    // make our figures disagree with the provider's own count in
    // exactly the months something was wrong — the months a report is
    // most likely to be read.
    await recordEmailSend({ kind: "gear.loan_overdue", ok: false, now: AT });

    const rows = await getDb().select().from(schema.emailSends);
    expect(rows[0].ok).toBe(false);
  });

  it("stores no recipient — the row shape itself is the guarantee", async () => {
    // The table is operational telemetry, not correspondence. If a
    // recipient column ever appears this fails, which is the point:
    // adding one turns this into per-member behavioural data and pulls
    // in the privacy notice, the data export and the delete cascade.
    await recordEmailSend({ kind: "auth.magic_link", ok: true, now: AT });

    const rows = await getDb().select().from(schema.emailSends);
    expect(Object.keys(rows[0]).sort()).toEqual(["id", "kind", "ok", "sentAt"]);
  });

  it("swallows a write failure rather than failing the send", async () => {
    // The caller is `sendEmail`, which is on the magic-link path. A
    // member must never be locked out of signing in because a telemetry
    // insert lost a race with D1.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = getDb();
    vi.spyOn(db, "insert").mockImplementation(() => {
      throw new Error("D1 unavailable");
    });

    await expect(
      recordEmailSend({ kind: "auth.magic_link", ok: true, now: AT }),
    ).resolves.toBeUndefined();
  });

  it("gives each send its own row rather than a counter", async () => {
    for (const kind of ["auth.magic_link", "auth.magic_link"] as const) {
      await recordEmailSend({ kind, ok: true, now: AT });
    }

    const rows = await getDb().select().from(schema.emailSends);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });
});
