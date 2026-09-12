/**
 * /volunteer actions.
 *
 * The read (`getVolunteerContentAction`) is anonymous-safe and gated at
 * the route layer by `public_volunteer:view`; every write gates on
 * `public_volunteer:manage` here at the action layer and records one
 * audit event.
 *
 * The narrative markdown is deliberately NOT part of this bundle. It is
 * read through `markdownPageQueryOptions("volunteer")` like every other
 * markdown-backed public page, because `useUpdateMarkdownPage`
 * invalidates `["markdown-page", slug]` and nothing else — a copy inside
 * this bundle would still be showing pre-save text after an officer
 * saves, and `EditMarkdownSheet` would then seed its next edit from that
 * stale copy and silently overwrite the save.
 *
 * The read resolves "now" exactly once and hands the same day boundary
 * to both event queries, so the upcoming and past lists are guaranteed
 * to partition the table — computing the bound twice could drop an
 * event that starts at midnight (or show it twice) if the two calls
 * straddled the boundary.
 */
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { startOfClubDay } from "#/features/volunteer/lib/day-boundary";
import { requireVolunteerManager } from "#/features/volunteer/server/volunteer-permissions.server";
import type {
  CreateEventInput,
  CreateOpportunityInput,
  DeleteByIdInput,
  ReorderOpportunitiesInput,
  UpdateEventInput,
  UpdateOpportunityInput,
} from "#/features/volunteer/server/volunteer-schemas";
import {
  listOpportunities,
  listPastEvents,
  listUpcomingEvents,
  nextOpportunitySortOrder,
} from "#/features/volunteer/server/volunteer-repo.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { getDb, schema } from "#/server/db";

export interface VolunteerOpportunityEntry {
  id: string;
  icon: string;
  title: string;
  blurb: string;
}

export interface VolunteerEventEntry {
  id: string;
  publicId: string;
  title: string;
  partnerOrg: string | null;
  location: string | null;
  /** Epoch ms — numeric DTO fields stay numbers across the wire. */
  startsAtMs: number;
  endsAtMs: number | null;
  description: string | null;
  signupUrl: string | null;
  volunteersCount: number | null;
  serviceHours: number | null;
  albumTag: string | null;
}

export interface VolunteerContent {
  opportunities: VolunteerOpportunityEntry[];
  upcoming: VolunteerEventEntry[];
  past: VolunteerEventEntry[];
}

type EventRow = Awaited<ReturnType<typeof listUpcomingEvents>>[number];

function toEntry(row: EventRow): VolunteerEventEntry {
  return {
    id: row.id,
    publicId: row.publicId,
    title: row.title,
    partnerOrg: row.partnerOrg,
    location: row.location,
    startsAtMs: row.startsAt.epochMilliseconds,
    endsAtMs: row.endsAt?.epochMilliseconds ?? null,
    description: row.description,
    signupUrl: row.signupUrl,
    volunteersCount: row.volunteersCount,
    serviceHours: row.serviceHours,
    albumTag: row.albumTag,
  };
}

export async function getVolunteerContentAction(
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<VolunteerContent> {
  const dayStart = startOfClubDay(now);
  const [opportunities, upcoming, past] = await Promise.all([
    listOpportunities(),
    listUpcomingEvents(dayStart),
    listPastEvents(dayStart),
  ]);
  return {
    opportunities: opportunities.map((o) => ({
      id: o.id,
      icon: o.icon,
      title: o.title,
      blurb: o.blurb,
    })),
    upcoming: upcoming.map(toEntry),
    past: past.map(toEntry),
  };
}

// ── opportunities (public_volunteer:manage) ─────────────────────────────
//
// The narrative markdown is not edited here: it goes through the generic
// markdown_pages action keyed on slug="volunteer", whose slug →
// permission map routes back to public_volunteer:manage, so the per-page
// gate is preserved without a second write path.

export async function createOpportunityAction(
  input: CreateOpportunityInput,
): Promise<{ id: string }> {
  const principal = await requireVolunteerManager();
  const id = `vopp_${uuidv7()}`;
  const sortOrder = await nextOpportunitySortOrder();
  await getDb().insert(schema.volunteerOpportunities).values({
    id,
    icon: input.icon,
    title: input.title,
    blurb: input.blurb,
    sortOrder,
  });
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "volunteer_opportunity.created",
    targetType: "volunteer_opportunity",
    targetId: id,
    metadata: { title: input.title },
  });
  return { id };
}

export async function updateOpportunityAction(
  input: UpdateOpportunityInput,
): Promise<{ ok: true }> {
  const principal = await requireVolunteerManager();
  const updated = await getDb()
    .update(schema.volunteerOpportunities)
    .set({
      icon: input.icon,
      title: input.title,
      blurb: input.blurb,
      updatedAt: Temporal.Now.instant(),
    })
    .where(eq(schema.volunteerOpportunities.id, input.id))
    .returning({ id: schema.volunteerOpportunities.id });
  if (updated.length === 0) {
    throw new Error("Program not found");
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "volunteer_opportunity.updated",
    targetType: "volunteer_opportunity",
    targetId: input.id,
    metadata: { title: input.title },
  });
  return { ok: true };
}

export async function deleteOpportunityAction(
  input: DeleteByIdInput,
): Promise<{ ok: true }> {
  const principal = await requireVolunteerManager();
  // `.returning()` proves a row actually went away, so the audit event
  // can carry the title it had and a delete of an already-gone id
  // doesn't write a misleading row.
  const deleted = await getDb()
    .delete(schema.volunteerOpportunities)
    .where(eq(schema.volunteerOpportunities.id, input.id))
    .returning({ title: schema.volunteerOpportunities.title });
  if (deleted.length === 0) {
    throw new Error("Program not found");
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "volunteer_opportunity.deleted",
    targetType: "volunteer_opportunity",
    targetId: input.id,
    metadata: { title: deleted[0]?.title },
  });
  return { ok: true };
}

export async function reorderOpportunitiesAction(
  input: ReorderOpportunitiesInput,
): Promise<{ ok: true; count: number }> {
  const principal = await requireVolunteerManager();
  const { ids } = input;
  if (ids.length === 0) {
    return { ok: true, count: 0 };
  }
  // Rewrite every row's sort_order to (index + 1) so the canonical order
  // stays dense (1..N) across mixed add / reorder / delete sequences.
  const db = getDb();
  const now = Temporal.Now.instant();
  const stmts = ids.map((id, idx) =>
    db
      .update(schema.volunteerOpportunities)
      .set({ sortOrder: idx + 1, updatedAt: now })
      .where(eq(schema.volunteerOpportunities.id, id)),
  );
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "volunteer_opportunity.reordered",
    targetType: "volunteer_opportunity_list",
    targetId: "1",
    metadata: { count: ids.length },
  });
  return { ok: true, count: ids.length };
}

// ── events (public_volunteer:manage) ────────────────────────────────────

function eventValues(input: CreateEventInput | UpdateEventInput) {
  return {
    title: input.title,
    partnerOrg: input.partnerOrg,
    location: input.location,
    startsAt: Temporal.Instant.fromEpochMilliseconds(input.startsAtMs),
    endsAt:
      input.endsAtMs === null
        ? null
        : Temporal.Instant.fromEpochMilliseconds(input.endsAtMs),
    description: input.description,
    signupUrl: input.signupUrl,
    volunteersCount: input.volunteersCount,
    serviceHours: input.serviceHours,
    albumTag: input.albumTag,
  };
}

export async function createEventAction(
  input: CreateEventInput,
): Promise<{ id: string; publicId: string }> {
  const principal = await requireVolunteerManager();
  const id = `vevt_${uuidv7()}`;
  const publicId = generatePublicId();
  await getDb()
    .insert(schema.volunteerEvents)
    .values({
      id,
      publicId,
      ...eventValues(input),
      createdBy: principal.userId,
      updatedBy: principal.userId,
    });
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "volunteer_event.created",
    targetType: "volunteer_event",
    targetId: id,
    // `startsAt` rides along because it's what decides which band the
    // row renders in — an audit row saying only "created" can't explain
    // why an outing appeared in the archive rather than upcoming.
    metadata: { title: input.title, startsAtMs: input.startsAtMs },
  });
  return { id, publicId };
}

export async function updateEventAction(
  input: UpdateEventInput,
): Promise<{ ok: true }> {
  const principal = await requireVolunteerManager();
  const updated = await getDb()
    .update(schema.volunteerEvents)
    .set({
      ...eventValues(input),
      updatedAt: Temporal.Now.instant(),
      updatedBy: principal.userId,
    })
    .where(eq(schema.volunteerEvents.id, input.id))
    .returning({ id: schema.volunteerEvents.id });
  if (updated.length === 0) {
    throw new Error("Outing not found");
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "volunteer_event.updated",
    targetType: "volunteer_event",
    targetId: input.id,
    metadata: { title: input.title, startsAtMs: input.startsAtMs },
  });
  return { ok: true };
}

export async function deleteEventAction(
  input: DeleteByIdInput,
): Promise<{ ok: true }> {
  const principal = await requireVolunteerManager();
  const deleted = await getDb()
    .delete(schema.volunteerEvents)
    .where(eq(schema.volunteerEvents.id, input.id))
    .returning({
      title: schema.volunteerEvents.title,
      startsAt: schema.volunteerEvents.startsAt,
    });
  if (deleted.length === 0) {
    throw new Error("Outing not found");
  }
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "volunteer_event.deleted",
    targetType: "volunteer_event",
    targetId: input.id,
    metadata: {
      title: deleted[0]?.title,
      startsAtMs: deleted[0]?.startsAt.epochMilliseconds,
    },
  });
  return { ok: true };
}
