import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";

import { Button } from "#/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Users className="size-5 text-muted-foreground" />
            Members of {roleName}
          </SheetTitle>
          <SheetDescription>
            {role ? `${role.memberCount} member(s) with this role.` : null}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4">
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

        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
