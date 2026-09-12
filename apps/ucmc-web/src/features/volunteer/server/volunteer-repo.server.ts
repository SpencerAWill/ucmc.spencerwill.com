/**
 * Pure data access for /volunteer. No auth — the route guard enforces
 * `public_volunteer:view` and the actions enforce
 * `public_volunteer:manage`.
 *
 * Both event reads take the day boundary as a parameter rather than
 * computing it, so the action layer decides "now" once and the two
 * queries are guaranteed to partition the table rather than overlap or
 * leave a gap.
 */
import { asc, desc, eq, gte, lt, sql } from "drizzle-orm";

import { getDb, schema } from "#/server/db";

export async function listOpportunities() {
  return getDb()
    .select({
      id: schema.volunteerOpportunities.id,
      icon: schema.volunteerOpportunities.icon,
      title: schema.volunteerOpportunities.title,
      blurb: schema.volunteerOpportunities.blurb,
      sortOrder: schema.volunteerOpportunities.sortOrder,
    })
    .from(schema.volunteerOpportunities)
    .orderBy(
      asc(schema.volunteerOpportunities.sortOrder),
      asc(schema.volunteerOpportunities.id),
    );
}

const eventColumns = {
  id: schema.volunteerEvents.id,
  publicId: schema.volunteerEvents.publicId,
  title: schema.volunteerEvents.title,
  partnerOrg: schema.volunteerEvents.partnerOrg,
  location: schema.volunteerEvents.location,
  startsAt: schema.volunteerEvents.startsAt,
  endsAt: schema.volunteerEvents.endsAt,
  description: schema.volunteerEvents.description,
  signupUrl: schema.volunteerEvents.signupUrl,
  volunteersCount: schema.volunteerEvents.volunteersCount,
  serviceHours: schema.volunteerEvents.serviceHours,
  albumTag: schema.volunteerEvents.albumTag,
} as const;

/** Soonest first — the next thing a member can join leads the band. */
export async function listUpcomingEvents(dayStart: Temporal.Instant) {
  return getDb()
    .select(eventColumns)
    .from(schema.volunteerEvents)
    .where(gte(schema.volunteerEvents.startsAt, dayStart))
    .orderBy(asc(schema.volunteerEvents.startsAt));
}

/** Most recent first — the archive reads newest-back. */
export async function listPastEvents(dayStart: Temporal.Instant) {
  return getDb()
    .select(eventColumns)
    .from(schema.volunteerEvents)
    .where(lt(schema.volunteerEvents.startsAt, dayStart))
    .orderBy(desc(schema.volunteerEvents.startsAt));
}

/**
 * Next free slot at the end of the opportunity list.
 *
 * A `MAX(sort_order) + 1` subquery rather than a count, so a list that
 * has had rows deleted doesn't mint a sort_order that collides with an
 * existing row and leave the tie broken arbitrarily.
 */
export async function nextOpportunitySortOrder(): Promise<number> {
  const rows = await getDb()
    .select({
      next: sql<number>`COALESCE(MAX(${schema.volunteerOpportunities.sortOrder}), 0) + 1`,
    })
    .from(schema.volunteerOpportunities);
  return rows.at(0)?.next ?? 1;
}

export async function getEventById(id: string) {
  const rows = await getDb()
    .select(eventColumns)
    .from(schema.volunteerEvents)
    .where(eq(schema.volunteerEvents.id, id))
    .limit(1);
  return rows.at(0) ?? null;
}
