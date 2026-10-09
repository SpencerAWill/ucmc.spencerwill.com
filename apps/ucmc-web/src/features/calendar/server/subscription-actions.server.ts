/**
 * Calendar subscription management (issue #187).
 *
 * All four operations are **self-service only** — a member manages
 * their own tokens and nobody else's, including a system admin. There
 * is no permission gate because there is no cross-user path to gate:
 * every query is keyed on the caller's own `userId`. That is also why
 * these record audit events with the actor and target as the same
 * member, the same shape the passkey lifecycle uses.
 *
 * **A token never leaves this module except on the one response that
 * mints it.** `listMySubscriptionsAction` returns labels, timestamps
 * and ids — not tokens — so the page can show "iPhone, last fetched
 * 20 minutes ago, revoke" without re-shipping a live bearer credential
 * into the SSR payload of every page load. A member who loses their URL
 * rotates rather than re-reads it, which is the right trade: a URL in
 * a page's HTML ends up in browser caches, screenshots and shoulder
 * surfing, and the whole point of the token is that it is as good as a
 * password for reading the calendar.
 */
import { and, asc, eq, isNull } from "drizzle-orm";

import { createSubscriptionToken } from "#/features/calendar/server/feed-actions.server";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import type { Principal } from "#/server/auth/principal.server";
import { getDb, schema } from "#/server/db";

/**
 * Cap on live subscriptions per member.
 *
 * Generous enough for a phone, a laptop and a few kind-filtered feeds,
 * low enough that a loop in a client cannot fill the table. Revoked
 * rows do not count — they are kept forever so a leaked token can never
 * be reissued, and counting them would eventually lock a member out of
 * their own calendar.
 */
export const MAX_ACTIVE_SUBSCRIPTIONS = 10;

export interface SubscriptionSummary {
  id: string;
  label: string | null;
  createdAt: Temporal.Instant;
  lastFetchedAt: Temporal.Instant | null;
}

async function requireMember(): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (principal.status !== "approved") {
    throw new Error("Forbidden: account is not approved");
  }
  return principal;
}

/** The caller's live subscriptions. Deliberately without their tokens. */
export async function listMySubscriptionsAction(): Promise<
  SubscriptionSummary[]
> {
  const principal = await requireMember();
  return getDb()
    .select({
      id: schema.calendarSubscriptions.id,
      label: schema.calendarSubscriptions.label,
      createdAt: schema.calendarSubscriptions.createdAt,
      lastFetchedAt: schema.calendarSubscriptions.lastFetchedAt,
    })
    .from(schema.calendarSubscriptions)
    .where(
      and(
        eq(schema.calendarSubscriptions.userId, principal.userId),
        isNull(schema.calendarSubscriptions.revokedAt),
      ),
    )
    .orderBy(asc(schema.calendarSubscriptions.createdAt));
}

/**
 * Mint a subscription.
 *
 * **The only response that ever carries a token.** The page shows it
 * once, with copy and `webcal://` affordances; after that it is
 * unreadable and a member who needs it again rotates.
 */
export async function createMySubscriptionAction(input: {
  label: string | null;
}): Promise<{ id: string; token: string }> {
  const principal = await requireMember();

  const live = await listMySubscriptionsAction();
  if (live.length >= MAX_ACTIVE_SUBSCRIPTIONS) {
    throw new Error(
      `You already have ${MAX_ACTIVE_SUBSCRIPTIONS} calendar links. Revoke one before making another.`,
    );
  }

  const created = await createSubscriptionToken(principal.userId, input.label);

  await recordAuditEvent({
    actorUserId: principal.userId,
    targetUserId: principal.userId,
    action: "calendar_subscription.created",
    targetType: "calendar_subscription",
    // The row id, NEVER the token — the audit viewer renders target_id
    // as visible text, and this one is a bearer credential.
    targetId: created.id,
    metadata: { label: input.label },
  });

  return created;
}

/**
 * Revoke a subscription.
 *
 * A timestamp rather than a DELETE: the row is what guarantees the
 * UNIQUE index can never hand the same token out again, and it keeps
 * the history of what was revoked and when.
 */
export async function revokeMySubscriptionAction(input: {
  id: string;
}): Promise<void> {
  const principal = await requireMember();

  const result = await getDb()
    .update(schema.calendarSubscriptions)
    .set({ revokedAt: Temporal.Now.instant() })
    .where(
      and(
        eq(schema.calendarSubscriptions.id, input.id),
        // Ownership is enforced in the WHERE rather than by loading the
        // row and comparing: there is then no code path, now or later,
        // where the check can be skipped.
        eq(schema.calendarSubscriptions.userId, principal.userId),
        isNull(schema.calendarSubscriptions.revokedAt),
      ),
    )
    .returning({ id: schema.calendarSubscriptions.id });

  if (result.length === 0) {
    throw new Error("Calendar link not found");
  }

  await recordAuditEvent({
    actorUserId: principal.userId,
    targetUserId: principal.userId,
    action: "calendar_subscription.revoked",
    targetType: "calendar_subscription",
    targetId: input.id,
  });
}

/**
 * Replace a subscription with a fresh token, keeping its label.
 *
 * One action rather than a revoke + create pair, because the member
 * performed one action and the audit log should say so — and because
 * the intermediate state (label gone, no replacement yet) is not one
 * any caller should be able to observe.
 */
export async function rotateMySubscriptionAction(input: {
  id: string;
}): Promise<{ id: string; token: string }> {
  const principal = await requireMember();

  const rows = await getDb()
    .select({ label: schema.calendarSubscriptions.label })
    .from(schema.calendarSubscriptions)
    .where(
      and(
        eq(schema.calendarSubscriptions.id, input.id),
        eq(schema.calendarSubscriptions.userId, principal.userId),
        isNull(schema.calendarSubscriptions.revokedAt),
      ),
    )
    .limit(1);
  const existing = rows.at(0);
  if (!existing) {
    throw new Error("Calendar link not found");
  }

  await getDb()
    .update(schema.calendarSubscriptions)
    .set({ revokedAt: Temporal.Now.instant() })
    .where(eq(schema.calendarSubscriptions.id, input.id));

  const created = await createSubscriptionToken(
    principal.userId,
    existing.label,
  );

  await recordAuditEvent({
    actorUserId: principal.userId,
    targetUserId: principal.userId,
    action: "calendar_subscription.rotated",
    targetType: "calendar_subscription",
    targetId: created.id,
    metadata: { label: existing.label, replaced: input.id },
  });

  return created;
}
