import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { Textarea } from "#/components/ui/textarea";
import { useCreateGearType } from "#/features/gear/api/use-create-gear-type";
import { useEditGearType } from "#/features/gear/api/use-edit-gear-type";
import type { GearTypeSummary } from "#/features/gear/server/gear-fns";

export type GearTypeFormMode =
  | { mode: "create" }
  | { mode: "edit"; type: GearTypeSummary };

export function GearTypeFormSheet({
  open,
  onOpenChange,
  intent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent: GearTypeFormMode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0">
        <SheetHeader>
          <SheetTitle>
            {intent.mode === "edit" ? "Edit type" : "New gear type"}
          </SheetTitle>
          <SheetDescription>
            Types exclusively partition the inventory (each piece belongs to
            one). Prefix is a UI hint for the suggested-code helper — it doesn't
            constrain what codes officers may assign.
          </SheetDescription>
        </SheetHeader>
        {open ? (
          <TypeForm intent={intent} onClose={() => onOpenChange(false)} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function TypeForm({
  intent,
  onClose,
}: {
  intent: GearTypeFormMode;
  onClose: () => void;
}) {
  const isEdit = intent.mode === "edit";
  const [name, setName] = useState(isEdit ? intent.type.name : "");
  const [prefix, setPrefix] = useState(
    isEdit ? (intent.type.prefix ?? "") : "",
  );
  const [description, setDescription] = useState(
    isEdit ? (intent.type.description ?? "") : "",
  );
  const [error, setError] = useState<string | null>(null);
  const createMutation = useCreateGearType();
  const editMutation = useEditGearType();
  const submitting = createMutation.isPending || editMutation.isPending;

  const submit = () => {
    setError(null);
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError("Name is required.");
      return;
    }
    const payload = {
      name: trimmedName,
      prefix: prefix.trim().length === 0 ? null : prefix.trim(),
      description: description.trim().length === 0 ? null : description.trim(),
    };
    if (isEdit) {
      editMutation.mutate(
        { publicId: intent.type.publicId, ...payload },
        {
          onSuccess: (result) => {
            if (result.ok) {
              toast.success("Type updated");
              onClose();
            } else {
              setError("Another type already uses that name.");
            }
          },
          onError: () => setError("Couldn't save."),
        },
      );
      return;
    }
    createMutation.mutate(payload, {
      onSuccess: (result) => {
        if (result.ok) {
          toast.success(`Type "${trimmedName}" created`);
          onClose();
        } else {
          setError("Another type already uses that name.");
        }
      },
      onError: () => setError("Couldn't save."),
    });
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset
        disabled={submitting}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-0 px-4 pb-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="type-name">Name</Label>
          <Input
            id="type-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Climbing Harness"
            maxLength={80}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="type-prefix">Prefix (optional)</Label>
          <Input
            id="type-prefix"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="CH"
            maxLength={8}
          />
          <p className="text-xs text-muted-foreground">
            UI hint. Officers can use whatever code they want.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="type-description">Description</Label>
          <Textarea
            id="type-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What kinds of items belong in this category?"
            rows={3}
            maxLength={500}
          />
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </fieldset>
      <SheetFooter>
        <Button type="submit" disabled={submitting}>
          {isEdit ? "Save changes" : "Create type"}
        </Button>
      </SheetFooter>
    </form>
  );
}
