---
name: rename-permission-or-setting
description: Rename an RBAC permission, a site-setting key, or a hero setting key via migration, without stranding audit history or silently reversing a live switch. Use when a migration renames anything the app looks up by string name.
---

# Rename a permission or a setting key

These renames look like a one-line `UPDATE`. They are not: three other things key off the old string, and each failure is silent.

## Renaming a permission

**It is an `UPDATE permissions SET name`, with the `perm_*` id left alone.**

`permissions.name` is the string code checks and is uniquely indexed but referenced nowhere else. `permissions.id` is the FK target for `role_permissions` **and** what `role.permissions_set` audit rows carry in their `permissionIds` metadata. So renaming by `name` preserves every runtime-delegated grant and keeps audit history resolvable, while re-keying the id would force a copy-then-delete dance _and_ silently orphan every `permissionIds` array already written to `audit_log`.

Leaving a slightly stale id (`perm_feedback_submit` for `site_feedback:submit`) is **correct and deliberate**. `src/server/auth/__tests__/permission-catalog.test.ts` pins the id↔name pairing so a later "tidy-up" fails loudly.

### The deploy window

`deploy.yml` runs `d1 migrations apply` **before** `wrangler deploy`. Between those steps the previous Worker is checking names the table no longer has. It fails closed, so the effect is a brief loss of access, never a grant — but **code shipped in the same release cannot cover that gap.**

**The shim has to land one release ahead of the rename.** That is the sequence to follow.

For the direction this release _can_ control — new code against a not-yet-migrated DB, i.e. local dev or a skipped migration step — `src/server/auth/permission-aliases.ts` folds the current name in wherever the principal is assembled, so no gate needs its own `includes(new) || includes(old)`.

## Renaming a site-setting key

Three statements, and they must travel together:

1. `UPDATE site_settings SET key = '<new>' WHERE key = '<old>'`
2. `UPDATE audit_log SET target_id = '<new>' WHERE target_type = 'site_setting' AND target_id = '<old>'` — **the per-setting history panel keys on the setting name**, so a bare `site_settings` rename strands the history of a switch that has in fact been toggled.
3. Rename the key in the `SETTINGS` registry.

**And because reads fail open, a rename needs a read-through to the old key for one release.** Otherwise a build asking for the new key against a not-yet-migrated DB misses the row, falls back to the registry default, and **silently reverses a switch an admin had set** — the feedback gates default ON, so a paused intake would reopen with the panel still showing ON.

`LEGACY_SETTING_KEYS` in `settings-repo.server.ts` holds that map for both readers.

## Renaming a hero setting key or `hero_slides.page` slug

Same shape. `LEGACY_HERO_SETTING_KEYS` in `landing-actions.server.ts` is the hero equivalent of `LEGACY_SETTING_KEYS`.

`HERO_PAGES` keys are persisted in `hero_slides.page` and embedded in setting keys, so renaming one **is a data migration** — never derive them from the route path.

## Renaming anything that appears in `audit_log`

`audit_log.action` and `target_type` are plain TEXT with no CHECK constraint, so **stale values don't fail — they render as unknown actions.** A migration that renames a feature must rewrite them in the same breath. Migration `0065` is the full template: table rename, index recreated for the new access pattern, setting keys renamed, and `action` / `target_type` / `target_id` rewritten together.

## R2 key prefixes do NOT get renamed

Keys are never user-visible, so a prefix outliving its feature's rename is correct — re-keying means a copy-then-delete pass over every deployed bucket where a partial run strands objects. `album/` is still `gallery/`. **Do not "fix" a stale-looking prefix in `GC_PREFIXES`** — that silently stops the orphan sweep from ever seeing those objects.

## The compatibility shims are temporary

`permission-aliases.ts`, `LEGACY_SETTING_KEYS`, and `LEGACY_HERO_SETTING_KEYS` each exist for exactly one release. **Delete each one — plus its test and its call sites — once its migration is applied to both dev and prod.** Check before adding a new one whether an old one is now deletable.

## Checklist

- [ ] Migration renames by `name`/`key`, not by id
- [ ] `audit_log` rewritten in the same migration (`action`, `target_type`, `target_id` as applicable)
- [ ] Legacy read-through added for one release
- [ ] For permissions: the alias shim shipped a release _ahead_ if this is a prod-facing rename
- [ ] `pnpm --filter ucmc-web test` — the catalog test pins id↔name
