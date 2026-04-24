import { Link, useNavigate } from "@tanstack/react-router";
import { KeyRound, LogOut, User as UserIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "#/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useAuth } from "#/lib/auth/use-auth";

function initialsFor(value: string): string {
  const parts = value.split(/\s+|@/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase()
  );
}

export function UserMenu() {
  const { principal, isLoading, signOut } = useAuth();
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
      ? (principal.roles[0] ?? "member")
      : principal.status;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar>
            <AvatarFallback>{initialsFor(display)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm">{display}</span>
          <span className="text-xs capitalize text-muted-foreground">
            {statusLabel.replace("_", " ")}
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
