import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
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
import { GitHubIcon } from "#/components/brand-icons";
import { ModeToggle } from "#/components/mode-toggle";
import { SocialIconLinks } from "#/components/social-icon-links";
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
  useSidebar,
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
      <CloseSidebarOnNavigate />
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

/**
 * Closes the mobile sidebar Sheet whenever the pathname changes. On
 * mobile the sidebar renders as a slide-in Sheet; without this, a
 * tap on a nav Link would navigate underneath the open Sheet and
 * leave the user staring at the overlay until they tap outside.
 * On desktop `openMobile` is unused, so calling `setOpenMobile(false)`
 * after a desktop nav is a harmless no-op — no need to gate on
 * `isMobile`.
 */
function CloseSidebarOnNavigate() {
  const pathname = useLocation({ select: (l) => l.pathname });
  const { setOpenMobile } = useSidebar();
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);
  return null;
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
  const pages = flags.pages;
  // Nav gates compose: the viewer must hold the entry's permission AND the
  // page's kill switch must be on. `placeholderData` returns the schema
  // defaults until the query resolves, so a fresh-DB / pre-hydration
  // render matches the server. Route-less "coming soon" placeholders
  // (Blog, Volunteer, etc.) have only their flag as the gate.
  const canReadAnnouncements =
    hasPermission("announcements:read") && pages.announcements;
  const canVerifyWaivers =
    hasPermission("waivers:verify") && pages.members_waivers;
  // `pages.members` is the section switch, which is the right gate for
  // the sidebar entry — and because the flags map carries *effective*
  // values, switching the section off has already zeroed every
  // `members_*` child, so the sub-items and tabs vanish with it.
  const canReadMembers = isApproved && pages.members;
  const canReadGear = hasPermission("gear:read") && pages.gear;
  const canLoanGear = hasPermission("gear:loan") && pages.gear_loans;
  const canViewHistory = hasPermission("history:view") && pages.history;
  const canViewPolicies =
    hasPermission("public_policies:view") && pages.policies;
  const canViewScholarships =
    hasPermission("public_scholarships:view") && pages.scholarships;
  const canViewGearCave =
    hasPermission("public_gear_cave:view") && pages.gear_cave;
  const canViewResources =
    hasPermission("public_resources:view") && pages.resources;
  const canViewGazette = hasPermission("public_gazette:view") && pages.gazette;
  const canViewAlbum = hasPermission("public_album:view") && pages.album;

  // Waivers is the Members entry's only sub-item, so `canVerifyWaivers`
  // doubles as "does this entry get a collapsible chevron". Member
  // management is reached via the tab bar inside /members itself, and
  // Roles moved out to the root-level /access control, so neither needs
  // a sub-link here.

  return (
    <>
      <SidebarGroup>
        <SidebarMenu>
          {canViewGearCave ? (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="The Gear Cave">
                <Link to="/gear-cave">
                  <Boxes />
                  <span>The Gear Cave</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          {canViewScholarships ? (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Scholarships">
                <Link to="/scholarships">
                  <GraduationCap />
                  <span>Scholarships</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          {canViewPolicies ? (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Club policies">
                <Link to="/policies">
                  <Gavel />
                  <span>Policies</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          {canViewResources ? (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Resources">
                <Link to="/resources">
                  <ListChecks />
                  <span>Resources</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          {canViewAlbum ? (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Album">
                <Link to="/album">
                  <Images />
                  <span>Album</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          {pages.blog ? (
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
          ) : null}
          {canViewGazette ? (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Goosedown Gazette">
                <Link to="/gazette">
                  <Newspaper />
                  <span>Goosedown Gazette</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          {pages.volunteer ? (
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
          ) : null}
          {canViewHistory ? (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="History">
                <Link to="/history">
                  <Landmark />
                  <span>History</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </SidebarGroup>

      {canReadAnnouncements || isApproved ? (
        <SidebarGroup>
          <SidebarMenu>
            {pages.calendar ? (
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
            ) : null}

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
                {pages.forum ? (
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
                ) : null}
                {canReadMembers || canVerifyWaivers ? (
                  <SidebarMenuItem>
                    {/*
                     * Collapsible sits inside SidebarMenuItem (not the
                     * other way around) so the <ul> only has <li> direct
                     * children — axe-core's `list` rule rejects a <ul>
                     * with a <div> child, which is what Radix Collapsible
                     * renders as.
                     */}
                    <Collapsible defaultOpen className="group/collapsible">
                      {/* Main button navigates to /members. When the
                       * directory page itself is switched off but the
                       * Waivers sub-page is still enabled, the label stays
                       * as an inert group header so that sub-item remains
                       * reachable. */}
                      {canReadMembers ? (
                        <SidebarMenuButton asChild tooltip="Members">
                          <Link to="/members">
                            <Users />
                            <span>Members</span>
                          </Link>
                        </SidebarMenuButton>
                      ) : (
                        <SidebarMenuButton
                          tooltip="Members"
                          className="cursor-default"
                        >
                          <Users />
                          <span>Members</span>
                        </SidebarMenuButton>
                      )}

                      {/* Chevron toggles sub-items — separate from the link */}
                      {canVerifyWaivers ? (
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
                                  <Link to="/members/waivers">
                                    <ScrollText />
                                    <span>Waivers</span>
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
                {pages.trips ? (
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
                ) : null}
                {canReadGear || canLoanGear ? (
                  <SidebarMenuItem>
                    {/* Same Collapsible-inside-MenuItem pattern as the
                     * Members entry so the <ul> only contains <li>
                     * children (axe-core's list rule). Sub-item appears
                     * only when the user has `gear:loan`. Members reach
                     * their personal surfaces (My Gear, My Cart) from
                     * the user menu — kept off the sidebar so the
                     * sidebar stays officer-shaped. */}
                    <Collapsible
                      defaultOpen={canLoanGear}
                      className="group/collapsible"
                    >
                      {/* Inert group header when the inventory page itself
                       * is switched off but the Loans sub-page is still
                       * enabled. */}
                      {canReadGear ? (
                        <SidebarMenuButton asChild tooltip="Gear">
                          <Link to="/gear">
                            <Package />
                            <span>Gear</span>
                          </Link>
                        </SidebarMenuButton>
                      ) : (
                        <SidebarMenuButton
                          tooltip="Gear"
                          className="cursor-default"
                        >
                          <Package />
                          <span>Gear</span>
                        </SidebarMenuButton>
                      )}
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
                {pages.elections ? (
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
                ) : null}
                {pages.executive ? (
                  <SidebarMenuItem>
                    {/*
                     * Executive: workflow tools for the exec board
                     * (meeting agendas + minutes, quarterly goals,
                     * accountability tasks). Currently gated on
                     * `isApproved` like the other placeholder items;
                     * when these features ship, swap to a proper
                     * `executive:read`-style permission so non-officer
                     * members don't see the section.
                     *
                     * `pages.executive` covers the parent AND all seven
                     * sub-items, since none of them is independently
                     * reachable. Give the children their own flags when
                     * they become real routes.
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
                ) : null}
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
  // Page kill switches for entries in this group. `placeholderData` is the
  // schema default (on) until the query resolves.
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);
  const pages = flags.pages;
  // Sidebar entry is one link into the feedback surface; the tab layout
  // decides which surfaces to show inside. Render the link if the user can
  // submit to *either* surface AND that surface's page is enabled. Managers
  // also see it via their `*:manage` permission (system_admin auto-grants
  // both via the principal bypass). Point the link at whichever surface is
  // actually enabled so it never lands on a switched-off /feedback.
  const canWebsiteFeedback =
    (hasPermission("feedback:submit") || hasPermission("feedback:manage")) &&
    pages.feedback;
  const canClubFeedback =
    (hasPermission("club_feedback:submit") ||
      hasPermission("club_feedback:manage")) &&
    pages.feedback_club;
  const canSubmitFeedback =
    isApproved && (canWebsiteFeedback || canClubFeedback);
  const feedbackTarget = canWebsiteFeedback ? "/feedback" : "/feedback/club";
  const canViewAudit = hasPermission("audit:view");
  const canManageSettings = hasPermission("settings:manage");
  // The permission is still `roles:manage` — the page is named for the
  // umbrella concern (access), the permission for the object it edits.
  const canManageAccess = hasPermission("roles:manage") && pages.access;
  return (
    /*
     * `mt-auto` bottom-aligns this group: it soaks up whatever vertical
     * space the nav groups above leave over, so there's no dead gap
     * between the last nav item and Settings.
     *
     * Deliberately an auto margin rather than a sticky/fixed footer or a
     * `SidebarFooter` (which lives outside `SidebarContent`, and so
     * outside its scroll container). When the nav is tall enough to
     * overflow, the flex free space goes negative and the auto margin
     * resolves to 0 — this group scrolls away with everything else
     * instead of staying pinned. `justify-end` on the parent would do
     * the alignment too, but clips the first item on overflow; auto
     * margins don't.
     */
    <SidebarGroup className="mt-auto">
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
        {canManageAccess ? (
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Access">
              <Link to="/access">
                <Shield />
                <span>Access</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        {canSubmitFeedback ? (
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Feedback">
              <Link to={feedbackTarget}>
                <MessageSquare />
                <span>Feedback</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
        {pages.analytics ? (
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
        ) : null}
        {pages.reports ? (
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
        ) : null}
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
            {/* The three social URLs are `contact.*` site settings, not
                hardcoded, so the footer and the landing page's "Follow
                us" row always agree. GitHub and the mail icon stay
                inline: the repo URL is a maintainer-identifying
                constant, and the mail link is a mailto rather than a
                profile. */}
            <SocialIconLinks
              instagramUrl={contact.instagramUrl}
              facebookUrl={contact.facebookUrl}
              youtubeUrl={contact.youtubeUrl}
            />
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
