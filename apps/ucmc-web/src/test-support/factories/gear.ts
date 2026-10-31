/**
 * D1 factories for the gear type → model → item chain (#323).
 *
 * Each level creates its parent when the caller doesn't name one, so a
 * test that only cares about an item writes `createGearItem()` and a
 * test comparing two items of one model passes the model's id to both.
 * Names and codes are unique by default because `gear_types.name`,
 * `gear_items.code` and the model's (type, manufacturer, name) are.
 */
import { generatePublicId } from "#/server/auth/ids";
import { getDb, schema } from "#/server/db";

type GearTypeInsert = typeof schema.gearTypes.$inferInsert;
type GearModelInsert = typeof schema.gearModels.$inferInsert;
type GearItemInsert = typeof schema.gearItems.$inferInsert;
type GearLoanInsert = typeof schema.gearLoans.$inferInsert;

export async function createGearType(overrides: Partial<GearTypeInsert> = {}) {
  const [type] = await getDb()
    .insert(schema.gearTypes)
    .values({
      id: `gt_${crypto.randomUUID()}`,
      publicId: generatePublicId(),
      name: `Type ${crypto.randomUUID()}`,
      ...overrides,
    })
    .returning();
  return type;
}

/** A coded model, under a fresh type unless `typeId` is given. */
export async function createGearModel(
  overrides: Partial<GearModelInsert> = {},
) {
  const typeId = overrides.typeId ?? (await createGearType()).id;
  const [model] = await getDb()
    .insert(schema.gearModels)
    .values({
      id: `gm_${crypto.randomUUID()}`,
      publicId: generatePublicId(),
      name: `Model ${crypto.randomUUID()}`,
      tracking: "coded",
      ...overrides,
      typeId,
    })
    .returning();
  return model;
}

/** An active, serviceable item in the cave, under a fresh model unless
 *  `modelId` is given. */
export async function createGearItem(overrides: Partial<GearItemInsert> = {}) {
  const modelId = overrides.modelId ?? (await createGearModel()).id;
  const [item] = await getDb()
    .insert(schema.gearItems)
    .values({
      id: `gi_${crypto.randomUUID()}`,
      publicId: generatePublicId(),
      code: crypto.randomUUID().slice(0, 8),
      ...overrides,
      modelId,
    })
    .returning();
  return item;
}

/**
 * An open loan to `memberUserId`, checked out now and due in 14 days.
 * Loans a fresh coded item unless `itemId` or `modelId` (a counted loan)
 * is given: `gear_loans` requires exactly one of the two.
 */
export async function createGearLoan(
  overrides: Partial<GearLoanInsert> & { memberUserId: string },
) {
  const itemId =
    overrides.itemId ??
    (overrides.modelId ? null : (await createGearItem()).id);
  const checkedOutAt = Temporal.Now.instant();
  const [loan] = await getDb()
    .insert(schema.gearLoans)
    .values({
      id: `gl_${crypto.randomUUID()}`,
      publicId: generatePublicId(),
      checkedOutAt,
      dueAt: checkedOutAt.add({ hours: 14 * 24 }),
      ...overrides,
      itemId,
    })
    .returning();
  return loan;
}
