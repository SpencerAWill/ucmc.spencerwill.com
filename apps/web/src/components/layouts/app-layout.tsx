import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Eye, Shield, UserPlus, Users } from "lucide-react";

import { AnnouncementsBell } from "#/features/announcements/components/announcements-bell";
import { UserMenu } from "#/components/auth/user-menu";
import { ModeToggle } from "#/components/mode-toggle";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "#/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { useAuth } from "#/lib/auth/use-auth";

const HEADER_HEIGHT = "3.5rem";

function SidebarTriggerWithTooltip() {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarTrigger className="size-9" />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-2">
        <span>Toggle sidebar</span>
        <kbd className="rounded border border-background/20 bg-background/10 px-1.5 py-0.5 font-sans text-[10px] font-medium">
          {isMac ? "⌘" : "Ctrl"} B
        </kbd>
      </TooltipContent>
    </Tooltip>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider
      className="flex-col"
      style={{ "--header-height": HEADER_HEIGHT } as CSSProperties}
    >
      <header className="sticky top-0 z-30 flex h-(--header-height) w-full items-center border-b bg-primary/95 px-4 text-primary-foreground backdrop-blur-lg">
        <nav className="flex w-full flex-nowrap items-center gap-x-3">
          <div className="flex-1">
            <SidebarTriggerWithTooltip />
          </div>
          <div className="flex flex-1 flex-nowrap justify-center">
            <Link to="/" className="text-center">
              <img src="/logo192.png" alt="Logo" className="h-8 w-auto" />
            </Link>
          </div>
          <div className="flex flex-1 flex-nowrap flex-row-reverse gap-x-2">
            <UserMenu />
            <AnnouncementsBell />
            <ModeToggle />
          </div>
        </nav>
      </header>
      <EmulationBanner />
      <div className="flex flex-1">
        <Sidebar
          variant="sidebar"
          collapsible="icon"
          className="top-(--header-height) h-[calc(100svh-var(--header-height))]"
        >
          <SidebarHeader />
          <SidebarContent>
            <SidebarNav />
          </SidebarContent>
          <SidebarFooter />
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          {children}
          <AppFooter />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

function EmulationBanner() {
  const { emulatedRole } = useAuth();
  if (!emulatedRole) {
    return null;
  }
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      <Eye className="size-3.5" />
      Viewing as {emulatedRole.replace(/_/g, " ")}
    </div>
  );
}

function SidebarNav() {
  const { isApproved, hasPermission } = useAuth();
  const canApproveRegistrations = hasPermission("registrations:approve");
  const canManageRoles = hasPermission("roles:manage");

  if (!isApproved) {
    return null;
  }

  // Sub-items gated by permission. If none are visible, the Members
  // link still renders but without the collapsible chevron.
  const hasSubItems = canApproveRegistrations || canManageRoles;

  return (
    <SidebarGroup>
      <SidebarMenu>
        <Collapsible defaultOpen className="group/collapsible">
          <SidebarMenuItem>
            {/* Main button navigates to /members */}
            <SidebarMenuButton asChild tooltip="Members">
              <Link to="/members">
                <Users />
                <span>Members</span>
              </Link>
            </SidebarMenuButton>

            {/* Chevron toggles sub-items — separate from the link */}
            {hasSubItems ? (
              <CollapsibleTrigger asChild>
                <SidebarMenuAction className="data-[state=open]:rotate-90">
                  <ChevronRight />
                  <span className="sr-only">Toggle sub-menu</span>
                </SidebarMenuAction>
              </CollapsibleTrigger>
            ) : null}

            {hasSubItems ? (
              <CollapsibleContent>
                <SidebarMenuSub>
                  {canApproveRegistrations ? (
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton asChild>
                        <Link to="/members/registrations">
                          <UserPlus />
                          <span>Registrations</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ) : null}
                  {canManageRoles ? (
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton asChild>
                        <Link to="/members/roles">
                          <Shield />
                          <span>Roles</span>
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ) : null}
                </SidebarMenuSub>
              </CollapsibleContent>
            ) : null}
          </SidebarMenuItem>
        </Collapsible>
      </SidebarMenu>
    </SidebarGroup>
  );
}

function AppFooter() {
  return (
    <footer className="mt-auto border-t px-4 py-3 text-xs text-muted-foreground">
      <div className="flex items-center justify-between gap-4">
        <span>University of Cincinnati Mountaineering Club</span>
        <Link to="/health" className="hover:text-foreground">
          Status
        </Link>
      </div>
    </footer>
  );
}
