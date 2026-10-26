import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Backpack,
  LayoutDashboard,
  LogOut,
  Map,
  MessageSquare,
  MessageSquarePlus,
  ShoppingCart,
  User as UserIcon,
} from "lucide-react";

import { useFeedbackLauncher } from "#/components/feedback/feedback-launcher";
import { Avatar, AvatarFallback } from "#/components/ui/avatar";
import { UserAvatar } from "#/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useAuth } from "#/features/auth/api/use-auth";
import { MY_FEEDBACK_PERMISSIONS } from "#/features/auth/guards";
import {
  returnPathSearch,
  signInReturnPath,
} from "#/features/auth/lib/post-sign-in";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";

export function UserMenu() {
  const { principal, isLoading, emulatedRole, signOut, hasAnyPermission } =
    useAuth();
  const navigate = useNavigate();
  // Signing in from a public page lands back on it. Path + search only,
  // like the guards, so the SSR and hydrated hrefs agree.
  const returnPath = useLocation({
    select: (location) =>
      signInReturnPath(location.pathname, location.searchStr),
  });
  // Per-page kill switches for the personal menu items. Hooks run before
  // the early returns below to satisfy the rules of hooks.
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);
  const pages = flags.pages;
  const launcher = useFeedbackLauncher();

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
        search={returnPathSearch(returnPath)}
        aria-label="Sign in"
        className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar>
          <AvatarFallback>?</AvatarFallback>
        </Avatar>
      </Link>
    );
  }

  // The name the member chose, not their email: the menu is the one
  // place the account is addressed rather than identified, and the
  // email is on /my/details. Falls back to the email before the
  // profile exists, when it's the only identifier there is.
  const display = principal.preferredName ?? principal.primaryEmail;
  const statusLabel =
    principal.status === "approved"
      ? emulatedRole
        ? `viewing as ${principal.roleDisplayNames[emulatedRole] ?? emulatedRole}`
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
            {pages.my_profile ? (
              <DropdownMenuItem asChild>
                <Link to="/my/profile">
                  <UserIcon className="mr-2 size-4" />
                  My Account
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem disabled>
              <LayoutDashboard className="mr-2 size-4" />
              My Dashboard
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <Map className="mr-2 size-4" />
              My Trips
            </DropdownMenuItem>
            {pages.my_gear ? (
              <DropdownMenuItem asChild>
                <Link to="/my/gear">
                  <Backpack className="mr-2 size-4" />
                  My Gear
                </Link>
              </DropdownMenuItem>
            ) : null}
            {pages.my_gear_cart ? (
              <DropdownMenuItem asChild>
                <Link to="/my/gear/cart">
                  <ShoppingCart className="mr-2 size-4" />
                  My Cart
                </Link>
              </DropdownMenuItem>
            ) : null}
            {pages.my_feedback && hasAnyPermission(MY_FEEDBACK_PERMISSIONS) ? (
              <DropdownMenuItem asChild>
                <Link to="/my/feedback">
                  <MessageSquare className="mr-2 size-4" />
                  My Feedback
                </Link>
              </DropdownMenuItem>
            ) : null}
            {/* Its own section: an action, not a page of the member's.
                The launcher records the page first, so the menu closes
                before any screenshot. */}
            {launcher.canSend ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => launcher.open()}>
                  <MessageSquarePlus className="mr-2 size-4" />
                  Send Feedback
                </DropdownMenuItem>
              </>
            ) : null}
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
