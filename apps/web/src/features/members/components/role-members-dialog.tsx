import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { roleQueryOptions } from "#/features/members/api/queries";

export function RoleMembersDialog({
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
  const { data: role, isLoading } = useQuery({
    ...roleQueryOptions(roleId),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-5 text-muted-foreground" />
            Members of {roleName}
          </DialogTitle>
          <DialogDescription>
            {role ? `${role.memberCount} member(s) with this role.` : null}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading || !role ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : role.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No members have this role.
            </p>
          ) : (
            <ul className="space-y-2">
              {role.members.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="font-medium">
                    {m.preferredName ?? m.email}
                  </span>
                  <span className="text-muted-foreground">{m.email}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
