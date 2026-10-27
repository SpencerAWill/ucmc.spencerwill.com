# 0010. Settings, notifications, prompts and badges are registries; permissions are rows

- **Status:** Accepted
- **Date:** 2026-05-13 (settings); extended 2026-10-08 (notifications) and 2026-10-09 (profile prompts and badges)
- **Issue:** #90, #240, #257

## Context

Several catalogs drive this app: site settings, notification categories, profile prompts, disciplines and badges, and permissions. Each could be a table seeded by migration or an entry in a TypeScript file. A row is editable at runtime but untyped in code, and every addition is a migration. A code entry is typed end to end and reviewed in a PR, but changing one needs a deploy.

Only some of these need runtime editing. Officers grant permissions to roles at `/access`, and a grant has to point at something with a foreign key. Settings' _values_ change at runtime, but the set of keys only changes with the code that reads them.

## Decision

- **Catalogs are code registries** with no migration to add an entry. Only users' or officers' answers are rows, and those rows are sparse:
  - **Site settings**: `settings-registry.ts`. Zod schema plus metadata per key. Values live in `site_settings` and **fail open** to the schema default.
  - **Notification categories**: `notification-registry.ts`. `user_notification_preferences` holds a row only when a member moves a category off its default. Reads **fail closed**, because mailing someone who opted out is the harm the table prevents. `suppressible` lives in the registry, not in the senders.
  - **Profile prompts, disciplines and badges**: `src/server/member-profile/`. Answers are sparse rows. **Badges are computed on every read and never stored**, so an award and its evidence cannot disagree.
- **Permissions are D1 rows**, seeded by migration, because roles reference them and `/access` edits grants at runtime. Only permissions marked `anonymous_grantable` may go on the `anonymous` role.

## Consequences

- Adding a setting, category, prompt or badge is one typed entry. The UI renders from the registry, so no component changes.
- Adding a permission needs a migration. Renaming any string-keyed entry needs care (the `rename-permission-or-setting` skill). A registry key that disappears leaves its rows orphaned, and readers drop them rather than render them.
- There is no permission-implication mechanism: a write permission that implies a read is an OR at one shared gate, plus an explicit grant in the seed.
- A badge that needs data we don't have yet is declared `blockedBy` and never awarded. One that officers award by hand would need a table, and none is declared yet.
