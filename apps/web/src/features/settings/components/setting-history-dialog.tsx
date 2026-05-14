/**
 * Per-setting change history dialog. Opens from the History icon on a
 * row; renders the last N `settings_updated` audit rows for that
 * setting's key with timestamp, actor, and boolean value where the
 * audit row stored one. Lazy: query fires only while the dialog is open.
 *
 * Value rendering matches the audit metadata policy — booleans are
 * shown (on/off badge); other shapes display only the timestamp/actor
 * because the audit row never stored the value (emails, URLs, freeform
 * JSON would leak through the log otherwise).
 */
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";

import { Badge } from "#/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { settingHistoryQueryOptions } from "#/features/settings/api/queries";
import type { SettingKey } from "#/server/settings/settings-registry";

export function SettingHistoryDialog({
  settingKey,
  open,
  onOpenChange,
  label,
}: {
  settingKey: SettingKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
}) {
  const { data, isLoading, isError } = useQuery(
    settingHistoryQueryOptions(settingKey, { enabled: open }),
  );
  const entries = data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit history — {label}</DialogTitle>
          <DialogDescription>
            Most recent changes recorded in the audit log for this setting.
            Boolean values are shown; other value types are recorded by key only
            (the audit row never stores the value to avoid leaking emails, URLs,
            or freeform JSON).
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-destructive">
            Couldn’t load history. Try again.
          </p>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No edits recorded yet.
          </p>
        ) : (
          // Cap the list at 60vh so a long change history scrolls inside
          // the dialog rather than pushing the dialog itself past the
          // viewport. `overscroll-contain` keeps the page underneath
          // from scrolling when the list reaches its top/bottom.
          <div className="max-h-[60vh] overflow-y-auto overscroll-contain rounded-md border">
            <ol className="divide-y text-sm">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate">
                      {entry.actorName ?? "An officer"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNowStrict(new Date(entry.atMs), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  {entry.booleanValue === null ? null : (
                    <Badge
                      variant={entry.booleanValue ? "default" : "secondary"}
                    >
                      {entry.booleanValue ? "On" : "Off"}
                    </Badge>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
