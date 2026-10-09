/**
 * The only place this app talks to the Cloudflare account APIs.
 *
 * Both calls need `CLOUDFLARE_ACCOUNT_READ_TOKEN`, an account-scoped
 * read-only credential spanning billing AND per-product analytics. It
 * is reachable from the cron path alone — never from a route handler —
 * because it reads telemetry for the whole account, including workers
 * unrelated to this app.
 *
 * Failures return null rather than throwing. A vendor outage must leave
 * yesterday's snapshot intact; writing a zero row instead would later
 * read as "we used nothing that day", which is worse than a gap because
 * it is indistinguishable from a true reading.
 */
import { env } from "#/server/cloudflare-env";
import { errorMessage, log } from "#/server/log/log.server";

const API_BASE = "https://api.cloudflare.com/client/v4";

/** Guards every call; both halves must be present to reach the API. */
export function costCredentials(): { accountId: string; token: string } | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_ACCOUNT_READ_TOKEN;
  return accountId && token ? { accountId, token } : null;
}

async function readJson(
  response: Response,
  event: string,
): Promise<unknown | null> {
  if (!response.ok) {
    log.warn(event, { status: response.status });
    return null;
  }
  try {
    return await response.json();
  } catch (err) {
    log.warn(event, { error: errorMessage(err) });
    return null;
  }
}

/**
 * Billable usage for `[from, to]` as civil dates.
 *
 * The range must be 90 days or fewer — 92 is rejected with
 * `max_date_range_days` — and must include the subscription's
 * billing-cycle anchor day or the response carries no usage at all.
 * `planSnapshotWindow` owns the first constraint; the second is why
 * windows are anchored to days we already hold rather than to calendar
 * months.
 */
export async function fetchBillableUsage(args: {
  from: string;
  to: string;
}): Promise<unknown | null> {
  const creds = costCredentials();
  if (creds === null) {
    return null;
  }
  const url =
    `${API_BASE}/accounts/${creds.accountId}/billable-usage` +
    `?from=${args.from}T00:00:00Z&to=${args.to}T00:00:00Z`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.token}` },
    });
    return await readJson(res, "cost.billable_usage_failed");
  } catch (err) {
    log.warn("cost.billable_usage_failed", { error: errorMessage(err) });
    return null;
  }
}

/**
 * Workers, D1 and KV usage for `[from, to]`, in one GraphQL round trip.
 *
 * Three datasets in a single query because they share a token, a date
 * range and a failure mode, and three round trips from a cron tick with
 * a CPU budget is three chances to time out.
 *
 * Each dataset needs its own token scope — Workers Scripts Read, D1
 * Read, Workers KV Storage Read. `Account Analytics Read` does NOT
 * cover them despite the documentation implying it does; each returns
 * `authorization denied` until its own scope is granted.
 */
export async function fetchAnalyticsUsage(args: {
  from: string;
  to: string;
}): Promise<unknown | null> {
  const creds = costCredentials();
  if (creds === null) {
    return null;
  }
  const filter = `filter: {date_geq: "${args.from}", date_leq: "${args.to}"}`;
  const query = `query {
    viewer {
      accounts(filter: {accountTag: "${creds.accountId}"}) {
        workersInvocationsAdaptive(limit: 10000, ${filter}) {
          dimensions { date }
          sum { requests cpuTimeUs }
        }
        d1AnalyticsAdaptiveGroups(limit: 10000, ${filter}) {
          dimensions { date }
          sum { rowsRead rowsWritten }
        }
        kvOperationsAdaptiveGroups(limit: 10000, ${filter}) {
          dimensions { date actionType }
          sum { requests }
        }
      }
    }
  }`;

  try {
    const res = await fetch(`${API_BASE}/graphql`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    const payload = await readJson(res, "cost.analytics_failed");
    // GraphQL answers 200 with an `errors` array, so a transport-level
    // check alone would treat an authorization failure as success and
    // snapshot an empty day.
    const errors = (payload as { errors?: unknown } | null)?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      log.warn("cost.analytics_failed", {
        error: JSON.stringify(errors).slice(0, 300),
      });
      return null;
    }
    return payload;
  } catch (err) {
    log.warn("cost.analytics_failed", { error: errorMessage(err) });
    return null;
  }
}
