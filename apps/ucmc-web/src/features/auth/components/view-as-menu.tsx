/**
 * Role emulation ("View as") — the header control.
 *
 * This used to be a row inside the user menu paired with an amber banner
 * under the header. It sits in the header's icon row instead because the
 * preview is a *mode the whole app is in*, not an account setting: the
 * button is the indicator (it turns amber while a preview is active) and
 * the exit, in one always-visible affordance.
 *
 * Being in the header is what lets the banner go. Route guards honour the
 * preview, so a previewed role that can't reach the current page throws
 * `notFound()` — and `AppLayout` wraps the router's not-found component
 * too, so this button is still on screen there. Move it anywhere that
 * doesn't render on a 404 and the preview becomes a trap.
 *
 * The switch itself only ever *narrows*: `resolveEmulatedRole` validates
 * the role against the principal's own `rolePermissionMap` server-side,
 * and server actions always enforce the real principal.
 */
import { Eye } from "lucide-react";

import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { useAuth } from "#/features/auth/api/use-auth";
import { useViewMode } from "#/features/auth/api/view-mode";
import { cn } from "#/lib/utils";

/**
 * The radio value standing for "no preview". A `DropdownMenuRadioGroup`
 * needs a string for every option, and `null` isn't one.
 */
const ACTUAL = "__actual__";

export function ViewAsMenu() {
  const { principal, isElevated, emulatedRole } = useAuth();
  const { setEmulatedRole } = useViewMode();

  // `isElevated` is "system admin, or holds more than one role" — there
  // is nothing to switch between otherwise. Status is checked because a
  // pending/deactivated account's chrome is not a preview surface.
  if (!principal || !isElevated || principal.status !== "approved") {
    return null;
  }

  // Every role this viewer may preview: for a system admin that's every
  // role on the site, for anyone else it's the roles they actually hold.
  // `system_admin` is excluded because previewing it *is* the "Actual
  // permissions" state for the only people who can select it.
  const roles = Object.keys(principal.rolePermissionMap).filter(
    (role) => role !== "system_admin",
  );
  if (roles.length === 0) {
    return null;
  }

  const label = emulatedRole
    ? (principal.roleDisplayNames[emulatedRole] ?? emulatedRole)
    : null;
  // The amber fill is the indicator, so the accessible name has to carry
  // the same information in words — colour alone fails SC 1.4.1, and a
  // screen-reader user would otherwise hear an unchanged "View as role".
  const description = label ? `Viewing as ${label}` : "View as role";

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={description}
              className={cn(
                // Same amber as the banner this replaces, and
                // deliberately *not* theme-split the way that banner
                // was: it sat on the page background, which inverts with
                // the theme, whereas the header is `bg-primary` — a
                // mid-dark green — in both. One surface, one treatment.
                label &&
                  "bg-amber-100 text-amber-800 hover:bg-amber-200 hover:text-amber-900",
              )}
            >
              <Eye className="h-[1.2rem] w-[1.2rem]" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{description}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>View as</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={emulatedRole ?? ACTUAL}
          onValueChange={(value) => {
            setEmulatedRole(value === ACTUAL ? null : value);
          }}
        >
          <DropdownMenuRadioItem value={ACTUAL}>
            Actual permissions
          </DropdownMenuRadioItem>
          {roles.map((role) => (
            <DropdownMenuRadioItem key={role} value={role}>
              {principal.roleDisplayNames[role] ?? role}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
