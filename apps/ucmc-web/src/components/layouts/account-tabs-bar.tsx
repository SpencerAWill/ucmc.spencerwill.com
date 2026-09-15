/**
 * Tab bar rendered by the `/my/_tabs` pathless layout. Each tab is a real
 * sibling route, so browser back/forward, bookmarks, right-click, and
 * copy-link all keep working — it's a `<nav>` of `<Link>`s, not a tablist
 * of buttons, with `aria-current` conveying the selection.
 *
 * It lives here rather than inline in the route file so the active-tab
 * logic is unit-testable: `createFileRoute` can't be rendered without a
 * router, and the selected tab is exactly the part worth pinning.
 *
 * Per-tab visibility is the `pages.*` kill switch, matching every other
 * nav surface; each leaf route also 404s independently via its own
 * `staticData.pageFlag`.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";

import { cn } from "#/lib/utils";
import { publicFlagsQueryOptions } from "#/features/settings/api/queries";
import type { PageFlagKey } from "#/server/settings/settings-registry";

export const ACCOUNT_TABS = [
  { to: "/my/profile", label: "Profile", flag: "my_profile" },
  { to: "/my/details", label: "Details", flag: "my_details" },
  { to: "/my/contacts", label: "Contacts", flag: "my_contacts" },
  { to: "/my/waiver", label: "Waiver", flag: "my_waiver" },
  { to: "/my/security", label: "Security", flag: "my_security" },
  { to: "/my/preferences", label: "Preferences", flag: "my_preferences" },
] as const satisfies ReadonlyArray<{
  to: string;
  label: string;
  flag: PageFlagKey;
}>;

export type AccountTabPath = (typeof ACCOUNT_TABS)[number]["to"];

/**
 * The tab whose page is showing. Longest match wins so a future
 * `/my/profile/edit` still lights up Profile, and bare `/my` resolves to
 * Profile because `/my/` redirects there.
 */
export function activeAccountTabFromPath(
  pathname: string,
): AccountTabPath | undefined {
  const matches = ACCOUNT_TABS.filter(
    (tab) => pathname === tab.to || pathname.startsWith(`${tab.to}/`),
  );

  return matches.length > 0
    ? matches.reduce((longest, tab) =>
        tab.to.length > longest.to.length ? tab : longest,
      ).to
    : undefined;
}

export function AccountTabsBar() {
  const pathname = useLocation({ select: (l) => l.pathname });
  // Per-page kill switches: hide any tab whose page has been switched off
  // from /settings. `placeholderData` holds the schema defaults until the
  // query resolves, so the pre-hydration render matches the server's.
  const flagsOptions = publicFlagsQueryOptions();
  const { data: flags = flagsOptions.placeholderData } = useQuery(flagsOptions);
  const pages = flags.pages;
  const visibleTabs = ACCOUNT_TABS.filter((tab) => pages[tab.flag]);

  const active = activeAccountTabFromPath(pathname);

  return (
    /*
     * The row is allowed to overflow horizontally on narrow viewports
     * rather than wrapping — six labels at body-text size line-wrap on a
     * phone, which looked broken. `border-b` lives on the container so the
     * underline runs the full visual width even after the row scrolls.
     * Per-link `whitespace-nowrap` keeps individual labels intact.
     */
    <div className="-mx-6 mb-6 border-b border-border">
      <nav
        aria-label="Account sections"
        className="flex gap-1 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {visibleTabs.map((tab) => {
          const isActive = tab.to === active;

          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={isActive ? "page" : undefined}
              /*
               * Active state is computed from the pathname and resolved
               * through `cn()` rather than handed to `activeProps`: the
               * router concatenates activeProps' className onto the base
               * one, which leaves conflicting Tailwind utilities
               * (`border-transparent` vs `border-primary`) to fight it out
               * on stylesheet order. `twMerge` settles them here instead.
               *
               * The spotlight is three signals, not one, because a 2px
               * underline alone is easy to miss on a scrolled-off row:
               * a tinted panel behind the label, a primary underline, and
               * a weight/contrast bump. `-mb-px` pulls the underline over
               * the container's border so the two read as one line.
               */
              className={cn(
                "-mb-px shrink-0 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors",
                "hover:bg-muted/50 hover:text-foreground",
                "focus-visible:ring-ring/50 outline-none focus-visible:ring-2",
                isActive &&
                  "border-primary bg-muted/70 text-foreground font-semibold hover:bg-muted/70",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
