import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { announcementsListQueryOptions } from "#/features/announcements/api/queries";
import { useDeleteAnnouncement } from "#/features/announcements/api/use-delete-announcement";
import { useMarkAnnouncementsRead } from "#/features/announcements/api/use-mark-announcements-read";
import { AnnouncementCard } from "#/features/announcements/components/announcement-card";
import { AnnouncementFormSheet } from "#/features/announcements/components/announcement-form-sheet";
import type { AnnouncementFormMode } from "#/features/announcements/components/announcement-form-sheet";
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
import { Button } from "#/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "#/components/ui/empty";
import { requirePermission } from "#/features/auth/guards";
import { useAuth } from "#/features/auth/api/use-auth";
import type { AnnouncementSummary } from "#/features/announcements/server/announcements-fns";

export const Route = createFileRoute("/announcements/")({
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, "announcements:read");
  },
  component: AnnouncementsPage,
});

function AnnouncementsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("announcements:manage");

  const { data, isLoading } = useQuery(announcementsListQueryOptions());

  const markRead = useMarkAnnouncementsRead();

  // Mark all as read on mount and whenever the rendered count of
  // announcements changes — clears the unread badge as soon as someone
  // is looking at the page. The mutation handle from useMutation is
  // stable across renders, so excluding it from deps is safe and
  // avoids re-firing on every render. Errors are non-fatal; the hook
  // doesn't toast on failure.
  const markReadMutate = markRead.mutate;
  useEffect(() => {
    markReadMutate();
  }, [markReadMutate, data?.length]);

  const [formOpen, setFormOpen] = useState(false);
  const [formIntent, setFormIntent] = useState<AnnouncementFormMode>({
    mode: "create",
  });
  const [pendingDelete, setPendingDelete] =
    useState<AnnouncementSummary | null>(null);

  const deleteMutation = useDeleteAnnouncement();
  const onConfirmDelete = (id: string) => {
    deleteMutation.mutate(id, {
      onSuccess: () => {
        toast.success("Announcement deleted");
        setPendingDelete(null);
      },
      onError: () => {
        toast.error("Couldn’t delete the announcement. Please try again.");
      },
    });
  };

  const announcements = data ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Announcements</h1>
          <p className="text-sm text-muted-foreground">
            News and updates from UCMC.
          </p>
        </div>
        {canManage ? (
          <Button
            onClick={() => {
              setFormIntent({ mode: "create" });
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            New announcement
          </Button>
        ) : null}
      </header>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : announcements.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No announcements yet.</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-3">
          {announcements.map((a) => (
            <li key={a.id}>
              <AnnouncementCard
                announcement={a}
                canManage={canManage}
                onEdit={() => {
                  setFormIntent({ mode: "edit", announcement: a });
                  setFormOpen(true);
                }}
                onDelete={() => setPendingDelete(a)}
              />
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <>
          <AnnouncementFormSheet
            open={formOpen}
            onOpenChange={setFormOpen}
            intent={formIntent}
          />
          <AlertDialog
            open={pendingDelete !== null}
            onOpenChange={(open) => {
              if (!open) {
                setPendingDelete(null);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this announcement?</AlertDialogTitle>
                <AlertDialogDescription>
                  This is permanent. Members will no longer see this
                  announcement on their feed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteMutation.isPending}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleteMutation.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    if (pendingDelete) {
                      onConfirmDelete(pendingDelete.id);
                    }
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </div>
  );
}
