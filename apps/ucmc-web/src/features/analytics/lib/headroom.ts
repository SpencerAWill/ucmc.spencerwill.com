/**
 * How close a service is to its free-tier ceiling, and how to say it.
 *
 * Pure — every input a parameter, no clock, no DB, no React — so
 * Stryker can mutate it (`stryker.config.json` can only reach modules
 * that do not touch `cloudflare:workers`, which is why this policy
 * lives in `lib/` rather than inlined into the panel).
 */

/** Ordered least to most urgent; the order is the comparison. */
export type HeadroomSeverity = "healthy" | "watch" | "at-risk";

/**
 * Thresholds, as fractions of the allowance.
 *
 * 50% / 80% rather than something tighter because these are DAILY caps
 * on a club whose traffic is spiky by nature — a trip-signup evening
 * is several times an ordinary Tuesday. A ceiling that only warns at
 * 95% warns after the spike that would have blown it has already
 * happened; one that warns at 25% cries wolf every weekend.
 */
export const HEADROOM_WATCH = 0.5;
export const HEADROOM_AT_RISK = 0.8;

export function headroomSeverity(fraction: number): HeadroomSeverity {
  if (fraction >= HEADROOM_AT_RISK) {
    return "at-risk";
  }
  if (fraction >= HEADROOM_WATCH) {
    return "watch";
  }
  return "healthy";
}

/**
 * A share of an allowance, as a percentage string.
 *
 * Small values keep a digit rather than collapsing to "0%": at this
 * club's volumes most services sit in the hundredths of their cap, and
 * a column of "0%" would say the measurement was pointless rather
 * than that the headroom is enormous. Anything under a tenth of a
 * percent gets "<0.1%", which is honest without implying a precision
 * the daily rollup does not have.
 */
export function formatHeadroom(fraction: number): string {
  const pct = fraction * 100;
  if (pct >= 1) {
    return `${pct.toFixed(1)}%`;
  }
  if (pct >= 0.1) {
    return `${pct.toFixed(2)}%`;
  }
  // Exactly zero is a real reading — a service catalogued but unused —
  // and deserves "0%" rather than an inequality implying some usage.
  return pct === 0 ? "0%" : "<0.1%";
}

/**
 * Locale-pinned, matching `lib/date-format` and the rest of the app.
 *
 * Not the runtime default: the worker and the browser would disagree,
 * and a number formatted differently on the two sides of SSR is a
 * hydration mismatch.
 */
const NUMBER = new Intl.NumberFormat("en-US");

export function formatQuantity(value: number): string {
  return NUMBER.format(value);
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatCents(cents: number): string {
  return USD.format(cents / 100);
}
