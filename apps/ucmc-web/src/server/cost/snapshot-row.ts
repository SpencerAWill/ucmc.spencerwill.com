/**
 * The shape every cost source produces, before it reaches D1.
 *
 * Parsers are pure functions from a vendor payload to these rows, with
 * the network in a separate `.server` wrapper — so the shapes the Alpha
 * Billable Usage API and the GraphQL datasets actually return are
 * pinned by fixture tests rather than discovered in production.
 */
import type { CostSource } from "#/server/cost/service-catalog";

export interface SnapshotRow {
  source: CostSource;
  serviceFamily: string | null;
  /** Stable dotted key — see `COST_SERVICES`. */
  serviceName: string;
  /** Civil date `YYYY-MM-DD`, inclusive. */
  periodStart: string;
  /** Civil date `YYYY-MM-DD`, exclusive. */
  periodEnd: string;
  quantity: number;
  unit: string;
  costCents: number | null;
  currency: string | null;
}
