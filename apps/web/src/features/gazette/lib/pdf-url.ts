/**
 * Build a browser-facing URL for an R2-stored Gazette PDF.
 *
 * Two emission shapes, picked by whether `VITE_R2_PUBLIC_HOST` is set
 * at build time:
 *   - With CDN host (deployed envs):
 *       https://${VITE_R2_PUBLIC_HOST}/gazette/<id>/<hash>.pdf
 *     Bytes are served straight from the Cloudflare R2 custom domain;
 *     the worker is never invoked.
 *   - Without CDN host (local dev / Miniflare):
 *       /api/gazette-pdf/<id>/<hash>.pdf
 *     Falls back to the worker-mediated route in
 *     `apps/web/src/routes/api/gazette-pdf.$.ts`. The route's splat is
 *     interpreted relative to the `gazette/` prefix, so we strip it
 *     here and the route re-prepends server-side.
 *
 * Storage keys are emitted by `gazettePdfKey()` in
 * `apps/web/src/server/r2/gazette.server.ts` and always start with
 * `gazette/`.
 */
import { env } from "#/config/env";

const GAZETTE_PREFIX = "gazette/";

export function gazettePdfUrl(pdfKey: string): string {
  const cdnHost = env.VITE_R2_PUBLIC_HOST;
  if (cdnHost) {
    return `https://${cdnHost}/${pdfKey}`;
  }
  return `/api/gazette-pdf/${pdfKey.slice(GAZETTE_PREFIX.length)}`;
}

/**
 * Human-friendly filename for the download attribute. Browsers may
 * ignore this cross-origin (R2 custom domain), but it works in dev
 * where the worker fallback serves under the same origin.
 */
export function gazettePdfFilename(
  schoolYear: string,
  issueNumber: number,
): string {
  return `goosedown-gazette-${schoolYear}-issue-${issueNumber}.pdf`;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Format a published-at timestamp as a calendar date in UTC. The
 * dialog's date input emits `YYYY-MM-DD` which the server stores as
 * UTC midnight; using `date-fns` `format()` here would surface the
 * date in the runtime's local timezone, which produces a hydration
 * mismatch between the worker (UTC) and the user's browser (likely
 * not UTC). Hand-formatting from `getUTC*()` is deterministic on
 * both sides.
 */
export function formatPublishedAtUtc(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
