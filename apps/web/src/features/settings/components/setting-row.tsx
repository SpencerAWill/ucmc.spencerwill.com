/**
 * One settings row: label + description + lifecycle badges + editor +
 * inline Save button. The editor type is picked by schema introspection
 * unless the registry entry declares a custom `editor` key (no built-in
 * editor keys today; the introspection path handles every v1 entry).
 *
 * Dirty / saving state is local to the row — saving one setting doesn't
 * block editing of another, and an error on row A doesn't reset row B.
 * Cache invalidation in the mutation hook re-syncs unsaved-but-unchanged
 * values from the canonical snapshot after each successful save.
 */
import { formatRelative } from "#/lib/date-format";
import { History, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { useUpdateSetting } from "#/features/settings/api/use-update-setting";
import type { SiteSettingEntry } from "#/features/settings/server/settings-fns";
import {
  getMeta,
  isDefault,
  isStale,
  SETTINGS,
} from "#/server/settings/settings-registry";
import type {
  SettingKey,
  SettingMeta,
  SettingValue,
} from "#/server/settings/settings-registry";
import { autoFormType } from "./auto-form/introspect";
import { SettingHistoryDialog } from "./setting-history-dialog";

export function SettingRow<TKey extends SettingKey>({
  settingKey,
  entry,
}: {
  settingKey: TKey;
  entry: SiteSettingEntry<TKey>;
}) {
  const meta = getMeta(settingKey);
  const formType = autoFormType(SETTINGS[settingKey]);
  const value = entry.value;
  const [draft, setDraft] = useState<SettingValue<TKey>>(value);
  const [error, setError] = useState<string | null>(null);
  // When `meta.confirm` is set, every save routes through an AlertDialog
  // first. `pending` carries the proposed value across the open → confirm
  // hop; clearing it on cancel/confirm closes the dialog.
  const [pending, setPending] = useState<SettingValue<TKey> | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const mutation = useUpdateSetting();

  // When the canonical value changes from outside (another tab edited;
  // post-save invalidate re-read), reset the draft.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const isDirty = draft !== value;
  const isBoolean = formType === "boolean";
  const isCustomized = !isDefault(settingKey, value);
  const defaultValue = SETTINGS[settingKey].parse(undefined) as SettingValue<
    typeof settingKey
  >;

  async function persist(nextValue: SettingValue<TKey>) {
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
   * Save entry point: gates through the confirm dialog when the
   * setting's metadata requires it. The reset and toggle/save flows
   * both feed through this so the gate is consistent.
   */
  function requestSave(nextValue: SettingValue<TKey>) {
    if (meta.confirm) {
      setPending(nextValue);
      return;
    }
    void persist(nextValue);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-sm font-medium">{meta.label}</Label>
            <LifecycleBadges meta={meta} isCustomized={isCustomized} />
          </div>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
        {isBoolean ? (
          <Switch
            // For settings with a `confirm` gate, the switch must NOT
            // optimistically flip — render the canonical value until
            // the user confirms (or cancels) in the dialog. Otherwise
            // we'd briefly show a state the user hasn't agreed to.
            checked={draft as boolean}
            disabled={mutation.isPending}
            onCheckedChange={(checked) => {
              const next = checked as SettingValue<TKey>;
              if (meta.confirm) {
                requestSave(next);
                return;
              }
              setDraft(next);
              void persist(next);
            }}
          />
        ) : null}
      </div>
      {!isBoolean ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            type={inferInputType(settingKey)}
            value={draft as string | number}
            onChange={(e) => {
              const raw = e.target.value;
              if (formType === "number") {
                setDraft(Number(raw) as SettingValue<TKey>);
              } else {
                setDraft(raw as SettingValue<TKey>);
              }
            }}
            disabled={mutation.isPending}
            className="flex-1"
          />
          <Button
            type="button"
            disabled={!isDirty || mutation.isPending}
            onClick={() => requestSave(draft)}
          >
            {mutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <RowFooter
        entry={entry}
        isCustomized={isCustomized}
        canReset={isCustomized && !mutation.isPending}
        onReset={() => requestSave(defaultValue)}
        onOpenHistory={() => setHistoryOpen(true)}
      />

      {meta.confirm ? (
        <AlertDialog
          open={pending !== null}
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Confirm change to {meta.label}
              </AlertDialogTitle>
              <AlertDialogDescription>{meta.confirm}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={mutation.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={mutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  if (pending !== null) {
                    setDraft(pending);
                    void persist(pending).finally(() => setPending(null));
                  }
                }}
              >
                {mutation.isPending ? "Saving..." : "Confirm"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      <SettingHistoryDialog
        settingKey={settingKey}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        label={meta.label}
      />
    </div>
  );
}

function RowFooter<TKey extends SettingKey>({
  entry,
  isCustomized,
  canReset,
  onReset,
  onOpenHistory,
}: {
  entry: SiteSettingEntry<TKey>;
  isCustomized: boolean;
  canReset: boolean;
  onReset: () => void;
  onOpenHistory: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <LastEditedLine entry={entry} />
      <div className="flex items-center gap-1">
        {isCustomized ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Reset to default"
                disabled={!canReset}
                onClick={onReset}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reset to default</TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Edit history"
              onClick={onOpenHistory}
            >
              <History className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit history</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function LifecycleBadges({
  meta,
  isCustomized,
}: {
  meta: SettingMeta;
  isCustomized: boolean;
}) {
  const stale = isStale(meta);
  return (
    <div className="flex flex-wrap gap-1">
      {/* "Custom" means the stored value differs from the schema default.
          Settings that have been actively touched are more interesting at
          a glance than untouched ones — surfacing this lets officers scan
          the page and spot what's been changed without diffing per row. */}
      {isCustomized ? (
        <Badge variant="secondary" className="text-[10px]">
          Custom
        </Badge>
      ) : null}
      {meta.flagKind ? (
        <Badge variant="outline" className="text-[10px] uppercase">
          {meta.flagKind}
        </Badge>
      ) : null}
      {stale ? (
        <Badge variant="destructive" className="text-[10px]">
          Stale — review
        </Badge>
      ) : null}
    </div>
  );
}

function LastEditedLine<TKey extends SettingKey>({
  entry,
}: {
  entry: SiteSettingEntry<TKey>;
}) {
  if (entry.updatedAtMs === null) return null;
  const when = formatRelative(
    Temporal.Instant.fromEpochMilliseconds(entry.updatedAtMs),
  );
  const who = entry.updatedByName ?? "an officer";
  return (
    <p className="text-[11px] text-muted-foreground">
      Edited {when} by {who}
    </p>
  );
}

/**
 * Pick a sensible HTML input type for the column. Conservative — defaults
 * to "text" when in doubt. Adding `type="url"` / `"email"` is a hint to
 * the browser, not a validation guarantee: the registry schema is still
 * the source of truth and the action layer rejects bad shapes.
 */
function inferInputType(key: SettingKey): "text" | "email" | "url" | "number" {
  if (key.endsWith("Email")) return "email";
  if (key.endsWith("Url")) return "url";
  const ft = autoFormType(SETTINGS[key]);
  if (ft === "number") return "number";
  return "text";
}
