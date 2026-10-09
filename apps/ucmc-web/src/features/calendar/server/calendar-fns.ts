/**
 * Route-facing shells for the club calendar's server fns (issue #187).
 *
 * Each handler body dynamic-imports its action so server-only modules
 * never reach the client bundle; type-only imports of action shapes
 * erase at compile time and are fine.
 */
import { createServerFn } from "@tanstack/react-start";

import {
  calendarWindowInputSchema,
  cancelEventInputSchema,
  clearOccurrenceOverrideInputSchema,
  createEventInputSchema,
  deleteEventInputSchema,
  overrideOccurrenceInputSchema,
  createSubscriptionInputSchema,
  subscriptionIdInputSchema,
  updateEventInputSchema,
} from "#/features/calendar/server/event-schemas";
import type { SubscriptionSummary } from "#/features/calendar/server/subscription-actions.server";
import type { CalendarOccurrence } from "#/server/events/occurrences";

export type { CalendarOccurrence } from "#/server/events/occurrences";

// ── reads (projected per viewer; see event-actions.server.ts) ───────────

export const listCalendarOccurrencesFn = createServerFn({ method: "GET" })
  .validator(calendarWindowInputSchema)
  .handler(async ({ data }): Promise<CalendarOccurrence[]> => {
    const { listCalendarOccurrencesAction } =
      await import("#/features/calendar/server/event-actions.server");
    return listCalendarOccurrencesAction(data);
  });

// ── writes (events:manage) ─────────────────────────────────────────────

export const createEventFn = createServerFn({ method: "POST" })
  .validator(createEventInputSchema)
  .handler(async ({ data }): Promise<{ publicId: string }> => {
    const { createEventAction } =
      await import("#/features/calendar/server/event-actions.server");
    return createEventAction(data);
  });

export const updateEventFn = createServerFn({ method: "POST" })
  .validator(updateEventInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { updateEventAction } =
      await import("#/features/calendar/server/event-actions.server");
    await updateEventAction(data);
    return { ok: true };
  });

export const cancelEventFn = createServerFn({ method: "POST" })
  .validator(cancelEventInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { cancelEventAction } =
      await import("#/features/calendar/server/event-actions.server");
    await cancelEventAction(data);
    return { ok: true };
  });

export const deleteEventFn = createServerFn({ method: "POST" })
  .validator(deleteEventInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { deleteEventAction } =
      await import("#/features/calendar/server/event-actions.server");
    await deleteEventAction(data);
    return { ok: true };
  });

export const overrideOccurrenceFn = createServerFn({ method: "POST" })
  .validator(overrideOccurrenceInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { overrideOccurrenceAction } =
      await import("#/features/calendar/server/event-actions.server");
    await overrideOccurrenceAction(data);
    return { ok: true };
  });

export const clearOccurrenceOverrideFn = createServerFn({ method: "POST" })
  .validator(clearOccurrenceOverrideInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { clearOccurrenceOverrideAction } =
      await import("#/features/calendar/server/event-actions.server");
    await clearOccurrenceOverrideAction(data);
    return { ok: true };
  });

// ── subscriptions (self-service; see subscription-actions.server.ts) ────

export type { SubscriptionSummary } from "#/features/calendar/server/subscription-actions.server";

export const listMySubscriptionsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SubscriptionSummary[]> => {
    const { listMySubscriptionsAction } =
      await import("#/features/calendar/server/subscription-actions.server");
    return listMySubscriptionsAction();
  },
);

export const createMySubscriptionFn = createServerFn({ method: "POST" })
  .validator(createSubscriptionInputSchema)
  .handler(async ({ data }): Promise<{ id: string; token: string }> => {
    const { createMySubscriptionAction } =
      await import("#/features/calendar/server/subscription-actions.server");
    return createMySubscriptionAction(data);
  });

export const revokeMySubscriptionFn = createServerFn({ method: "POST" })
  .validator(subscriptionIdInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { revokeMySubscriptionAction } =
      await import("#/features/calendar/server/subscription-actions.server");
    await revokeMySubscriptionAction(data);
    return { ok: true };
  });

export const rotateMySubscriptionFn = createServerFn({ method: "POST" })
  .validator(subscriptionIdInputSchema)
  .handler(async ({ data }): Promise<{ id: string; token: string }> => {
    const { rotateMySubscriptionAction } =
      await import("#/features/calendar/server/subscription-actions.server");
    return rotateMySubscriptionAction(data);
  });
