---
paths:
  - "apps/ucmc-web/src/server/notifications/**"
  - "apps/ucmc-web/src/server/email/**"
  - "apps/ucmc-web/src/features/auth/server/notification-prefs-*"
  - "apps/ucmc-web/src/features/auth/components/notification-preferences-section.tsx"
  - "apps/ucmc-web/src/routes/my._tabs.preferences.tsx"
---

# Notifications and per-user preferences

## The registry is the single source of truth

`src/server/notifications/notification-registry.ts` is the per-user mirror of `settings-registry.ts`. **Adding a notification category is one entry there — no migration**, because `user_notification_preferences` stores a sparse row only when a member moves a category off its default. A boolean column per category would have made every category a migration.

It lives in `src/server/` rather than a feature because the senders, the preferences tab and the cron all need it and features can't import each other — the same reasoning as `gear-cave-standing.server.ts`.

Labels and descriptions are served **from** the registry to the UI. The preferences section renders whatever rows the action returns, so a new category grows a row without the component being touched. Don't put copy in the component.

## `suppressible` is where transactional-vs-courtesy lives

It is a **registry field, deliberately not a fork in the architecture** — declarative, greppable, testable, and it makes "an unsubscribe link on a notice that shouldn't have one" unrepresentable rather than a thing to remember.

The line is the CAN-SPAM one, and it was researched rather than guessed:

- A **courtesy** message ("gear due in two days") is opt-out-able. `suppressible: true`.
- A **relationship** message ("you are holding club gear three weeks overdue") concerns club property the member is holding. It is exempt from the opt-out requirement, and it is the club's only way to reach them. `suppressible: false`, plus an `alwaysOnReason` the UI states.

**RFC 8058 one-click unsubscribe is not required here.** It binds _bulk senders_ (5,000+/day to Gmail) on marketing and subscribed mail, and explicitly excludes transactional mail. A `List-Unsubscribe` header on a courtesy message is hygiene, not compliance. Don't add one to a non-suppressible category.

### A non-suppressible category never reads the preferences table

`shouldNotify` short-circuits on `isSuppressible` **before** touching D1, so a stray row — planted by a bug, a migration, or a future unsubscribe link — cannot silence one. `setMyNotificationPreferenceAction` additionally **refuses** such a write (`not_suppressible`) rather than accepting and ignoring it: a member who is told "saved" about a switch the senders never read ends up certain they opted out of something that keeps arriving. Both halves are pinned in `notification-prefs.test.ts`.

## Reads fail CLOSED — the opposite of `readSetting`

This is the thing to understand before changing the repo. `readSetting` fails **open** (returns the default on any error) so the site keeps working against a fresh or flaky database. Preference reads fail **closed**: an unreadable preference resolves to "do not send".

The harm is asymmetric. Emailing somebody who opted out is the failure the table exists to prevent; a skipped courtesy nudge costs nothing, because the member still sees the `/my/gear` banner and the next rung tries again tomorrow. Without the inversion, one D1 hiccup during the daily cron mails every opted-out member at once.

`listSuppressedUserIds` **throws** rather than returning an empty set, for the same reason: an empty set reads as "nobody opted out", which is precisely the mistake that would mail everyone. A caller that catches it must abandon the run, not proceed.

## Preference writes are not audited

Unlike settings writes, which batch with an audit event. The audit log records **officer actions against the club**; a member toggling their own email preference would be noise in it. The row's `source` (`user` | `unsubscribe_link`) and `updatedAt` are the record, and together they answer the only question anyone actually asks: "I never turned that off."

## Storage shape

`user_notification_preferences`, composite PK `(user_id, category, channel)`, plus an index on `(category, channel, enabled)`. The index leads with `category` on purpose — the PK already answers "this member's preferences", and the query that needs an index is the cron's "everyone who turned one category off", which is one read per run rather than one per recipient.

`channel` carries one value (`email`) today. It is in early because it is part of the primary key and SQLite has no `ALTER COLUMN`; see `data-and-bindings.md` for why a key rebuild is not available on D1.

**A row is written even when the value matches the default.** The contract is "absent means default", not "present means changed" — keeping an explicit `true` means a later change to a registry default leaves members who already made a choice where they put themselves.

## Sending

`src/server/email/resend.ts` has two tiers and **no third**: Resend when `RESEND_API_KEY` is set, Mailpit when `MAILPIT_URL` is, and otherwise it **throws** `EmailNotConfiguredError`. An earlier revision logged the message to the Worker console as a "fallback"; that either dumped magic-link URLs into dashboard-readable Workers Logs or left users staring at a never-arriving email. Failing loudly is the behaviour — don't reintroduce a silent tier.

`EmailMessage` is `{ to, subject, text, html? }`. There is no `headers` field and no HTML layout; `magicLinkEmail` is plain text. Adding either is a real edit, not free.
