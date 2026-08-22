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
import type { SettingMeta } from "#/server/settings/settings-registry";

/**
 * Confirmation gate for a setting whose metadata declares `confirm`.
 * Shared by the full `SettingRow` and the compact page-flag rows — see
 * `useSettingSaver`, which owns the `pending` state this renders.
 *
 * Renders nothing when the setting has no `confirm` message, so callers
 * can mount it unconditionally.
 */
export function SettingConfirmDialog<TValue>({
  meta,
  pending,
  setPending,
  persist,
  isPending,
}: {
  meta: SettingMeta;
  pending: TValue | null;
  setPending: (next: TValue | null) => void;
  persist: (value: TValue) => Promise<void>;
  isPending: boolean;
}) {
  if (!meta.confirm) {
    return null;
  }
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) {
          setPending(null);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm change to {meta.label}</AlertDialogTitle>
          <AlertDialogDescription>{meta.confirm}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={(e) => {
              // Keep the dialog mounted until the write settles so the
              // button can show its pending state; Radix would otherwise
              // close on click and drop it.
              e.preventDefault();
              if (pending !== null) {
                void persist(pending).finally(() => setPending(null));
              }
            }}
          >
            {isPending ? "Saving..." : "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
