import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Backpack,
  Eye,
  LayoutDashboard,
  LogOut,
  Map,
  ShoppingCart,
  User as UserIcon,
} from "lucide-react";

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
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Switch } from "#/components/ui/switch";
import { useAuth } from "#/features/auth/api/use-auth";
import { useViewMode } from "#/features/auth/api/view-mode";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";

export function UserMenu() {
  const {
    principal,
    isLoading,
    isElevated,
    isSystemAdmin,
    emulatedRole,
    signOut,
  } = useAuth();
  const { setEmulatedRole } = useViewMode();
  const navigate = useNavigate();
  // Per-page kill switches for the personal menu items. Hooks run before
  // the early returns below to satisfy the rules of hooks.
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);
  const pages = flags.pages;

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

  const display = principal.primaryEmail;
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
          </>
        )}
        {/* Role emulation — sys admins get a full role select (any role
            on the site); non-admin officers get a Switch toggling to
            member-view; single-role members get nothing. UI-only — route
            guards still use the raw principal. */}
        {isElevated && principal.status === "approved" ? (
          <>
            <DropdownMenuSeparator />
            <EmulationRow>
              {isSystemAdmin ? (
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
                    <SelectItem value="__actual__">
                      Actual permissions
                    </SelectItem>
                    {Object.keys(principal.rolePermissionMap)
                      .filter((role) => role !== "system_admin")
                      .map((role) => (
                        <SelectItem key={role} value={role}>
                          View as {role.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : (
                <>
                  <Label
                    htmlFor="view-as-member-switch"
                    className="flex-1 text-xs font-normal"
                  >
                    View as member
                  </Label>
                  <Switch
                    id="view-as-member-switch"
                    size="sm"
                    checked={emulatedRole === "member"}
                    onCheckedChange={(on) =>
                      setEmulatedRole(on ? "member" : null)
                    }
                  />
                </>
              )}
            </EmulationRow>
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

function EmulationRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Eye className="size-4 shrink-0 text-muted-foreground" />
      {children}
    </div>
  );
}
