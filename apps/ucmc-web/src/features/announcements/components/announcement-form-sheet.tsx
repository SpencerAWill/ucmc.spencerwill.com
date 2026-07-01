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
import type { AnnouncementSummary } from "#/features/announcements/server/announcements-fns";
import { useCreateAnnouncement } from "#/features/announcements/api/use-create-announcement";
import { useUpdateAnnouncement } from "#/features/announcements/api/use-update-announcement";

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
  const isEdit = intent.mode === "edit";

  const createMutation = useCreateAnnouncement();
  const updateMutation = useUpdateAnnouncement();

  const submit = (data: AnnouncementInput) => {
    if (intent.mode === "edit") {
      updateMutation.mutate(
        { id: intent.announcement.id, ...data },
        {
          onSuccess: () => {
            toast.success("Announcement updated");
            onClose();
          },
          onError: () => {
            toast.error("Couldn’t update the announcement. Please try again.");
          },
        },
      );
      return;
    }
    createMutation.mutate(data, {
      onSuccess: () => {
        toast.success("Announcement posted");
        onClose();
      },
      onError: () => {
        toast.error("Couldn’t post the announcement. Please try again.");
      },
    });
  };

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
      submit(value);
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
