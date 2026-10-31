import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { loadPrincipal } from "#/server/auth/principal.server";
import { getDb, schema } from "#/server/db";
import { hasCurrentAttestation } from "#/server/waivers/current-attestation.server";
import {
  createGearItem,
  createGearLoan,
  createGearModel,
} from "#/test-support/factories/gear";
import { createRole, createUser } from "#/test-support/factories/users";
import { createWaiverAttestation } from "#/test-support/factories/waivers";

/**
 * The factories' defaults are a claim about production state: a test
 * that writes `createUser()` is relying on getting a user the action
 * layer accepts. These pin that claim against the real readers, so a
 * default that drifts from what `loadPrincipal` or the waiver gate
 * requires fails here rather than as a confusing assertion elsewhere.
 */

beforeEach(async () => {
  const db = getDb();
  await db.delete(schema.waiverAttestations);
  await db.delete(schema.gearLoans);
  await db.delete(schema.gearItems);
  await db.delete(schema.gearModels);
  await db.delete(schema.gearTypes);
  await db.delete(schema.userRoles);
  await db.delete(schema.users);
});

describe("createUser", () => {
  it("builds a user loadPrincipal accepts, with its roles' permissions", async () => {
    const role = await createRole({
      permissions: ["perm_events_read_private"],
    });
    const user = await createUser({
      email: "Mixed@Example.com",
      roles: [role.id],
    });

    const principal = await loadPrincipal(user.id);

    expect(principal).toMatchObject({
      userId: user.id,
      primaryEmail: "mixed@example.com",
      status: "approved",
      hasProfile: true,
      roles: [role.name],
    });
    expect(principal?.permissions).toEqual(["events:read_private"]);
  });

  it("stamps approvedAt on an approved user only, and returns the stored email", async () => {
    // Approval sets `approved_at`; the waiver queue and membership
    // analytics order and bucket by it.
    const approved = await createUser({ email: "Mixed@Example.com" });
    const pending = await createUser({ status: "pending" });

    expect(approved.approvedAt).not.toBeNull();
    expect(approved.email).toBe("mixed@example.com");
    expect(pending.approvedAt).toBeNull();
  });

  it("leaves the profile out when asked to", async () => {
    const user = await createUser({ profile: false, status: "pending" });

    const principal = await loadPrincipal(user.id);

    expect(principal?.hasProfile).toBe(false);
    expect(principal?.status).toBe("pending");
  });

  it("gives every user a distinct email and public id", async () => {
    // `user_emails.email` and `users.public_id` are unique, so a fixed
    // default would fail the second call in any test seeding two users.
    const a = await createUser();
    const b = await createUser();

    expect(a.email).not.toBe(b.email);
    expect(a.publicId).not.toBe(b.publicId);
  });
});

describe("createGearItem", () => {
  it("creates its model and type when not given one", async () => {
    const item = await createGearItem();

    const [model] = await getDb()
      .select()
      .from(schema.gearModels)
      .where(eq(schema.gearModels.id, item.modelId));
    expect(model.tracking).toBe("coded");
    expect(item).toMatchObject({
      status: "active",
      condition: "serviceable",
      whereabouts: "cave",
    });
  });

  it("shares a model between items when given one", async () => {
    const first = await createGearItem();
    const second = await createGearItem({ modelId: first.modelId });

    expect(second.modelId).toBe(first.modelId);
    expect(second.code).not.toBe(first.code);
  });
});

describe("createGearLoan", () => {
  it("loans a fresh item by default, and a model when given one", async () => {
    // `gear_loans` requires exactly one of item and model.
    const member = await createUser();
    const coded = await createGearLoan({ memberUserId: member.id });
    const model = await createGearModel({ tracking: "counted" });
    const counted = await createGearLoan({
      memberUserId: member.id,
      modelId: model.id,
    });

    expect(coded).toMatchObject({ modelId: null, returnedAt: null });
    expect(coded.itemId).not.toBeNull();
    expect(counted).toMatchObject({ itemId: null, modelId: model.id });
  });
});

describe("createWaiverAttestation", () => {
  it("defaults to an attestation the waiver gate counts as current", async () => {
    const user = await createUser();
    await createWaiverAttestation({ userId: user.id });

    expect(await hasCurrentAttestation(user.id)).toBe(true);
  });
});
