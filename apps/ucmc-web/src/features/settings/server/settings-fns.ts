/**
 * Route-facing shells for /settings server fns. Each handler is a one-line
 * dynamic import of the action it delegates to, keeping audit/DB code off
 * the client graph.
 *
 * The input validator for `updateSettingFn` is the registry-derived
 * `updateSettingInputSchema` — adding a setting to the registry
 * auto-extends the validator without any edit here.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  SETTINGS,
  updateSettingInputSchema,
} from "#/server/settings/settings-registry";
import type {
  PageFlagKey,
  SettingKey,
  SettingValue,
  UpdateSettingInput,
} from "#/server/settings/settings-registry";
import type { UpdateSettingResult } from "./settings-actions.server";
import type {
  SiteSettingEntry,
  SiteSettingsEntries,
} from "#/server/settings/settings-repo.server";

export type { UpdateSettingResult, UpdateSettingInput };

// Public alias kept for route + UI imports. The per-key shape now includes
// edit metadata (updatedAtMs + updatedByName) alongside the value.
export type SiteSettingsSnapshot = SiteSettingsEntries;
export type { SiteSettingEntry };

/**
 * Read every site setting. Officer-gated server-side (the action checks
 * `settings:manage`) — non-officers never need this; the page lives
 * behind the same gate.
 *
 * Returned as a single map keyed by `SettingKey` so the admin page can
 * hydrate every form in one query.
 */
export const listSiteSettingsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteSettingsSnapshot> => {
    const { listSiteSettingsAction } =
      await import("./settings-actions-read.server");
    return listSiteSettingsAction();
  },
);

/**
 * Public-safe subset of site settings. No auth gate — these values are
 * rendered on the public landing page and footer for signed-out visitors.
 * The allowlist is whitelisted in the action, not extracted by category,
 * so an officer reclassifying a setting can't accidentally surface a
 * private value publicly.
 */
export type PublicSiteContact = {
  clubEmail: string;
  /** Social profile URLs. Empty string means "no account" — every
   *  consumer skips a blank rather than rendering a dead link. */
  instagramUrl: string;
  facebookUrl: string;
  youtubeUrl: string;
};

export const getPublicSiteContactFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<PublicSiteContact> => {
  const { getPublicSiteContactAction } =
    await import("./settings-actions-read.server");
  return getPublicSiteContactAction();
});

/**
 * Public read of feature-flag state. No auth gate — "is this feature
 * visible?" isn't sensitive (anyone hitting the gated URL would get the
 * same answer back), and the sidebar / header bell need this synchronously
 * to decide whether to render. Each flag here corresponds to a boolean
 * setting in the registry; the allowlist is hand-maintained, not auto-
 * derived, so reclassifying a boolean setting can't accidentally surface
 * it publicly.
 */
export type PublicFlags = {
  // Submission kill switches (distinct from page reachability): whether
  // each feedback surface accepts NEW submissions.
  websiteFeedback: boolean;
  clubFeedback: boolean;
  /** `features.announcements`. Not in `pages` — besides page reachability
   *  it gates the header bell and the server write actions, so it can't
   *  share the uniform "hide and 404" meaning the page flags have. */
  announcements: boolean;
  // Per-page kill switches, keyed by the `pages.*` suffix. Each gates both
  // the page's route (via `requirePageFlag`) and its nav/tab entry. See
  // the registry's `pages` category for the full set.
  pages: Record<PageFlagKey, boolean>;
};

export const getPublicFlagsFn = createServerFn({
  method: "GET",
}).handler(async (): Promise<PublicFlags> => {
  const { getPublicFlagsAction } =
    await import("./settings-actions-read.server");
  return getPublicFlagsAction();
});

/**
 * Per-setting change history. Officer-gated. Returns the most recent
 * `settings_updated` audit rows for a given key, with the actor's
 * display name resolved. `booleanValue` is non-null only when the audit
 * row recorded a boolean (matches the metadata policy in
 * settings-actions.server.ts).
 */
export type SettingHistoryEntry = {
  id: string;
  atMs: number;
  actorName: string | null;
  booleanValue: boolean | null;
};

const listSettingHistoryInputSchema = z.object({
  key: z.string().min(1),
});

export const listSettingHistoryFn = createServerFn({ method: "GET" })
  .validator(listSettingHistoryInputSchema)
  .handler(async ({ data }): Promise<SettingHistoryEntry[]> => {
    const { listSettingHistoryAction } =
      await import("./settings-actions-read.server");
    return listSettingHistoryAction({ key: data.key as SettingKey });
  });

export const updateSettingFn = createServerFn({ method: "POST" })
  .validator(updateSettingInputSchema)
  .handler(async ({ data }): Promise<UpdateSettingResult> => {
    const { updateSettingAction } = await import("./settings-actions.server");
    return updateSettingAction(data);
  });

// Re-export the registry shape so route components and form callers can
// reach for it without importing the registry file directly (keeps the
// import graph shallow — `settings-fns` is the public entry).
export { SETTINGS };
export type { SettingKey, SettingValue };
