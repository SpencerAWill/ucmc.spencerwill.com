/**
 * Read-side actions for the audit log viewer at `/audit`. The viewer
 * is read-only by design; writes go through `recordAuditEvent` in
 * the various feature server modules. The shell wrapper is in
 * `./audit-fns.ts`.
 */
import { aliasedTable, and, count, desc, eq, gte, lt } from "drizzle-orm";

import { loadCurrentPrincipal } from "#/server/auth/session.server";
import { getDb, schema } from "#/server/db";

const PER_PAGE_DEFAULT = 50;
const PER_PAGE_MAX = 200;

export interface AuditUserRef {
  userId: string;
  /** `users.public_id` — the routable token used by `/members/$publicId`.
   *  Exposed so the viewer can link to a member's profile without an
   *  extra fetch. */
  publicId: string;
  preferredName: string | null;
  email: string;
}

export interface AuditEntrySummary {
  id: string;
  action: schema.AuditAction;
  createdAt: number;
  actor: AuditUserRef | null;
  target: AuditUserRef | null;
  /** Non-user target (role / landing setting / waiver attestation / etc.) */
  targetType: string | null;
  targetId: string | null;
  /** Parsed metadata. `null` if absent or malformed JSON. The
   *  serialization-friendly recursive type makes TanStack Start's
   *  RPC checker happy without losing the "this came from a JSON
   *  blob" shape. */
  metadata: JsonObject | null;
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

export interface ListAuditEventsResult {
  entries: AuditEntrySummary[];
  totalCount: number;
}

async function requireAuditViewer() {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  if (!principal.permissions.includes("audit:view")) {
    throw new Error("Forbidden: missing audit:view");
  }
  return principal;
}

export async function listAuditEventsAction(input: {
  page?: number;
  perPage?: number;
  /** Optional filter by action type. */
  action?: schema.AuditAction;
  /** Optional filter — start of the date range (inclusive), in ms. */
  from?: number;
  /** Optional filter — end of the date range (exclusive), in ms.
   *  Callers wanting a "through end of day X" should pass the start
   *  of day X+1. */
  to?: number;
}): Promise<ListAuditEventsResult> {
  await requireAuditViewer();

  const page = Math.max(1, input.page ?? 1);
  const perPage = Math.min(input.perPage ?? PER_PAGE_DEFAULT, PER_PAGE_MAX);
  const offset = (page - 1) * perPage;

  const db = getDb();
  const actorUsers = aliasedTable(schema.users, "actor_users");
  const actorProfiles = aliasedTable(schema.profiles, "actor_profiles");
  const targetUsers = aliasedTable(schema.users, "target_users");
  const targetProfiles = aliasedTable(schema.profiles, "target_profiles");

  const filters = [
    input.action ? eq(schema.auditLog.action, input.action) : undefined,
    input.from !== undefined
      ? gte(schema.auditLog.createdAt, new Date(input.from))
      : undefined,
    input.to !== undefined
      ? lt(schema.auditLog.createdAt, new Date(input.to))
      : undefined,
  ].filter((f): f is NonNullable<typeof f> => f !== undefined);

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  // Count + page query are independent — run them in parallel so
  // every /audit load saves a D1 round-trip. Filtered indexes
  // (`audit_log_action_idx`, `audit_log_created_at_idx`) keep the
  // count cheap. The two queries use the same `whereClause` so
  // their result sets are consistent for any page the UI shows.
  const [countResult, rows] = await Promise.all([
    db.select({ totalCount: count() }).from(schema.auditLog).where(whereClause),
    db
      .select({
        id: schema.auditLog.id,
        action: schema.auditLog.action,
        createdAt: schema.auditLog.createdAt,
        actorUserId: schema.auditLog.actorUserId,
        actorPublicId: actorUsers.publicId,
        actorEmail: actorUsers.email,
        actorPreferredName: actorProfiles.preferredName,
        targetUserId: schema.auditLog.targetUserId,
        targetPublicId: targetUsers.publicId,
        targetEmail: targetUsers.email,
        targetPreferredName: targetProfiles.preferredName,
        targetType: schema.auditLog.targetType,
        targetId: schema.auditLog.targetId,
        metadataJson: schema.auditLog.metadataJson,
      })
      .from(schema.auditLog)
      .leftJoin(actorUsers, eq(actorUsers.id, schema.auditLog.actorUserId))
      .leftJoin(actorProfiles, eq(actorProfiles.userId, actorUsers.id))
      .leftJoin(targetUsers, eq(targetUsers.id, schema.auditLog.targetUserId))
      .leftJoin(targetProfiles, eq(targetProfiles.userId, targetUsers.id))
      .where(whereClause)
      // Tiebreak on `id` so pagination stays stable across requests
      // even when many rows share the same `createdAt` —
      // `recordAuditEvents` inserts bulk rows with the same default
      // timestamp, so without the secondary sort the page boundary
      // could skip or duplicate entries between requests. `id` is
      // uuidv7-prefixed so newer ids sort lexicographically after
      // older ones, matching createdAt direction.
      .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
      .limit(perPage)
      .offset(offset),
  ]);
  const totalCount = countResult[0]?.totalCount ?? 0;

  return {
    totalCount,
    entries: rows.map((r) => ({
      id: r.id,
      action: r.action,
      createdAt: r.createdAt.getTime(),
      actor: r.actorUserId
        ? {
            userId: r.actorUserId,
            publicId: r.actorPublicId ?? "",
            email: r.actorEmail ?? "",
            preferredName: r.actorPreferredName ?? null,
          }
        : null,
      target: r.targetUserId
        ? {
            userId: r.targetUserId,
            publicId: r.targetPublicId ?? "",
            email: r.targetEmail ?? "",
            preferredName: r.targetPreferredName ?? null,
          }
        : null,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: parseMetadata(r.metadataJson),
    })),
  };
}

function parseMetadata(json: string | null): JsonObject | null {
  if (!json) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Trust the JSON parse output to be a serializable tree; we
      // wrote it ourselves on the way in.
      return parsed as JsonObject;
    }
    return null;
  } catch {
    return null;
  }
}
