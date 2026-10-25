---
paths:
  - "apps/ucmc-web/src/server/cron/**"
  - "apps/ucmc-web/src/features/gear/lib/loan-reminders.ts"
---

# Gear loan reminders

Part of the gear rule; `gear/loans.md` covers standing and extensions, which the
ladder reads.

### The reminder ladder

The daily job (`src/server/cron/gear-reminders.server.ts`) is what makes the overdue apparatus audible. Before it, the `/my/gear` banner was the only thing that ever told a member they were late, and nothing gave them a reason to open the page.

**The rungs are thresholds the system already computes**, so each email narrates a real state transition rather than nagging on an invented cadence: `due_soon` (`gear.dueSoonLeadDays`, default 2) → `overdue` (1 club day) → `flagged` (`gear.overdueFlagDays`) → `blocked` (`gear.overdueBlockDays`). Only the lead time is new; the other two are the settings `gearCaveStanding` reads, which is what stops the email and the desk disagreeing about the day somebody got flagged. **Terminal at `blocked`** — past that it's officer chasing.

The policy is pure (`lib/loan-reminders.ts`, every input a parameter including `now`); the cron module is plumbing. Club-day arithmetic goes through `#/lib/club-days`, shared with `gearCaveStanding` so the two can't drift.

Four things that are the way they are on purpose:

- **`reminder_stage` is the dedupe; `last_reminded_at` is officer-facing.** The ladder only climbs, which makes the job idempotent (a same-day re-run sends nothing) and outage-tolerant (a missed day is caught at the right rung, not skipped forever — which a purely date-triggered ladder would do).
- **Send, THEN advance.** A provider failure leaves the stage where it was so tomorrow retries; the reverse marks unsent mail as sent and the member never hears anything. The duplicate risk that creates is covered by a Resend idempotency key scoped to the club day.
- **Grouped by member AND category.** Four overdue items is one email. The two categories are never merged, because they obey different opt-out rules and merging would put courtesy content inside mail that carries no unsubscribe.
- **Migration `0073` backfills every open loan to the rung it already qualifies for.** Without that, the first run after deploy chases the entire overdue backlog — years-old CSV-imported rows included — in one morning, and the system is distrusted from day one.

`gear.remindersEnabled` ships **off**. It is read first and short-circuits everything, so it is the switch to reach for during a bad send or a provider incident. See `notifications.md` for the preference model and the transactional-vs-courtesy line.

**The reminders ride the daily tick rather than taking their own cron.** `server-entry.ts` routes any expression that isn't the March archive to its default branch, so a second daily schedule would silently run the retention sweeps twice a day. Adding one means making that branch explicit first.

The tick is `0 12 * * *` — **08:00 EDT / 07:00 EST** in Cincinnati. The hour is chosen for the **emails**: it was 08:00 UTC when only the retention sweeps rode it, which is 03:00/04:00 local — fine for DB deletes nobody sees, wrong for mail that can buzz a member's phone overnight.

**The one-hour DST drift is accepted, not overlooked.** Cron triggers are UTC-only with no DST awareness, so pinning 08:00 year-round needs a second expression plus a gate discarding the wrong tick. That was built and then reverted: `wrangler.jsonc` declares crons for two workers (dev + prod), so each expression costs **two** against the account, and the Workers Free cap is 5 — a third would make 6. See `server/cron/daily-schedule.ts` before re-deriving it, and `daily-schedule.test.ts`, which pins the drift at exactly one hour so moving the expression can't quietly move the hour members are mailed at.

**Cloudflare documents no timing guarantee for cron triggers at all.** Nothing here needs better than hour-level accuracy, and both daily jobs are idempotent — retention re-sweeps whatever is still expired, and the ladder is built to catch a missed day at the right rung rather than skip it.
