/**
 * Action implementations for announcements server fns. The shell in
 * `./announcements-fns.ts` dynamic-imports this module from inside its
 * createServerFn handlers so server-only code stays off the client graph.
 */
import { uuidv7 } from "uuidv7";

import {
  deleteAnnouncement,
  getUnreadCount,
  insertAnnouncement,
  listAnnouncements,
  markAllRead,
  updateAnnouncement,
} from "#/features/announcements/server/repo.server";
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { readSetting } from "#/server/settings/settings-repo.server";

// ── auth helpers ────────────────────────────────────────────────────────

/**
 * Kill-switch gate. Composed into every action below so the feature
 * disappears at the action boundary even if a caller bypasses the route
 * loader and the client-side bell/sidebar gates. Fail-open via the
 * registry default — same semantics as every other `readSetting` call —
 * which means a fresh DB keeps the feature hidden (default is `false`).
 */
async function requireAnnouncementsEnabled(): Promise<void> {
  const enabled = await readSetting("announcements.enabled");
  if (!enabled) {
    throw new Error("Forbidden: announcements feature is disabled");
  }
}

async function requireAnnouncementsReader(): Promise<Principal> {
  await requireAnnouncementsEnabled();
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("announcements:read")) {
    throw new Error("Forbidden: missing announcements:read");
  }
  return principal;
}

async function requireAnnouncementsManager(): Promise<Principal> {
  await requireAnnouncementsEnabled();
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("announcements:manage")) {
    throw new Error("Forbidden: missing announcements:manage");
  }
  return principal;
}

// ── public types ────────────────────────────────────────────────────────

export interface AnnouncementSummary {
  id: string;
  title: string;
  body: string;
  publishedAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  authorDisplayName: string | null;
  authorAvatarKey: string | null;
}

function toSummary(row: {
  id: string;
  title: string;
  body: string;
  publishedAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  authorEmail: string | null;
  authorFullName: string | null;
  authorPreferredName: string | null;
  authorAvatarKey: string | null;
}): AnnouncementSummary {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    authorDisplayName:
      row.authorPreferredName ?? row.authorFullName ?? row.authorEmail ?? null,
    authorAvatarKey: row.authorAvatarKey,
  };
}

// ── actions ─────────────────────────────────────────────────────────────

export async function listAnnouncementsAction(): Promise<
  AnnouncementSummary[]
> {
  await requireAnnouncementsReader();
  const rows = await listAnnouncements();
  return rows.map(toSummary);
}

export async function getUnreadCountAction(): Promise<{ count: number }> {
  const principal = await requireAnnouncementsReader();
  const count = await getUnreadCount(principal.userId);
  return { count };
}

export async function markAnnouncementsReadAction(): Promise<{ ok: true }> {
  const principal = await requireAnnouncementsReader();
  await markAllRead(principal.userId);
  return { ok: true };
}

export async function createAnnouncementAction(input: {
  title: string;
  body: string;
}): Promise<{ id: string }> {
  const principal = await requireAnnouncementsManager();
  const id = `ann_${uuidv7()}`;
  await insertAnnouncement({
    id,
    title: input.title,
    body: input.body,
    createdBy: principal.userId,
  });
  return { id };
}

export async function updateAnnouncementAction(input: {
  id: string;
  title: string;
  body: string;
}): Promise<{ ok: true }> {
  await requireAnnouncementsManager();
  await updateAnnouncement(input);
  return { ok: true };
}

export async function deleteAnnouncementAction(input: {
  id: string;
}): Promise<{ ok: true }> {
  await requireAnnouncementsManager();
  await deleteAnnouncement(input.id);
  return { ok: true };
}
