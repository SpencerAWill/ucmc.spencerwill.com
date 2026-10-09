-- Daily cost and usage snapshots per service (issue #268).
--
-- Hand-written, like every migration since 0060: `db:generate` cannot
-- run against the stale meta snapshots (see CLAUDE.md).
--
-- ## Why snapshots rather than live API calls
--
-- Reports must be reproducible, and what we do not record is
-- unrecoverable: Resend publishes no usage history at all, and
-- Cloudflare's Billable Usage API is Alpha with a 90-day maximum query
-- range and no documented retention depth. Prices also change, and once
-- a report states "September cost $X" that number has to stay stable.
--
-- ## Daily, not monthly
--
-- The issue proposed monthly rows. Every source actually reports daily
-- — Cloudflare's billable usage uses daily charge periods, the GraphQL
-- analytics datasets carry a `date` dimension, and the email log is
-- rolled up per day — and the free-tier limits that matter most
-- (Workers requests, D1 rows, KV operations) are themselves DAILY
-- limits. A monthly row cannot answer "did we blow the daily cap on the
-- 18th", and monthly totals are derivable from daily ones while the
-- reverse is not.
--
-- ## Periods are civil dates in CLUB_TIME_ZONE, half-open
--
-- `[period_start, period_end)`, matching `seasonBoundsFor` and the
-- `gte`/`lt` query convention. Stored as 'YYYY-MM-DD' text so a report
-- grouping by month or season does string math rather than re-deriving
-- a zone.
--
-- **Cloudflare's billing periods are anchored to a subscription day
-- (the 13th on this account), not to the calendar.** Calendar buckets
-- are derived from the daily rows here; never request a calendar month
-- from the API directly, and note the API returns nothing at all unless
-- the requested range includes the anchor day.
--
-- ## No retention sweep, deliberately
--
-- Unlike `email_sends` and the privacy sweeps, this table is never
-- swept. It is not per-member behavioural data — it is operational
-- spend and usage, it is tiny (a few rows per service per day), and the
-- reports feature wants it to live forever. **Do not "fix" the missing
-- sweep.**
--
-- ## Domain registration is deliberately absent
--
-- Someone else owns and pays for the domain, so it is not the club's
-- spend and does not belong in a club cost report.
CREATE TABLE IF NOT EXISTS cost_snapshots (
  -- 'cloudflare_billing' | 'cloudflare_analytics' | 'resend'.
  -- Billing and analytics are separate sources because they are
  -- separate APIs with different credentials, shapes and failure modes
  -- — and because billing covers only services with a paid
  -- subscription, while free-tier usage appears exclusively in
  -- analytics.
  source         text    NOT NULL,
  -- 'Workers' | 'R2' | 'D1' | 'KV', or NULL for sources with no family
  -- (Resend). Used to fold a stacked bar into ~5 segments.
  service_family text,
  -- Stable dotted key, e.g. 'workers.requests', 'd1.rows_read',
  -- 'resend.sends'. NOT the vendor's display string: Cloudflare embeds
  -- its free allowance in `ServiceName` ("R2 Data Storage (First 10GB-Month
  -- included)"), which changes when the allowance does and would split
  -- one series into two.
  service_name   text    NOT NULL,
  period_start   text    NOT NULL,
  period_end     text    NOT NULL,
  -- Real usage, NOT the billable quantity. Cloudflare reports both, and
  -- `PricingQuantity` is what is left AFTER the free allowance — it is
  -- 0 on every row while the club is inside the free tier, so recording
  -- it would snapshot zeros forever and make headroom unanswerable.
  quantity       real,
  unit           text,
  cost_cents     integer,
  currency       text,
  captured_at    integer NOT NULL,
  -- Upserted daily while a period is open, effectively frozen once it
  -- closes. A source may report the same service for the same day more
  -- than once as late data lands.
  PRIMARY KEY (source, service_name, period_start)
);
--> statement-breakpoint
-- Reports scan a date range across all services; the PK leads with
-- `source`, so it cannot serve that.
CREATE INDEX IF NOT EXISTS cost_snapshots_period_idx
  ON cost_snapshots (period_start);
