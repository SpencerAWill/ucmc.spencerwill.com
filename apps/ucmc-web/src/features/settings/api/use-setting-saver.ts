import { useState } from "react";

import { useUpdateSetting } from "#/features/settings/api/use-update-setting";
import { getMeta } from "#/server/settings/settings-registry";
import type {
  SettingKey,
  SettingValue,
} from "#/server/settings/settings-registry";

/**
 * Save one setting, honoring its `meta.confirm` gate.
 *
 * Extracted from `SettingRow` so the compact page-flag rows share the
 * exact same write path. The confirm gate is a safety feature — it's what
 * stops someone flipping the Members section switch without being told it
 * takes down every officer queue — and two copies of that logic is one
 * copy too many.
 *
 * `pending` carries the proposed value across the open → confirm hop, so
 * a gated control must render the canonical value (not the proposal)
 * until the user actually confirms.
 *
 * `requestSave` resolves with the outcome so a caller can react to it —
 * an inline editor needs to know whether to close itself, and closing on
 * submit rather than on success throws away what the member typed the
 * moment the value fails validation. `"confirming"` is its own outcome
 * because the write hasn't happened yet: the confirm dialog owns it from
 * there, and a caller that closed on `"confirming"` would be guessing.
 */
/**
 * What a save attempt did. `"confirming"` means nothing has been written
 * yet — the value is parked in `pending` and the confirm dialog decides.
 */
export type SaveOutcome = "saved" | "failed" | "confirming";

export function useSettingSaver<TKey extends SettingKey>(settingKey: TKey) {
  const mutation = useUpdateSetting();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<SettingValue<TKey> | null>(null);
  const meta = getMeta(settingKey);

  /** Resolves true when the value was actually written. */
  async function persist(nextValue: SettingValue<TKey>): Promise<boolean> {
    setError(null);
    try {
      const result = await mutation.mutateAsync({
        key: settingKey,
        value: nextValue,
      } as Parameters<ReturnType<typeof useUpdateSetting>["mutateAsync"]>[0]);
      if (!result.ok) {
        setError(
          result.reason === "invalid_value"
            ? "Value failed validation. Check the format and try again."
            : "Unknown setting key. The registry may be out of sync.",
        );
        return false;
      }
      return true;
    } catch {
      // `mutateAsync` rejects on a transport failure, and every caller
      // reached this through a `void`, so a dropped connection used to
      // surface as an unhandled rejection and nothing on screen — the
      // row simply appeared not to respond.
      setError("Couldn’t reach the server. Check your connection and retry.");
      return false;
    }
  }

  /**
   * Save entry point. Routes through the confirm dialog when the
   * setting's metadata requires it, so reset-to-default and a direct
   * toggle are gated identically.
   */
  async function requestSave(
    nextValue: SettingValue<TKey>,
  ): Promise<SaveOutcome> {
    if (meta.confirm) {
      setPending(nextValue);
      return "confirming";
    }
    return (await persist(nextValue)) ? "saved" : "failed";
  }

  return {
    /** True while a write is in flight — disable the control. */
    isPending: mutation.isPending,
    error,
    /** Non-null while the confirm dialog is open. */
    pending,
    setPending,
    persist,
    requestSave,
  };
}
