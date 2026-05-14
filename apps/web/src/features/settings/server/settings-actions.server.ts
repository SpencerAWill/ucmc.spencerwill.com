/**
 * Action implementations for /settings server fns. Dynamic-imported from
 * `./settings-fns.ts` so server-only deps (audit, repo, DB) never reach
 * the client bundle.
 *
 * Authorization happens here: every action calls `requireSettingsManager`
 * before touching state. The audit row is written atomically with the
 * setting write — `buildAuditEventStatement` returns the INSERT and we
 * spread it into the same `db.batch` as the UPSERT, so a partial failure
 * can't leave a row written without a trail.
 *
 * Audit-metadata policy: for boolean values the metadata captures
 * `{ key, value }` (booleans are non-PII and the value carries forensic
 * weight); for any other shape it captures `{ key }` only (URLs, emails,
 * and freeform JSON blobs are too easy to leak into the log). This is
 * the only branch the action layer needs — the audit-action enum stays
 * collapsed to `settings_updated`.
 */
import { getDb } from "#/server/db";
import { buildAuditEventStatement } from "#/server/audit/audit-log.server";
import { requireSettingsManager } from "./permissions.server";
import { isSettingKey, SETTINGS } from "#/server/settings/settings-registry";
import type {
  SettingKey,
  UpdateSettingInput,
} from "#/server/settings/settings-registry";
import { writeSettingStatement } from "#/server/settings/settings-repo.server";

export type UpdateSettingResult =
  | { ok: true }
  | { ok: false; reason: "unknown_key" | "invalid_value" };

export async function updateSettingAction(
  input: UpdateSettingInput,
): Promise<UpdateSettingResult> {
  const principal = await requireSettingsManager();

  // Defense in depth — the server-fn validator already enforces this,
  // but the action layer is also called directly from tests and from
  // any future server-side caller. A bad key here would otherwise
  // index into `SETTINGS` with `undefined`.
  if (!isSettingKey(input.key)) {
    return { ok: false, reason: "unknown_key" };
  }
  const key = input.key satisfies SettingKey;
  const parsed = SETTINGS[key].safeParse(input.value);
  if (!parsed.success) {
    return { ok: false, reason: "invalid_value" };
  }
  const value = parsed.data;

  const auditMetadata = typeof value === "boolean" ? { key, value } : { key };
  const audit = buildAuditEventStatement({
    actorUserId: principal.userId,
    action: "settings_updated",
    targetType: "site_setting",
    targetId: key,
    metadata: auditMetadata,
  });

  await getDb().batch([
    writeSettingStatement(key, value, principal.userId),
    audit,
  ]);

  return { ok: true };
}
