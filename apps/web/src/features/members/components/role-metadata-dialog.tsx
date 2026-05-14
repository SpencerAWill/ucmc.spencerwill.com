import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

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
import { roleQueryOptions } from "#/features/members/api/queries";
import { useUpdateRole } from "#/features/members/api/use-update-role";

const UNSAVED_CHANGES_MESSAGE =
  "You have unsaved changes. Leave and discard them?";

export function RoleMetadataDialog({
  roleId,
  roleName,
  open,
  onOpenChange,
}: {
  roleId: string;
  roleName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isAdmin = roleName === "system_admin";
  const { data: role } = useQuery({
    ...roleQueryOptions(roleId),
    enabled: open,
  });

  const initial = role?.description ?? "";
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (open) {
      setValue(initial);
    }
  }, [open, initial]);

  const mutation = useUpdateRole();
  const dirty = value !== initial;

  function handleSave() {
    mutation.mutate(
      { roleId, description: value.trim() || null },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  function handleOpenChange(next: boolean) {
    if (!next && dirty && !window.confirm(UNSAVED_CHANGES_MESSAGE)) {
      return;
    }
    onOpenChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit role</SheetTitle>
          <SheetDescription>
            Role names are immutable; only the description can change.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4">
          <div className="space-y-2">
            <Label htmlFor="role-meta-name">Name</Label>
            <Input
              id="role-meta-name"
              value={roleName}
              readOnly
              className="bg-muted/40"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-meta-desc">Description</Label>
            <Textarea
              id="role-meta-desc"
              placeholder={
                isAdmin
                  ? "System administrator with full platform control."
                  : "What this role is for…"
              }
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={200}
              rows={3}
              disabled={isAdmin}
            />
            {isAdmin ? (
              <p className="text-xs text-muted-foreground">
                The system_admin role&rsquo;s description is fixed.
              </p>
            ) : null}
          </div>
          {mutation.isError ? (
            <p className="text-sm text-destructive">{mutation.error.message}</p>
          ) : null}
        </div>

        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isAdmin || !dirty || mutation.isPending}
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
