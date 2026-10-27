---
paths:
  - "apps/ucmc-web/src/server/notifications/**"
  - "apps/ucmc-web/src/server/email/**"
  - "apps/ucmc-web/src/features/auth/server/notification-prefs-*"
  - "apps/ucmc-web/src/features/auth/components/notification-preferences-section.tsx"
  - "apps/ucmc-web/src/routes/my._tabs.preferences.tsx"
---

# Notifications and per-user preferences

Why categories are a code registry with sparse preference rows, and why those reads fail closed: `docs/adr/0010-registries-not-rows.md`. Why the dev outbox exists: `docs/adr/0001-dev-email-outbox.md`. This file is the rules for changing senders and preferences.

## Where things go

- **`src/server/notifications/notification-registry.ts`** is the single source of truth for categories: labels, descriptions, defaults, `suppressible`, `alwaysOnReason`. In `src/server/` because the senders, the preferences tab and the cron all need it.
- **`user_notification_preferences`**: composite PK `(user_id, category, channel)` plus an index on `(category, channel, enabled)` for the cron's "everyone who turned this off" read. A row exists only once a member moves a category; `source` (`user` | `unsubscribe_link`) and `updatedAt` are the record. `channel` is only `email` today.
- **`shouldNotify`**, **`listSuppressedUserIds`**, **`setMyNotificationPreferenceAction`**: the read, the bulk read, the write.
- **`src/server/email/resend.ts`** sends through the provider `emailTier()` (`email-tier.ts`) picks, which `/health` also reads:
  1. **Outbox** when `EMAIL_OUTBOX` is set (dev only, read at `/dev/outbox` behind Access; refused without `ACCESS_TEAM_DOMAIN` and `ACCESS_OUTBOX_AUD`). It beats Resend, so a stale `RESEND_API_KEY` can't put real mail back on the wire. Mailpit still wins locally.
  2. **Resend** when `RESEND_API_KEY` is set.
  3. **Mailpit** when `MAILPIT_URL` is set.

  Otherwise it throws `EmailNotConfiguredError`.

- **`EmailMessage`** is `{ to, subject, text, html?, headers?, idempotencyKey? }`. There is no HTML layout; magic-link and gear reminder emails are plain text.

## Rules that are easy to break

- **Copy lives in the registry**, served to the UI. The preferences section renders whatever rows the action returns; don't put copy in the component.
- **`suppressible` is the CAN-SPAM line.** A courtesy message ("gear due in two days") is `suppressible: true`. A relationship message about club property a member is holding ("three weeks overdue") is `suppressible: false` with an `alwaysOnReason` the UI shows.
- **No RFC 8058 one-click unsubscribe requirement here** (it binds bulk senders on marketing mail). A `List-Unsubscribe` header on a courtesy message is hygiene; **never add one to a non-suppressible category.**
- **A non-suppressible category never reads the table**: `shouldNotify` short-circuits on `isSuppressible` before D1. **`setMyNotificationPreferenceAction` refuses such a write** (`not_suppressible`) rather than accepting and ignoring it. `notification-prefs.test.ts` pins both.
- **Preference reads fail CLOSED**, the opposite of `readSetting`: unreadable means "do not send".
- **`listSuppressedUserIds` throws** rather than returning an empty set. A caller that catches it abandons the run.
- **Preference writes are not audited.** The audit log is for officer actions against the club.
- **Write a row even when the value matches the default.** The contract is "absent means default".
- **There is no console tier**, and never add one: it either leaks magic-link URLs into Workers Logs or silently drops mail. The outbox is not a console tier (opted into per stack, Access-only, kept one day, refused on prod by infra).
- **`devOutboxHref`** (beside `emailTier()`) is null unless the outbox tier is active, and must stay a function of the environment alone: the sign-in response is enumeration-proof. `DevOutboxLink` renders nothing for null.
- **Every gear reminder carries `gear.caveHoursNote`**, free text; blank collapses the line and its separator (the summer case).
- **Each reminder rung has its own subject line**, so an escalation is visible from the inbox.

## Adding things

- **A notification category** is one registry entry: no migration. Decide `suppressible` first; a non-suppressible one needs an `alwaysOnReason`.
- **A new channel** is a new `channel` value; it is already part of the PK, because SQLite can't change a key without the rebuild `data/migrations.md` forbids.
- **An HTML email** needs a layout built first; it is a real edit, not free.
