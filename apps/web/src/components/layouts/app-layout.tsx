import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  Eye,
  Mail,
  ScrollText,
  Shield,
  UserPlus,
  Users,
} from "lucide-react";

import { AnnouncementsBell } from "#/features/announcements/components/announcements-bell";
import { UserMenu } from "#/features/auth/components/user-menu";
import {
  FacebookIcon,
  GitHubIcon,
  InstagramIcon,
  YouTubeIcon,
} from "#/components/brand-icons";
import { ModeToggle } from "#/components/mode-toggle";
import {
  REGISTRATION_DISCLAIMER,
  SUBBRAND_DISAMBIGUATION,
} from "#/config/legal";
import { GITHUB_REPO_URL } from "#/config/site";
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
import { useAuth } from "#/features/auth/api/use-auth";

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
  const canVerifyWaivers = hasPermission("waivers:verify");

  if (!isApproved) {
    return null;
  }

  // Sub-items gated by permission. If none are visible, the Members
  // link still renders but without the collapsible chevron.
  const hasSubItems =
    canApproveRegistrations || canManageRoles || canVerifyWaivers;

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
                  {canVerifyWaivers ? (
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton asChild>
                        <Link to="/members/waivers">
                          <ScrollText />
                          <span>Waivers</span>
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
    <footer className="mt-auto border-t px-4 py-6 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <p className="font-medium text-foreground">
            University of Cincinnati Mountaineering Club
          </p>
          <div className="flex items-center gap-3">
            <a
              href="https://instagram.com/uc_mountaineering"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center transition-opacity hover:opacity-80"
              aria-label="UCMC on Instagram"
            >
              <InstagramIcon className="size-5" />
            </a>
            <a
              href="https://www.facebook.com/groups/19204046466/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center transition-opacity hover:opacity-80"
              aria-label="UCMC on Facebook"
            >
              <FacebookIcon className="size-5" />
            </a>
            <a
              href="https://www.youtube.com/channel/UC1zpNSpQI784F-zOtVHjUMQ"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center transition-opacity hover:opacity-80"
              aria-label="UCMC on YouTube"
            >
              <YouTubeIcon className="size-5" />
            </a>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center text-foreground transition-opacity hover:opacity-80"
              aria-label="View this site's source on GitHub"
            >
              <GitHubIcon className="size-5" />
            </a>
            <a
              href="mailto:ucmountaineering@gmail.com"
              className="hover:text-foreground"
              aria-label="Email UCMC"
            >
              <Mail className="size-4" />
            </a>
          </div>
        </div>

        {/*
         * Registration disclaimer (Rule 40-03-01) + sub-brand
         * disambiguation. Required on every page that uses the UC name;
         * font is forced to Arial via inline `style` to satisfy the
         * rule's typeface requirement and survive Tailwind class purging.
         */}
        <p
          className="leading-relaxed"
          style={{ fontFamily: 'Arial, "Helvetica Neue", sans-serif' }}
        >
          {REGISTRATION_DISCLAIMER} {SUBBRAND_DISAMBIGUATION}
        </p>

        <p>
          Climbing and mountaineering carry inherent risk. Members participate
          at their own risk and are responsible for their own safety on trips.
        </p>

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
            <Link
              to="/disclaimer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Disclaimer
            </Link>
            <Link
              to="/nondiscrimination"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Non-discrimination
            </Link>
            <Link
              to="/anti-hazing"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Anti-hazing
            </Link>
            <Link
              to="/waiver"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Waiver
            </Link>
            <Link
              to="/open-source"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Open source
            </Link>
          </nav>
          <Link
            to="/health"
            className="self-start underline underline-offset-2 hover:text-foreground md:self-auto"
          >
            Status
          </Link>
        </div>
      </div>
    </footer>
  );
}
