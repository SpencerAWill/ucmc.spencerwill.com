import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit role</DialogTitle>
          <DialogDescription>
            Role names are immutable; only the description can change.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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

        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
