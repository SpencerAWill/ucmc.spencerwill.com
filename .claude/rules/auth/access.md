---
paths:
  - "apps/ucmc-web/src/routes/access.tsx"
  - "apps/ucmc-web/src/features/members/**/*role*"
  - "apps/ucmc-web/src/features/members/server/rbac-*"
  - "apps/ucmc-web/src/features/members/server/permissions.server.ts"
---

# The `/access` panel and the role sheet

Part of the auth rule; `auth/core.md` covers how permissions are stored.

A root-level roles-and-permissions panel — a sibling of `/settings`, not a child of `/members`, sitting next to Settings in the sidebar's bottom utility group. Gated by `roles:manage` plus the `pages.access` kill switch. Named for the umbrella concern rather than either noun it edits so widening its scope doesn't force a route rename; the **permission stays `roles:manage`**, which names the object actually being edited, as do the `roles` table, `RolesListEditor`, and the `role.*` audit actions. It uses the inline `requirePageFlag` primitive (not `staticData`) because it has no auth-guarded parent.

### The role sheet (`RoleEditorSheet`)

Three tabs — Members / Permissions / Details — and **all three stage edits behind their own Save**, each diffing against a baseline snapshotted at open time so a background refetch can't flip Save to dirty. `computeDirty()` derives all three flags from one state snapshot precisely because every tab's save has to ask whether the _others_ are still dirty before auto-closing the sheet. The Permissions tab groups the catalog by `name.split(":")[0]` into an **accordion, collapsed by default with a `granted / total` badge on every header** — the counts make the whole catalog scannable without expanding; the flat always-open stack it replaced is not something to go back to.

**The Members tab writes `user_roles`, so it gates on `roles:assign`, not the `roles:manage` that gates the page.** The two only travel together by seed, so a role delegated just `roles:manage` gets a **read-only** Members tab — deliberate, not an oversight. The server action is **`setRoleMembersAction`**, the role-keyed sibling of the user-keyed `setUserRolesAction` behind `/members/$publicId`; it emits one `role.assigned` / `role.unassigned` row per changed member so the audit page answers "who granted X this role?" the same way regardless of surface. Unclaimed stubs can't hold roles, and you can't drop your own `system_admin` (the sheet also disables that row's trash button, so the affordance is absent rather than present-and-then-rejected).

**It takes an `add` / `remove` diff, NOT the post-state — unlike the Permissions tab beside it, and that asymmetry is deliberate.** The sheet snapshots its baseline when it opens, so a post-state save would delete every member absent from a list that may be minutes stale: grant someone the role from `/members/$publicId` while the sheet sits open, and the next save silently unassigns them with a `role.unassigned` row nobody asked for. Scoping the write to the rows the user actually acted on makes concurrent edits merge instead of clobber. `role_permissions` has no second writer to lose, which is why the Permissions tab keeps its replace-all shape. The action intersects both lists against current membership (so a stale remove or a redundant add writes neither a row nor an audit event) and rejects an id appearing in both. **`ROLE_MEMBERS_DIFF_MAX`** (100, exported from `rbac-fns.ts`) caps each list and is enforced on both sides, the same arrangement as `BULK_ATTEST_MAX`. Both are **product bounds, not storage ones** — every statement behind them is sized independently of the cap (#291), so raising either is safe.

The mutation hook invalidates the `["members","detail"]` **prefix**, not one entry: `/members/$publicId` renders roles from `MemberDetail.roles` rather than the per-user assignment cache, and the role-keyed caller knows userIds while those entries key on `publicId`.

**Two roles are read-only on that tab.** `anonymous` hides it outright (it models signed-out visitors and has no members); **`member` is read-only because `setUserRolesAction` force-adds `role_member` back to every approved user**, so an X on those rows would silently no-op — membership follows account status, and the action rejects the role outright rather than letting the two paths disagree. `system_admin` **is** editable here, behind an `AlertDialog` on Save, because it's the one grant that hands over every permission on the site. The member picker is built on `membersDirectoryQueryOptions` rather than `features/gear`'s `MemberSearchCombobox` — that one reads a `gear:loan`-gated server fn, and features can't import each other.
