/**
 * What needs attention this week, derived from whatever the viewer is
 * allowed to see.
 *
 * **Exception-based, which is the single highest-value pattern on this
 * page.** An officer opens the dashboard between classes; the useful
 * question is never "how many loans have we ever done" but "what is on
 * fire right now". So the root page leads with a list that is EMPTY
 * when nothing is wrong, rather than with a wall of numbers the reader
 * has to triage themselves.
 *
 * Pure, and every input optional. The root page runs only the queries
 * the viewer has permission for, so each dataset arrives as
 * `undefined` when that officer cannot see it — and an item they
 * cannot act on must never appear. Undefined therefore means "not
 * visible to this viewer", which is deliberately NOT the same as
 * "nothing wrong": the panel's empty state says "nothing needs
 * attention in what you can see", not "nothing needs attention".
 *
 * Pure also means Stryker can mutate it, which is the point of
 * `lib/` — this is the one module on the page whose thresholds are
 * worth pinning.
 */
import {
  HEADROOM_AT_RISK,
  HEADROOM_WATCH,
} from "#/features/analytics/lib/headroom";

/** Ordered most to least urgent; the order IS the sort. */
export const ATTENTION_SEVERITIES = ["act-now", "watch", "clear"] as const;
export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];

export interface AttentionItem {
  /** Stable across renders, so React keys do not thrash. */
  key: string;
  severity: AttentionSeverity;
  message: string;
  /** Where to go and do something about it. */
  href: string;
  linkLabel: string;
}

export interface AttentionInputs {
  gear?: {
    overdueNow: number;
    overdueBands: { key: string; loans: number }[];
    failedInspections: number;
  };
  compliance?: {
    waivers: { uncovered: number };
    eventsHeld: number;
    rsoMinimum: number;
  };
  platform?: {
    headroom: { label: string; fraction: number | null }[];
  };
  membership?: { vacantRoles: number };
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  "act-now": 0,
  watch: 1,
  clear: 2,
};

/**
 * Build the list, most urgent first.
 *
 * "Sorted by consequence, not by count" — three items of gear 22 days
 * overdue outrank twelve items one day late, because the first is a
 * loss and the second is a Tuesday.
 */
export function buildAttention(inputs: AttentionInputs): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (inputs.gear) {
    const { overdueNow, overdueBands, failedInspections } = inputs.gear;
    const longOverdue =
      overdueBands.find((band) => band.key === "22+")?.loans ?? 0;
    if (longOverdue > 0) {
      items.push({
        key: "gear-long-overdue",
        severity: "act-now",
        message: `${longOverdue} ${plural(longOverdue, "loan is", "loans are")} more than 21 days overdue`,
        href: "/analytics/gear",
        linkLabel: "Gear",
      });
    } else if (overdueNow > 0) {
      items.push({
        key: "gear-overdue",
        severity: "watch",
        message: `${overdueNow} ${plural(overdueNow, "loan is", "loans are")} overdue`,
        href: "/analytics/gear",
        linkLabel: "Gear",
      });
    }
    if (failedInspections > 0) {
      items.push({
        key: "gear-failed-inspection",
        severity: "act-now",
        message: `${failedInspections} active ${plural(failedInspections, "item", "items")} failed its last inspection`,
        href: "/analytics/gear",
        linkLabel: "Gear",
      });
    }
  }

  if (inputs.compliance) {
    const { waivers, eventsHeld, rsoMinimum } = inputs.compliance;
    if (waivers.uncovered > 0) {
      items.push({
        key: "waivers-uncovered",
        severity: "act-now",
        message: `${waivers.uncovered} approved ${plural(waivers.uncovered, "member has", "members have")} no current-season waiver — they cannot borrow gear or join a trip`,
        href: "/analytics/compliance",
        linkLabel: "Compliance",
      });
    }
    if (eventsHeld < rsoMinimum) {
      items.push({
        key: "rso-minimum",
        severity: "watch",
        message: `${eventsHeld} of ${rsoMinimum} events held — below UC's RSO registration minimum`,
        href: "/analytics/compliance",
        linkLabel: "Compliance",
      });
    } else {
      items.push({
        key: "rso-minimum-met",
        severity: "clear",
        message: `RSO event minimum met — ${eventsHeld} of ${rsoMinimum} required events`,
        href: "/analytics/compliance",
        linkLabel: "Compliance",
      });
    }
  }

  if (inputs.platform) {
    // Worst first from the server, so the head of the list is the
    // tightest ceiling — one item, not one per service, because a
    // list of twelve healthy services is not an exception report.
    const tightest = inputs.platform.headroom.find(
      (service) => service.fraction !== null,
    );
    // Two distinct conditions, spelled separately rather than collapsed
    // into a loose `!= null`: `undefined` means no service reported at
    // all, `null` means the service has no published ceiling to be a
    // share of. Strict equality throughout, per CLAUDE.md.
    if (
      tightest !== undefined &&
      tightest.fraction !== null &&
      tightest.fraction >= HEADROOM_WATCH
    ) {
      items.push({
        key: "platform-headroom",
        severity: tightest.fraction >= HEADROOM_AT_RISK ? "act-now" : "watch",
        message: `${tightest.label} peaked at ${(tightest.fraction * 100).toFixed(1)}% of its daily free tier`,
        href: "/analytics/platform",
        linkLabel: "Platform",
      });
    }
  }

  if (inputs.membership && inputs.membership.vacantRoles > 0) {
    items.push({
      key: "vacant-roles",
      severity: "watch",
      message: `${inputs.membership.vacantRoles} officer ${plural(inputs.membership.vacantRoles, "seat has", "seats have")} nobody in them`,
      href: "/analytics/membership",
      linkLabel: "Membership",
    });
  }

  // Stable within a severity: `sort` is stable in every engine we
  // target, so items keep the insertion order above rather than
  // reshuffling between renders on equal rank.
  return items.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
