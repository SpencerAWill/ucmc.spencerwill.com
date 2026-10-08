/**
 * The email-notification switches on `/my/preferences`.
 *
 * **Every category renders, including the ones that can't be switched
 * off.** A list that quietly omitted the overdue-gear notice would leave
 * a member believing the club has no way to contact them about gear
 * they're holding; instead the row states that it's always on and why.
 * The alternative — hiding it — is how people end up surprised by mail
 * they can't find a setting for.
 *
 * Labels and descriptions come from the server, which reads them off the
 * notification registry. There is deliberately no second copy of the
 * copy here: adding a category is a registry entry, and this component
 * grows a row without being touched.
 */
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { toast } from "sonner";

import { Label } from "#/components/ui/label";
import { Skeleton } from "#/components/ui/skeleton";
import { Switch } from "#/components/ui/switch";
import { myNotificationPreferencesQueryOptions } from "#/features/auth/api/queries";
import { useSetNotificationPreference } from "#/features/auth/api/use-set-notification-preference";
import type { NotificationPreferenceRow } from "#/features/auth/server/notification-prefs-fns";

export function NotificationPreferencesSection() {
  const { data, isLoading } = useQuery(myNotificationPreferencesQueryOptions());
  const setPreference = useSetNotificationPreference();

  const rows: NotificationPreferenceRow[] = data?.ok === true ? data.rows : [];

  const onToggle = (row: NotificationPreferenceRow, next: boolean) => {
    setPreference.mutate(
      { category: row.category, enabled: next },
      {
        onSuccess: (result) => {
          if (!result.ok) {
            toast.error("Couldn't save that preference");
            return;
          }
          toast.success(
            next ? `${row.label} turned on` : `${row.label} turned off`,
          );
        },
        onError: (err) => {
          toast.error(
            err instanceof Error
              ? err.message
              : "Couldn't save that preference",
          );
        },
      },
    );
  };

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-medium">Email notifications</h3>
        <p className="text-sm text-muted-foreground">
          What the club emails you about. Sign-in links always arrive regardless
          of these settings.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load your notification settings.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((row) => (
            <li
              key={row.category}
              className="flex items-start justify-between gap-4 p-4"
            >
              <div className="space-y-1">
                <Label
                  htmlFor={`notify-${row.category}`}
                  className="text-sm font-medium"
                >
                  {row.label}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {row.description}
                </p>
                {row.alwaysOnReason ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="size-3 shrink-0" />
                    {row.alwaysOnReason}
                  </p>
                ) : null}
              </div>
              {/* A non-suppressible category gets a disabled switch rather
                  than no switch: the row still has to read as part of the
                  same list, and an empty space beside it reads as a
                  rendering bug. The reason above says why it won't move. */}
              <Switch
                id={`notify-${row.category}`}
                checked={row.enabled}
                disabled={!row.suppressible || setPreference.isPending}
                onCheckedChange={(next) => onToggle(row, next)}
                aria-label={row.label}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
