import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { useAppForm } from "#/lib/form/form";
import {
  ANNOUNCEMENT_LIMITS,
  announcementInputSchema,
} from "#/features/announcements/server/limits";
import type { AnnouncementInput } from "#/features/announcements/server/limits";
import {
  createAnnouncementFn,
  updateAnnouncementFn,
} from "#/features/announcements/server/announcements-fns";
import type { AnnouncementSummary } from "#/features/announcements/server/announcements-fns";

import { ANNOUNCEMENTS_LIST_QUERY_KEY } from "#/features/announcements/api/query-keys";
import { ANNOUNCEMENTS_UNREAD_QUERY_KEY } from "#/features/announcements/components/announcements-bell";

export type AnnouncementFormMode =
  | { mode: "create" }
  | { mode: "edit"; announcement: AnnouncementSummary };

export function AnnouncementFormSheet({
  open,
  onOpenChange,
  intent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent: AnnouncementFormMode;
}) {
  const isEdit = intent.mode === "edit";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0">
        <SheetHeader>
          <SheetTitle>
            {isEdit ? "Edit announcement" : "New announcement"}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Update the title or body. Members will see your edit immediately."
              : "Post an announcement visible to all members with announcements:read."}
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <AnnouncementForm
            intent={intent}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function AnnouncementForm({
  intent,
  onClose,
}: {
  intent: AnnouncementFormMode;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = intent.mode === "edit";

  const mutation = useMutation({
    mutationFn: async (data: AnnouncementInput) => {
      if (intent.mode === "edit") {
        return updateAnnouncementFn({
          data: { id: intent.announcement.id, ...data },
        });
      }
      return createAnnouncementFn({ data });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ANNOUNCEMENTS_LIST_QUERY_KEY,
        }),
        queryClient.invalidateQueries({
          queryKey: ANNOUNCEMENTS_UNREAD_QUERY_KEY,
        }),
      ]);
      toast.success(isEdit ? "Announcement updated" : "Announcement posted");
      onClose();
    },
    onError: () => {
      toast.error(
        isEdit
          ? "Couldn’t update the announcement. Please try again."
          : "Couldn’t post the announcement. Please try again.",
      );
    },
  });

  const defaults: AnnouncementInput =
    intent.mode === "edit"
      ? {
          title: intent.announcement.title,
          body: intent.announcement.body,
        }
      : { title: "", body: "" };

  const form = useAppForm({
    defaultValues: defaults,
    validators: {
      onChange: announcementInputSchema,
      onBlur: announcementInputSchema,
      onSubmit: announcementInputSchema,
    },
    onSubmit: ({ value }) => {
      mutation.mutate(value);
    },
  });

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(isSubmitting) => (
          <fieldset
            disabled={isSubmitting}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-0 px-4 pb-4"
          >
            <form.AppField name="title">
              {(field) => (
                <field.TextField
                  label="Title"
                  placeholder="Trip signups open Friday"
                  maxLength={ANNOUNCEMENT_LIMITS.title.max}
                />
              )}
            </form.AppField>
            <form.AppField name="body">
              {(field) => (
                <field.TextArea
                  label="Body"
                  placeholder="Details, links, what members should do…"
                  rows={10}
                  maxLength={ANNOUNCEMENT_LIMITS.body.max}
                />
              )}
            </form.AppField>
          </fieldset>
        )}
      </form.Subscribe>
      <SheetFooter>
        <form.AppForm>
          <form.SubscribeButton label={isEdit ? "Save changes" : "Post"} />
        </form.AppForm>
      </SheetFooter>
    </form>
  );
}
