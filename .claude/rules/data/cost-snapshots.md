---
paths:
  - "apps/ucmc-web/src/server/cost/**"
  - "apps/ucmc-web/src/server/cron/cost-snapshot.server.ts"
  - "apps/ucmc-web/src/features/analytics/**"
---

# Cost and usage snapshots

Part of the data rule.

`cost_snapshots` records what the site costs and how much free tier is left, written by a third task on the daily cron (`src/server/cron/cost-snapshot.server.ts`). Reports and the future analytics panel read it; nothing reads a vendor API at request time.

**Rows are daily, not monthly**, because every source reports daily and the limits that bind (Workers requests, D1 rows, KV operations) are themselves daily. Monthly totals derive from daily; the reverse does not.

**Three sources, and the split is not cosmetic:**

| Source                 | Covers          | Why separate                                                                                                           |
| ---------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `cloudflare_billing`   | R2 only         | The Billable Usage API reports **only services with a paid subscription**. On a free plan that is R2 and nothing else. |
| `cloudflare_analytics` | Workers, D1, KV | GraphQL datasets — the only place free-tier usage exists at all.                                                       |
| `resend`               | email sends     | Resend publishes **no** usage history, so the figures are rolled up from our own `email_sends` log.                    |

**`quantity` is `ConsumedQuantity`, never `PricingQuantity`.** The latter is what remains _after_ the free allowance and is `0` on every row while inside the free tier — recording it snapshots zeros forever. Likewise `ConsumedUnit` is empty on count-based services and `PricingUnit` carries the real unit.

**`CLOUDFLARE_ACCOUNT_READ_TOKEN` needs five scopes**, and `Account Analytics: Read` is **not** sufficient for the three product datasets despite the docs — Workers Scripts Read, D1 Read and Workers KV Storage Read are each required for their own. It reads telemetry for the whole account, so it stays on the cron path; **adding a scope is a permission grant, not a config tweak.**

**Two API constraints, both established by probing:** the range caps at **90 days** (92 is rejected), and retention is shallower than the subscription — undocumented, ~108 days when measured. Backfill therefore stops when a window returns nothing rather than walking toward a known start date, recording a floor in KV because an absence leaves no row to re-read.

**Never write a zero row for a source that failed.** A zero later reads as a true measurement of nothing and is indistinguishable from a real reading; a gap is honest. The same rule is why the Resend rollup emits nothing for days before `email_sends` existed, and why analytics rows leave `cost_cents` null rather than 0.

**`cost_snapshots` is never swept** — operational spend, not member data, and reports want it forever. `email_sends` _is_ swept at 90 days, and that sweep is housekeeping rather than a privacy promise: the table carries **no recipient**, deliberately, and adding one is a compliance change (privacy notice, data export, delete cascade, compliance matrix) rather than a schema tweak.

Free-tier limits live in `src/server/cost/service-catalog.ts`. They are the one part of this feature no API can verify — Cloudflare reports consumption and says nothing about entitlement — so each carries a `limitSource` and will go stale. As measured, **KV writes are the tightest constraint** (1,000/day) by roughly a factor of two over everything else.
