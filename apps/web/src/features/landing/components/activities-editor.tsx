import {
  GripVertical,
  Image as ImageIcon,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";
import ReactCrop from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { toast } from "sonner";

import { SortableItem, SortableList } from "#/components/sortable-list";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { useCreateActivity } from "#/features/landing/api/use-create-activity";
import { useDeleteActivity } from "#/features/landing/api/use-delete-activity";
import { useReorderActivities } from "#/features/landing/api/use-reorder-activities";
import { useUpdateActivity } from "#/features/landing/api/use-update-activity";
import { ActivityIcon } from "#/features/landing/components/activity-icon";
import { IconPicker } from "#/features/landing/components/icon-picker";
import { landingImageUrlFor } from "#/features/landing/lib/image-url";
import { noPasswordManagerProps } from "#/features/landing/lib/no-password-manager";
import { useImageCrop } from "#/features/landing/lib/use-image-crop";
import type { ActivitySummary } from "#/features/landing/server/landing-fns";
import { LANDING_LIMITS } from "#/features/landing/server/landing-schemas";
import type { ActivityIcon as ActivityIconName } from "#/features/landing/server/landing-schemas";

export interface ActivitiesEditorProps {
  items: ActivitySummary[];
  onSaved: () => void;
  onCancel: () => void;
}

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; item: ActivitySummary };

export function ActivitiesEditor({
  items,
  onSaved,
  onCancel,
}: ActivitiesEditorProps) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const create = useCreateActivity();
  const update = useUpdateActivity();
  const remove = useDeleteActivity();
  const reorder = useReorderActivities();

  async function applyReorder(ids: string[]) {
    try {
      await reorder.mutateAsync({ ids });
    } catch {
      toast.error("Couldn’t reorder.");
    }
  }

  async function deleteItem(id: string) {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this activity?")
    ) {
      return;
    }
    try {
      await remove.mutateAsync({ id });
      toast.success("Deleted");
    } catch {
      toast.error("Couldn’t delete.");
    }
  }

  if (mode.kind === "create") {
    return (
      <ActivityForm
        onSubmit={async (data) => {
          await create.mutateAsync(data);
          toast.success("Activity added");
          setMode({ kind: "list" });
        }}
        onCancel={() => setMode({ kind: "list" })}
        busy={create.isPending}
      />
    );
  }

  if (mode.kind === "edit") {
    return (
      <ActivityForm
        initial={mode.item}
        onSubmit={async (data) => {
          await update.mutateAsync({ id: mode.item.id, ...data });
          toast.success("Activity updated");
          setMode({ kind: "list" });
        }}
        onCancel={() => setMode({ kind: "list" })}
        busy={update.isPending}
      />
    );
  }

  return (
    <div className="space-y-4">
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No activities yet.
        </p>
      ) : (
        <SortableList
          ids={items.map((it) => it.id)}
          onReorder={applyReorder}
          disabled={reorder.isPending}
        >
          <ul className="space-y-2">
            {items.map((item) => (
              <SortableItem key={item.id} id={item.id}>
                {({ setNodeRef, style, attributes, listeners, isDragging }) => (
                  <li
                    ref={setNodeRef}
                    style={style}
                    className={`flex items-start gap-3 rounded-md border bg-card p-3 ${
                      isDragging ? "shadow-md" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="mt-0.5 flex size-7 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
                      aria-label="Drag to reorder"
                      {...attributes}
                      {...listeners}
                    >
                      <GripVertical className="size-4" />
                    </button>
                    <ActivityIcon
                      name={item.icon}
                      className="mt-0.5 size-5 shrink-0 text-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.title}
                      </p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {item.blurb}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setMode({ kind: "edit", item })}
                        aria-label="Edit"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => deleteItem(item.id)}
                        disabled={remove.isPending}
                        aria-label="Delete"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </li>
                )}
              </SortableItem>
            ))}
          </ul>
        </SortableList>
      )}

      <div className="flex items-center justify-between">
        <Button type="button" onClick={() => setMode({ kind: "create" })}>
          <Plus className="mr-1.5 size-4" />
          Add activity
        </Button>
        <Button type="button" variant="ghost" onClick={onSaved}>
          Done
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        className="hidden"
        onClick={onCancel}
      />
    </div>
  );
}

interface ActivityFormSubmit {
  icon: ActivityIconName;
  title: string;
  blurb: string;
  dataUrl?: string;
  removeImage?: boolean;
}

function ActivityForm({
  initial,
  onSubmit,
  onCancel,
  busy,
}: {
  initial?: ActivitySummary;
  onSubmit: (data: ActivityFormSubmit) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}) {
  const [icon, setIcon] = useState<ActivityIconName>(
    initial?.icon ?? "Mountain",
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [blurb, setBlurb] = useState(initial?.blurb ?? "");
  // True when the admin clicked "Remove image" — sent to the server so it
  // clears `image_key` and deletes the R2 object.
  const [imageRemoved, setImageRemoved] = useState(false);
  const crop = useImageCrop({
    aspect: 4 / 3,
    outputWidth: 1200,
    outputHeight: 900,
  });

  const hasExistingImage = Boolean(initial?.imageKey) && !imageRemoved;

  async function submit() {
    const t = title.trim();
    const b = blurb.trim();
    if (t.length === 0 || b.length === 0) {
      toast.error("Title and blurb are required.");
      return;
    }
    try {
      const dataUrl = (await crop.getCroppedDataUrl()) ?? undefined;
      await onSubmit({
        icon,
        title: t,
        blurb: b,
        dataUrl,
        removeImage: imageRemoved && !dataUrl ? true : undefined,
      });
    } catch (err) {
      toast.error(
        err instanceof Error && err.message ? err.message : "Couldn’t save.",
      );
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="activity-icon">Icon</Label>
        <IconPicker value={icon} onChange={setIcon} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="activity-title">Title</Label>
        <Input
          id="activity-title"
          value={title}
          maxLength={LANDING_LIMITS.activityTitle.max}
          onChange={(e) => setTitle(e.target.value)}
          {...noPasswordManagerProps}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="activity-blurb">Blurb</Label>
        <Textarea
          id="activity-blurb"
          value={blurb}
          maxLength={LANDING_LIMITS.activityBlurb.max}
          onChange={(e) => setBlurb(e.target.value)}
          rows={3}
          {...noPasswordManagerProps}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="activity-image">
          Image{" "}
          <span className="text-xs font-normal text-muted-foreground">
            (optional)
          </span>
        </Label>
        <p className="text-xs text-muted-foreground">
          When set, the card reveals this image on hover (desktop) or tap
          (mobile).
        </p>
        {crop.workingUrl ? (
          <div className="space-y-2">
            <ReactCrop {...crop.reactCropProps}>
              <img {...crop.imgProps} />
            </ReactCrop>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={crop.reset}
            >
              <X className="mr-1 size-3.5" />
              Choose a different image
            </Button>
          </div>
        ) : hasExistingImage && initial?.imageKey ? (
          <div className="space-y-2">
            <div className="aspect-[4/3] w-48 overflow-hidden rounded-md border">
              <img
                src={landingImageUrlFor(initial.imageKey)}
                alt={initial.title}
                className="size-full object-cover"
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={crop.openPicker}
                disabled={busy}
              >
                <Upload className="mr-1.5 size-4" />
                Replace
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setImageRemoved(true)}
                disabled={busy}
              >
                <Trash2 className="mr-1.5 size-4" />
                Remove image
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={crop.openPicker}
            disabled={busy}
          >
            <ImageIcon className="mr-1.5 size-4" />
            {imageRemoved ? "Pick a new image" : "Pick an image"}
          </Button>
        )}
        <input
          ref={crop.fileInputRef}
          id="activity-image"
          {...crop.fileInputProps}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
