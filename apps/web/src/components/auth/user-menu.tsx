import { Link, useNavigate } from "@tanstack/react-router";
import { Eye, KeyRound, LogOut, User as UserIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "#/components/ui/avatar";
import { UserAvatar } from "#/components/auth/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { useAuth } from "#/lib/auth/use-auth";
import { useViewMode } from "#/lib/auth/view-mode";

export function UserMenu() {
  const { principal, isLoading, isElevated, emulatedRole, signOut } = useAuth();
  const { setEmulatedRole } = useViewMode();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Avatar>
        <AvatarFallback>…</AvatarFallback>
      </Avatar>
    );
  }

  if (!principal) {
    return (
      <Link
        to="/sign-in"
        aria-label="Sign in"
        className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar>
          <AvatarFallback>?</AvatarFallback>
        </Avatar>
      </Link>
    );
  }

  const display = principal.email;
  const statusLabel =
    principal.status === "approved"
      ? emulatedRole
        ? `viewing as ${emulatedRole.replace(/_/g, " ")}`
        : (principal.roles[0] ?? "member")
      : principal.status;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <UserAvatar avatarKey={principal.avatarKey} name={display} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm">{display}</span>
          <span className="text-xs capitalize text-muted-foreground">
            {statusLabel.replace(/_/g, " ")}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!principal.hasProfile ? (
          <DropdownMenuItem asChild>
            <Link to="/register/profile">
              <UserIcon className="mr-2 size-4" />
              Finish registering
            </Link>
          </DropdownMenuItem>
        ) : principal.status !== "approved" ? (
          <DropdownMenuItem asChild>
            <Link to="/register/pending">
              <UserIcon className="mr-2 size-4" />
              Pending approval
            </Link>
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem asChild>
              <Link to="/account">
                <UserIcon className="mr-2 size-4" />
                Account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account/security">
                <KeyRound className="mr-2 size-4" />
                Security
              </Link>
            </DropdownMenuItem>
          </>
        )}
        {/* Role emulation dropdown — only for users with multiple roles */}
        {isElevated && principal.status === "approved" ? (
          <>
            <DropdownMenuSeparator />
            <div
              className="flex items-center gap-2 px-2 py-1.5"
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Eye className="size-4 shrink-0 text-muted-foreground" />
              <Select
                value={emulatedRole ?? "__actual__"}
                onValueChange={(value) => {
                  setEmulatedRole(value === "__actual__" ? null : value);
                }}
              >
                <SelectTrigger className="h-7 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__actual__">Actual permissions</SelectItem>
                  {principal.roles.map((role) => (
                    <SelectItem key={role} value={role}>
                      View as {role.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async (e) => {
            e.preventDefault();
            await signOut();
            await navigate({ to: "/" });
          }}
        >
          <LogOut className="mr-2 size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
