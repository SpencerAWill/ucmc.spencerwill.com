import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  Boxes,
  Briefcase,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  Compass,
  Crown,
  Eye,
  FileText,
  Gavel,
  GraduationCap,
  HandHeart,
  Handshake,
  History,
  Images,
  Landmark,
  ListChecks,
  Mail,
  Wallet,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Newspaper,
  Package,
  Rss,
  ScrollText,
  Settings,
  Shield,
  Target,
  Users,
  Vote,
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
  publicFlagsQueryOptions,
  publicSiteContactQueryOptions,
} from "#/features/settings/api/queries";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
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
      {/*
       * Skip link — visually hidden until it receives focus, at which
       * point it slides into the top-left of the viewport. First
       * focusable element on every page so keyboard users can jump
       * past the header + sidebar without tabbing through every nav
       * item. WCAG 2.1 AA, SC 2.4.1 (Bypass Blocks).
       */}
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-2 focus-visible:top-2 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-background focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-foreground focus-visible:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-30 flex h-(--header-height) w-full items-center border-b bg-primary/95 px-4 text-primary-foreground backdrop-blur-lg">
        <nav
          aria-label="Primary"
          className="flex w-full flex-nowrap items-center gap-x-3"
        >
          <div className="flex-1">
            <SidebarTriggerWithTooltip />
          </div>
          <div className="flex flex-1 flex-nowrap justify-center">
            <Link to="/" className="text-center" aria-label="UCMC home">
              <img src="/logo192.png" alt="" className="h-8 w-auto" />
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
          <SidebarContent>
            <SidebarNav />
            <SidebarUtilityNav />
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          {/*
           * `tabIndex={-1}` makes the landmark programmatically
           * focusable so the skip-link target receives focus on
           * activation; without it, browsers vary on whether they
           * move focus or only scroll position.
           */}
          <main id="main" tabIndex={-1} className="outline-none">
            {children}
          </main>
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
  // Announcements gates compose: must have the permission AND the kill
  // switch must be on. `placeholderData` returns the schema default
  // (off) until the query resolves, so a fresh-DB / pre-hydration render
  // keeps the entry hidden.
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);
  const canReadAnnouncements =
    hasPermission("announcements:read") && flags.announcements;
  const canManageRoles = hasPermission("roles:manage");
  const canVerifyWaivers = hasPermission("waivers:verify");
  const canReadGear = hasPermission("gear:read");
  const canLoanGear = hasPermission("gear:loan");

  // Sub-items gated by permission. If none are visible, the Members
  // link still renders but without the collapsible chevron.
  // (Member management is reached via the tab bar inside /members
  // itself for officers, so it doesn't need its own sub-link.)
  const hasSubItems = canManageRoles || canVerifyWaivers;

  return (
    <>
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              aria-disabled
              tabIndex={-1}
              tooltip="The Gear Cave (coming soon)"
            >
              <Boxes />
              <span>The Gear Cave</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Scholarships">
              <Link to="/scholarships">
                <GraduationCap />
                <span>Scholarships</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Club policies">
              <Link to="/policies">
                <Gavel />
                <span>Policies</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              aria-disabled
              tabIndex={-1}
              tooltip="Trip Gallery (coming soon)"
            >
              <Images />
              <span>Trip Gallery</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              aria-disabled
              tabIndex={-1}
              tooltip="Blog (coming soon)"
            >
              <Rss />
              <span>Blog</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              aria-disabled
              tabIndex={-1}
              tooltip="Goosedown Gazette (coming soon)"
            >
              <Newspaper />
              <span>Goosedown Gazette</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              aria-disabled
              tabIndex={-1}
              tooltip="Volunteer (coming soon)"
            >
              <HandHeart />
              <span>Volunteer</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="History">
              <Link to="/history">
                <Landmark />
                <span>History</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      {canReadAnnouncements || isApproved ? (
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                aria-disabled
                tabIndex={-1}
                tooltip="Calendar (coming soon)"
              >
                <CalendarDays />
                <span>Calendar</span>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {canReadAnnouncements ? (
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Announcements">
                  <Link to="/announcements">
                    <Megaphone />
                    <span>Announcements</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}

            {isApproved ? (
              <>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    aria-disabled
                    tabIndex={-1}
                    tooltip="Forum (coming soon)"
                  >
                    <MessagesSquare />
                    <span>Forum</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  {/*
                   * Collapsible sits inside SidebarMenuItem (not the
                   * other way around) so the <ul> only has <li> direct
                   * children — axe-core's `list` rule rejects a <ul>
                   * with a <div> child, which is what Radix Collapsible
                   * renders as.
                   */}
                  <Collapsible defaultOpen className="group/collapsible">
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
                  </Collapsible>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    aria-disabled
                    tabIndex={-1}
                    tooltip="Trips (coming soon)"
                  >
                    <Compass />
                    <span>Trips</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {canReadGear ? (
                  <SidebarMenuItem>
                    {/* Same Collapsible-inside-MenuItem pattern as the
                     * Members entry so the <ul> only contains <li>
                     * children (axe-core's list rule). Sub-item appears
                     * only when the user has `gear:loan`. */}
                    <Collapsible
                      defaultOpen={canLoanGear}
                      className="group/collapsible"
                    >
                      <SidebarMenuButton asChild tooltip="Gear">
                        <Link to="/gear">
                          <Package />
                          <span>Gear</span>
                        </Link>
                      </SidebarMenuButton>
                      {canLoanGear ? (
                        <>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuAction className="data-[state=open]:rotate-90">
                              <ChevronRight />
                              <span className="sr-only">Toggle sub-menu</span>
                            </SidebarMenuAction>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              <SidebarMenuSubItem>
                                <SidebarMenuSubButton asChild>
                                  <Link to="/gear/loans">
                                    <Handshake />
                                    <span>Loans</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </>
                      ) : null}
                    </Collapsible>
                  </SidebarMenuItem>
                ) : null}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    aria-disabled
                    tabIndex={-1}
                    tooltip="Elections (coming soon)"
                  >
                    <Vote />
                    <span>Elections</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  {/*
                   * Executive: workflow tools for the exec board
                   * (meeting agendas + minutes, quarterly goals,
                   * accountability tasks). Currently gated on
                   * `isApproved` like the other placeholder items;
                   * when these features ship, swap to a proper
                   * `executive:read`-style permission so non-officer
                   * members don't see the section.
                   */}
                  <Collapsible className="group/collapsible">
                    <SidebarMenuButton
                      aria-disabled
                      tabIndex={-1}
                      tooltip="Executive (coming soon)"
                    >
                      <Briefcase />
                      <span>Executive</span>
                    </SidebarMenuButton>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuAction className="data-[state=open]:rotate-90">
                        <ChevronRight />
                        <span className="sr-only">Toggle sub-menu</span>
                      </SidebarMenuAction>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton aria-disabled tabIndex={-1}>
                            <Crown />
                            <span>Board</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton aria-disabled tabIndex={-1}>
                            <CalendarClock />
                            <span>Meetings</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton aria-disabled tabIndex={-1}>
                            <Gavel />
                            <span>Decisions</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton aria-disabled tabIndex={-1}>
                            <Target />
                            <span>Goals</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton aria-disabled tabIndex={-1}>
                            <ListChecks />
                            <span>Tasks</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton aria-disabled tabIndex={-1}>
                            <Wallet />
                            <span>Budget</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton aria-disabled tabIndex={-1}>
                            <Handshake />
                            <span>Handoff</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </Collapsible>
                </SidebarMenuItem>
              </>
            ) : null}
          </SidebarMenu>
        </SidebarGroup>
      ) : null}
    </>
  );
}

function SidebarUtilityNav() {
  const { isApproved, hasPermission } = useAuth();
  // Sidebar entry is one link to `/feedback`; the tab layout decides
  // which surfaces to show inside. So we render the link if the user
  // can submit to *either* surface. Managers also see it via their
  // `*:manage` permission (system_admin auto-grants both via the
  // principal bypass).
  const canSubmitFeedback =
    isApproved &&
    (hasPermission("feedback:submit") ||
      hasPermission("club_feedback:submit") ||
      hasPermission("feedback:manage") ||
      hasPermission("club_feedback:manage"));
  const canViewAudit = hasPermission("audit:view");
  const canManageSettings = hasPermission("settings:manage");
  return (
    <SidebarGroup>
      <SidebarMenu>
        {canManageSettings ? (
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Settings">
              <Link to="/settings">
                <Settings />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        {canSubmitFeedback ? (
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Feedback">
              <Link to="/feedback">
                <MessageSquare />
                <span>Feedback</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        <SidebarMenuItem>
          <SidebarMenuButton
            aria-disabled
            tabIndex={-1}
            tooltip="Analytics (coming soon)"
          >
            <BarChart3 />
            <span>Analytics</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            aria-disabled
            tabIndex={-1}
            tooltip="Reports (coming soon)"
          >
            <FileText />
            <span>Reports</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {canViewAudit ? (
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Audit">
              <Link to="/audit">
                <History />
                <span>Audit</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function AppFooter() {
  const options = publicSiteContactQueryOptions();
  const { data: contact = options.placeholderData } = useQuery(options);
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
              rel="noopener noreferrer"
              className="inline-flex items-center transition-opacity hover:opacity-80"
              aria-label="UCMC on Instagram"
            >
              <InstagramIcon className="size-5" />
            </a>
            <a
              href="https://www.facebook.com/groups/19204046466/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center transition-opacity hover:opacity-80"
              aria-label="UCMC on Facebook"
            >
              <FacebookIcon className="size-5" />
            </a>
            <a
              href="https://www.youtube.com/channel/UC1zpNSpQI784F-zOtVHjUMQ"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center transition-opacity hover:opacity-80"
              aria-label="UCMC on YouTube"
            >
              <YouTubeIcon className="size-5" />
            </a>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-foreground transition-opacity hover:opacity-80"
              aria-label="View this site's source on GitHub"
            >
              <GitHubIcon className="size-5" />
            </a>
            <a
              href={`mailto:${contact.clubEmail}`}
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
              to="/about"
              className="underline underline-offset-2 hover:text-foreground"
            >
              About
            </Link>
            <Link
              to="/membership"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Membership
            </Link>
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
              to="/privacy"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Privacy
            </Link>
            <Link
              to="/terms"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Terms
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
