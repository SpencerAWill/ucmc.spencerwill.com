---
name: add-page-flag
description: Add a per-page kill switch (a pages.* site setting) and wire its route guard and nav entry. Use when adding a new page, a "coming soon" sidebar placeholder, or a new section node under /settings.
---

# Add a page kill switch

Every reachable page gets a `pages.<key>` boolean. A disabled page both disappears from the nav and 404s on direct navigation regardless of permission. Background is in `.claude/rules/site-settings.md`.

## 1. Add the registry entry

One entry in `SETTINGS` in `src/server/settings/settings-registry.ts`. **That is the whole data change — no migration.** The flags map, its `PageFlagKey` type, the server reader, the client fallback, and `PageFlagsPanel` are all built by iterating `PAGE_SETTING_KEYS`.

- Default **ON**. (The exceptions are documented in the settings rule; don't add new ones without asking.)
- If it belongs under a section, set `parent: "<parent flag key>"`. **Parentage is declared, never inferred from the key name** — `pages.gear_cave` is `/gear-cave` and is _not_ a child of `pages.gear`.
- If switching it off has consequences beyond hide-and-404, **it is not a page flag.** Put it in `features.*` instead and guard with `requireFeatureFlag`.
- Give it a `confirm` if switching it off would strand members (e.g. anything under `pages.my`).

## 2. Wire the route guard — pick the right one

This is where it goes wrong. The choice depends on whether the route has an auth-guarded parent layout.

**No auth-guarded parent** (`/album`, `/sponsors`, `/access`, most public pages):

```ts
beforeLoad: async ({ context }) => {
  await requirePageFlag(context.queryClient, "<key>"); // first
  // ...then the route's own auth/permission guard
};
```

Or `requirePageEnabled(queryClient, "<key>", "<permission>")` for an anonymous-capable public page — it does the flag plus `requireViewPermission`.

**Nested under an auth-guarded parent** (`/gear/*`, `/my/*`, `/members/_tabs/*`, `/feedback/_tabs/*`):

TanStack runs `beforeLoad` parent-to-child, so a parent's redirect (`requirePermission` / `requireApproved`) fires _before_ a leaf `notFound`, bouncing anonymous visitors to sign-in instead of 404ing uniformly. So:

- The **leaf** declares `staticData: { pageFlag: "<key>" }` **and** calls `requirePageFlag(context.queryClient, "<own key>")` in its own `beforeLoad`.
- The **parent layout** calls `requireEnabledPages(context.queryClient, matches)` before its own auth guard.

**Do not "simplify" a leaf to use `requireEnabledPages`.** `matches` on the `beforeLoad` argument is typed `Array<RouteMatch<…, ResolveAllContext<TParentRoute, …, TBeforeLoadFn>, …>>` — it depends on the very `beforeLoad` being defined and resolves every ancestor's context in turn. TypeScript only pays that cost when the property is destructured, and at four levels deep (`/my/gear/`) touching it pushes `createFileRoute` past the instantiation-depth limit with **TS2589**. The leaf's own flag is the only gated entry in its chain anyway (the layouts above are deliberately flag-less), and both call sites hit the same cached snapshot, so the double-check is free.

The leaf still needs its own check regardless: sibling-tab navigation keeps the parent match and doesn't re-run its `beforeLoad`.

## 3. Wire the nav entry

Compose `permission && flags.pages.<key>` in `app-layout.tsx` (and `members-tabs-bar.tsx` / `my._tabs.tsx` / `user-menu.tsx` if it appears there).

**Gate the entry on the flag of the page the link actually targets, not the section flag.** The sidebar's "Members" entry links to `/members`, so it reads `members_approved`, not `members`. Effective flags mean the section still hides it, and this is what stops the entry linking to a page that 404s when only the index is switched off.

A route-less "coming soon" placeholder still gets a flag — its flag only hides the sidebar entry, and keeping them all flagged means "is it flagged?" never needs checking.

## 4. Verify

```bash
pnpm --filter ucmc-web typecheck   # TS2589 shows up here
pnpm --filter ucmc-web test
```

Then check `page-flag-cascade.test.ts` still passes if you added a `parent`.
