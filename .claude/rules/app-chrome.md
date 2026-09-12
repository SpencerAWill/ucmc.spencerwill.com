---
paths:
  - "apps/ucmc-web/src/components/layouts/**"
  - "apps/ucmc-web/src/components/ui/sidebar.tsx"
---

# App shell, sidebar, and header

## Sidebar (`app-layout.tsx`)

`SidebarContent` holds the nav groups (`SidebarNav`) followed by the bottom utility group (`SidebarUtilityNav` — Settings, Access, Feedback, Analytics\*, Reports\*, Audit; \* are route-less "coming soon" entries).

**The utility group carries `mt-auto` so it bottom-aligns and no dead gap opens under a short nav. That auto margin is deliberate and load-bearing: do not "fix" it into a `SidebarFooter` or anything `sticky`.** `SidebarFooter` renders outside `SidebarContent` (which owns `overflow-auto`), so it would pin the group to the viewport; with `mt-auto`, once the nav is tall enough to overflow, the flex free space goes negative, the margin resolves to 0, and the group scrolls away with the rest. `justify-end` on the parent would bottom-align too, but clips the first item on overflow — auto margins don't.

Nav gates compose **permission AND page flag**, and the flag must be the one belonging to the page the link actually targets. `placeholderData` returns the schema defaults until the flags query resolves, so a fresh-DB / pre-hydration render matches the server.

**Wire the sidebar in the same change as any new public route.** A route that exists but has no nav entry is invisible; this has been caught repeatedly in review.

## Header masthead (`header-masthead.tsx`)

The header's middle column is the logo badge with configurable text either side of it — title left, tagline right — and **the whole thing is one `<Link to="/">`**, so any part of the visible wordmark goes home.

**The mark is the only in-flow child**, centred by its container; both text halves are absolutely positioned off the mark's wrapper (`right-full` / `left-full`) so they can't move it. **That indirection is the whole point** — anything that puts the strings in flow beside the mark shifts it by their difference in width. Content-sizing the link centres the _group_, which pushed the mark ~39px right at 1280 because the title is wider than the tagline; equal-width flex or grid tracks centre it correctly but bill the cost to the title, which truncated to "UC Mountain…" at 800px while the tagline's half sat empty. Out of flow, the title borrows the empty space in the left third instead.

`max-w-*` caps bound each string short of the sidebar trigger and the icon buttons. **`header-masthead.test.tsx` pins the in-flow/out-of-flow split**, since a refactor that puts either string back in flow re-centres the mark silently.

Both text halves are hidden at narrow widths (title at `md`, tagline at `lg`) because the column is one third of a header that also holds the sidebar trigger and three icon buttons — the logo alone carries the header on a phone. The badge's own lettering is illegible at 32px, which is why a title beside it isn't redundant. An explicit `aria-label` leads with the visible title so the accessible name contains it (WCAG 2.5.3, Label in Name); it's load-bearing rather than decorative, because at narrow widths the title is `display: none` and the only remaining child is an `alt=""` image, leaving the link otherwise unnamed.

The two strings are the **`appearance.headerTitle` / `appearance.headerTagline`** site settings. Blank means "show nothing" (the same convention the social URLs use), and both are length-capped because this is fixed-height chrome on every page: a long value truncates rather than wrapping, so rejecting it is the better outcome. The tagline expands **`CURRENT_YEAR_TOKEN`** (`{year}`) at render time, so a default of `Est. 1971–{year}` keeps its own end date current with no annual edit. **Expansion happens in the component, not the server payload**, so a cached response can't serve last year's number, and the year is read in `CLUB_TIME_ZONE` — which here also prevents a hydration mismatch, since the worker would otherwise resolve it in UTC and the browser in its own zone.

They reach the client through `getPublicBrandingFn` / `publicBrandingQueryOptions`. `placeholderData` is the schema default so the real title renders pre-hydration instead of jumping the layout on every cold load.

## Header icon row

`flex-row-reverse`, so source order is avatar → view-as → bell → theme (rendering right-to-left). `ViewAsMenu` is here rather than in the user menu specifically because the header renders on 404s — see the auth/RBAC rule.

## Tab bars

Shared tab bars live in `src/components/layouts/` (e.g. `FeedbackTabsBar`) when two features would otherwise have to cross-import each other. Surface switchers between two URLs are **real `<Link>`s, not a tablist of buttons** — two URLs must keep right-click / middle-click / copy-link, with `aria-current` conveying the selection.
