import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { useEffect, useState } from "react";

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
import { Checkbox } from "#/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import {
  getUserRolesFn,
  setUserRolesFn,
} from "#/features/members/server/rbac-fns";
import { listRolesFn } from "#/features/members/server/member-fns";

const ROLES_QUERY_KEY = ["members", "roles"] as const;

function userRolesKey(userId: string) {
  return ["rbac", "user-roles", userId] as const;
}

export function RoleAssignmentSheet({
  userId,
  email,
  preferredName,
  open,
  onOpenChange,
}: {
  userId: string;
  email: string;
  preferredName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sysAdminConfirm, setSysAdminConfirm] = useState<
    "add" | "remove" | null
  >(null);

  // Fetch all available roles.
  const { data: allRoles = [] } = useQuery({
    queryKey: ROLES_QUERY_KEY,
    queryFn: () => listRolesFn(),
    staleTime: 5 * 60 * 1000,
  });

  // Fetch this user's current roles.
  const { data: currentRoles = [], isLoading } = useQuery({
    queryKey: userRolesKey(userId),
    queryFn: () => getUserRolesFn({ data: { userId } }),
    enabled: open,
  });

  // Sync selected state when current roles load.
  useEffect(() => {
    if (currentRoles.length > 0) {
      setSelected(new Set(currentRoles.map((r) => r.roleId)));
    }
  }, [currentRoles]);

  const mutation = useMutation({
    mutationFn: (roleIds: string[]) =>
      setUserRolesFn({ data: { userId, roleIds } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["members", "directory"] }),
        queryClient.invalidateQueries({ queryKey: userRolesKey(userId) }),
      ]);
      onOpenChange(false);
    },
  });

  function handleToggle(roleId: string, checked: boolean) {
    // System admin toggle needs confirmation.
    if (roleId === "role_system_admin") {
      setSysAdminConfirm(checked ? "add" : "remove");
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(roleId);
      } else {
        next.delete(roleId);
      }
      return next;
    });
  }

  function confirmSysAdmin() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (sysAdminConfirm === "add") {
        next.add("role_system_admin");
      } else {
        next.delete("role_system_admin");
      }
      return next;
    });
    setSysAdminConfirm(null);
  }

  // Filter out anonymous (not assignable to users).
  const assignableRoles = allRoles.filter((r) => r.name !== "anonymous");

  const hasChanges =
    !isLoading &&
    (selected.size !== currentRoles.length ||
      currentRoles.some((r) => !selected.has(r.roleId)));

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent onKeyDown={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="size-5" />
              Manage roles
            </DialogTitle>
            <DialogDescription>{preferredName ?? email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              assignableRoles.map((role) => {
                const isMember = role.id === "role_member";
                const checked = isMember || selected.has(role.id);
                return (
                  <label
                    key={role.id}
                    className="flex items-start gap-3 rounded-md border px-3 py-2"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={isMember}
                      onCheckedChange={(c) => handleToggle(role.id, c === true)}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="text-sm font-medium capitalize">
                        {role.name.replace(/_/g, " ")}
                      </span>
                      {role.description ? (
                        <p className="text-xs text-muted-foreground">
                          {role.description}
                        </p>
                      ) : null}
                      {isMember ? (
                        <p className="text-xs text-muted-foreground">
                          Always assigned to approved members
                        </p>
                      ) : null}
                    </div>
                  </label>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate(Array.from(selected))}
              disabled={!hasChanges || mutation.isPending}
            >
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
          {mutation.isError ? (
            <p className="text-sm text-destructive">{mutation.error.message}</p>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* System admin confirmation */}
      <AlertDialog
        open={sysAdminConfirm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSysAdminConfirm(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {sysAdminConfirm === "add"
                ? "Grant system admin?"
                : "Revoke system admin?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {sysAdminConfirm === "add"
                ? `This will give ${preferredName ?? email} full platform control, including the ability to manage all roles and permissions.`
                : `This will remove full platform control from ${preferredName ?? email}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSysAdmin}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
