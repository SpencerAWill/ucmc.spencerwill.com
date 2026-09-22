/**
 * One settings row: label + description + lifecycle badges + editor.
 * The editor type is picked by schema introspection unless the registry
 * entry declares a custom `editor` key (no built-in editor keys today;
 * the introspection path handles every v1 entry).
 *
 * **Booleans apply on change; everything else is click-to-edit.** That
 * split is the shape of the page rather than an inconsistency: a switch
 * carries its own commit (you can see what you did and undo it in one
 * tap), while a text value needs a deliberate write because each one is
 * an audit event and several are live kill switches.
 *
 * A text row is therefore a *value with a pencil* at rest, not a
 * permanently-mounted input and Save button. `/settings` is forty-odd
 * rows deep, and the always-present editor cost two stacked blocks per
 * row on a phone — a full-width Save under a full-width input, forty
 * times, for a page where the overwhelmingly common interaction is
 * reading a value rather than changing one. The editor it opens is the
 * same `InputGroup` + tick/cross that `passkey-section` uses, so the two
 * inline editors in the app behave identically.
 *
 * Dirty / saving state is local to the row — saving one setting doesn't
 * block editing of another, and an error on row A doesn't reset row B.
 * Cache invalidation in the mutation hook re-syncs unsaved-but-unchanged
 * values from the canonical snapshot after each successful save.
 */
import { cn } from "#/lib/utils";
import { formatRelative } from "#/lib/date-format";
import { Check, History, Pencil, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "#/components/ui/input-group";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { useSettingSaver } from "#/features/settings/api/use-setting-saver";
import { SettingConfirmDialog } from "#/features/settings/components/setting-confirm-dialog";
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
  const [isEditing, setIsEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Write path (including the `meta.confirm` gate) is shared with the
  // compact page-flag rows so the two can't diverge on when a change is
  // confirmed. See `useSettingSaver`.
  const saver = useSettingSaver(settingKey);

  // When the canonical value changes from outside (another tab edited;
  // post-save invalidate re-read), reset the draft.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const isDirty = draft !== value;
  const isBoolean = formType === "boolean";
  // `0` is a legitimate value for a numeric setting, so this asks
  // whether the string form is empty rather than leaning on falsiness.
  const hasValue = String(value).length > 0;
  const isCustomized = !isDefault(settingKey, value);
  const defaultValue = SETTINGS[settingKey].parse(undefined) as SettingValue<
    typeof settingKey
  >;

  /**
   * Close on success, stay open on failure.
   *
   * Closing on *submit* would be simpler and is wrong: a value rejected
   * by the registry's schema is exactly the case where the member needs
   * what they typed still on screen to correct it, and the row behind
   * the editor renders the canonical value, so closing would silently
   * discard the edit. `"confirming"` also stays open — the write hasn't
   * happened, the dialog owns it, and cancelling there should land back
   * in the editor rather than at rest.
   */
  async function commit() {
    if ((await saver.requestSave(draft)) === "saved") {
      setIsEditing(false);
    }
  }

  function cancel() {
    setDraft(value);
    setIsEditing(false);
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
          // A boolean has no value row, so its actions ride with the
          // switch. That keeps the footer free of everything but the
          // last-edited line for every kind of row.
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              // For settings with a `confirm` gate, the switch must NOT
              // optimistically flip — render the canonical value until
              // the user confirms (or cancels) in the dialog. Otherwise
              // we'd briefly show a state the user hasn't agreed to.
              checked={draft as boolean}
              disabled={saver.isPending}
              onCheckedChange={(checked) => {
                const next = checked as SettingValue<TKey>;
                if (meta.confirm) {
                  void saver.requestSave(next);
                  return;
                }
                setDraft(next);
                void saver.persist(next);
              }}
            />
            <RowActions
              isCustomized={isCustomized}
              canReset={isCustomized && !saver.isPending}
              onReset={() => void saver.requestSave(defaultValue)}
              onOpenHistory={() => setHistoryOpen(true)}
            />
          </div>
        ) : null}
      </div>
      {!isBoolean ? (
        /*
         * The actions are the row's trailing cluster in *both* states,
         * which is the point of this shape. Only the leading part swaps
         * — value + pencil at rest, the editor and its own tick/cross
         * while editing — so the flexible element absorbs the width
         * change and the history and reset buttons stay exactly where
         * the eye left them. A control that relocates when you start
         * typing is worse than the row being a line taller.
         */
        <div className="flex items-center gap-2">
          {isEditing ? (
            <InputGroup className="flex-1">
              <InputGroupInput
                autoFocus
                type={inferInputType(settingKey)}
                value={draft as string | number}
                aria-label={`${meta.label} value`}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (formType === "number") {
                    setDraft(Number(raw) as SettingValue<TKey>);
                  } else {
                    setDraft(raw as SettingValue<TKey>);
                  }
                }}
                onKeyDown={(e) => {
                  // Enter and Escape are what anyone typing in a
                  // one-field inline editor reaches for, and the input is
                  // not inside a <form>, so Enter would otherwise do
                  // nothing at all. Same contract as `passkey-section`.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancel();
                  }
                }}
                disabled={saver.isPending}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  aria-label={`Save ${meta.label}`}
                  disabled={!isDirty || saver.isPending}
                  onClick={() => void commit()}
                >
                  <Check />
                </InputGroupButton>
                <InputGroupButton
                  type="button"
                  aria-label={`Cancel editing ${meta.label}`}
                  disabled={saver.isPending}
                  onClick={cancel}
                >
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          ) : (
            <>
              {/* `break-all` rather than `truncate`: a setting's value is
                usually a URL or an address, and a truncated one can't be
                checked against anything, which is the main reason anyone
                is on this page. Wrapping costs a line; truncating costs
                the point. */}
              <span
                className={cn(
                  "min-w-0 flex-1 text-sm break-all",
                  hasValue ? "font-mono" : "text-muted-foreground italic",
                )}
              >
                {hasValue ? String(value) : "Not set"}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-9 shrink-0 text-muted-foreground hover:text-foreground sm:size-8"
                    aria-label={`Edit ${meta.label}`}
                    onClick={() => {
                      // Re-seed from the canonical value so an abandoned
                      // edit doesn't reappear on the next open.
                      setDraft(value);
                      setIsEditing(true);
                    }}
                  >
                    <Pencil />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit</TooltipContent>
              </Tooltip>
            </>
          )}
          <RowActions
            isCustomized={isCustomized}
            canReset={isCustomized && !saver.isPending}
            onReset={() => void saver.requestSave(defaultValue)}
            onOpenHistory={() => setHistoryOpen(true)}
          />
        </div>
      ) : null}
      {saver.error ? (
        <p className="text-xs text-destructive">{saver.error}</p>
      ) : null}
      {/* The only thing left in the footer position. It returns null
          when the setting has never been edited, so an untouched row
          simply doesn't have this line — which is most of them, and is
          why the actions moved up: an icons-only footer was a whole
          extra row of dead space on forty cards. */}
      <LastEditedLine entry={entry} />

      <SettingConfirmDialog
        meta={meta}
        pending={saver.pending}
        setPending={saver.setPending}
        persist={saver.persist}
        isPending={saver.isPending}
      />

      <SettingHistoryDialog
        settingKey={settingKey}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        label={meta.label}
      />
    </div>
  );
}

/**
 * Reset-to-default and edit-history, as one cluster.
 *
 * Rendered as the trailing element of whichever row carries the
 * setting's control — the value row for a text setting, the header row
 * beside the switch for a boolean. It used to be a footer of its own,
 * but `LastEditedLine` returns null for a setting nobody has changed, so
 * on most of the forty-odd rows that footer was a row containing
 * nothing but two icons.
 *
 * Sized to match the pencil it sits next to rather than keeping the
 * denser standalone size: three icon buttons of two different sizes in
 * one row reads as a mistake. 36px on a phone, 32px from `sm` up.
 */
function RowActions({
  isCustomized,
  canReset,
  onReset,
  onOpenHistory,
}: {
  isCustomized: boolean;
  canReset: boolean;
  onReset: () => void;
  onOpenHistory: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {isCustomized ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-9 text-muted-foreground hover:text-foreground sm:size-8"
              aria-label="Reset to default"
              disabled={!canReset}
              onClick={onReset}
            >
              <RotateCcw className="size-4 sm:size-3.5" />
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
            size="icon-sm"
            className="size-9 text-muted-foreground hover:text-foreground sm:size-8"
            aria-label="Edit history"
            onClick={onOpenHistory}
          >
            <History className="size-4 sm:size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Edit history</TooltipContent>
      </Tooltip>
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
