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

## Page containers (`page-container.tsx`)

`<main>` in `app-layout.tsx` carries **no padding on purpose** — the
landing page and every `PageHero` are full-bleed bands and a container on
the shell would box them in. Page content therefore opens its own
container, and **that container is `PageContainer`, not hand-rolled
utilities.** Hand-rolling is what produced six width tiers and five
padding schemes before it existed: `px-6` on the policy pages, `p-4` on
the gear pages, `p-4 sm:p-6` on `/settings`, `p-4 md:p-6` on `/access`,
so the text edge moved by 8px on a phone between pages that read as
peers.

**The horizontal gutter (`px-4 sm:px-6`) is the same for every tier and
no tier may carry its own `px-*`** — that is the part the eye tracks
across a navigation, and `page-container.test.tsx` pins it for all four.
Only the measure varies:

| Tier      | Measure     | For                                                   |
| --------- | ----------- | ----------------------------------------------------- |
| `focused` | `max-w-md`  | Signed-out interstitials — sign-in, verify-email      |
| `prose`   | `max-w-2xl` | Policy, legal, marketing copy; ~65ch at the body size |
| `app`     | `max-w-3xl` | Signed-in single-column pages: forms, card stacks     |
| `wide`    | `max-w-5xl` | Tables and grids that earn the columns                |

`width` has **no default** — an implicit measure is how the drift
started. Content spacing (`space-y-*`, `flex flex-col gap-*`) stays on
the page and comes through `className`, which `cn()` settles against the
tier deterministically.

Full-bleed pages are the exception, not a tier: the hero renders as a
sibling _above_ the container, so `album`, `history`, `sponsors` and
`volunteer` each render `<PageHero />` then a `PageContainer`. The
landing sections centre their own inner column and share only the
gutter.

**The shell owns `<main id="main">`.** Pages must not render their own —
21 of them used to, nesting a second landmark and duplicating the id.

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

Tab bars live in `src/components/layouts/` — `FeedbackTabsBar` because two features would otherwise have to cross-import each other, `AccountTabsBar` (the `/my/_tabs` bar) because a `createFileRoute` module can't be rendered without a router and the active-tab logic is exactly what's worth pinning in a test. Surface switchers between two URLs are **real `<Link>`s, not a tablist of buttons** — two URLs must keep right-click / middle-click / copy-link, with `aria-current` conveying the selection.

**The selected tab is computed from `useLocation()` and resolved through `cn()`, not handed to `activeProps`.** The router concatenates `activeProps`' `className` onto the base one, so conflicting Tailwind utilities (`border-transparent` vs `border-primary`) are settled by stylesheet order rather than by the route; `twMerge` settles them deterministically instead. The active tab carries three signals — tinted panel, primary underline, weight/contrast bump — because a 2px underline alone is easy to miss on a row that scrolls horizontally on a phone.
