/**
 * D1 factory for the `events` base table (#323). Writes the row
 * directly; a test of the authoring path calls `createEventAction`
 * instead, since that is the behaviour under test.
 */
import { generatePublicId } from "#/server/auth/ids";
import { getDb, schema } from "#/server/db";

type EventInsert = typeof schema.events.$inferInsert;

/** A one-off, members-visible meeting starting now, unless overridden. */
export async function createEvent(overrides: Partial<EventInsert> = {}) {
  const [event] = await getDb()
    .insert(schema.events)
    .values({
      id: `evt_${crypto.randomUUID()}`,
      publicId: generatePublicId(),
      title: "Test event",
      startsAt: Temporal.Now.instant(),
      kind: "meeting",
      ...overrides,
    })
    .returning();
  return event;
}
