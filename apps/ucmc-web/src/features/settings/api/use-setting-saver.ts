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
 */
export function useSettingSaver<TKey extends SettingKey>(settingKey: TKey) {
  const mutation = useUpdateSetting();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<SettingValue<TKey> | null>(null);
  const meta = getMeta(settingKey);

  async function persist(nextValue: SettingValue<TKey>): Promise<void> {
    setError(null);
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
    }
  }

  /**
   * Save entry point. Routes through the confirm dialog when the
   * setting's metadata requires it, so reset-to-default and a direct
   * toggle are gated identically.
   */
  function requestSave(nextValue: SettingValue<TKey>): void {
    if (meta.confirm) {
      setPending(nextValue);
      return;
    }
    void persist(nextValue);
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
