/**
 * Subscription URL shapes (issue #187).
 *
 * Pure functions taking the origin as a parameter rather than reading
 * `window` — so they are testable, and so the one place that has to
 * care about SSR (there is no origin on the server) is the component
 * rather than four URL builders.
 */
import type { EventKind } from "#/../drizzle/schema";

/** The member's own feed. `token` is a bearer credential; treat as one. */
export function feedUrl(
  origin: string,
  token: string,
  kinds?: readonly EventKind[],
): string {
  const base = `${origin}/api/calendar/${token}.ics`;
  if (!kinds || kinds.length === 0) {
    return base;
  }
  return `${base}?kind=${[...kinds].sort().join(",")}`;
}

/** The anonymous feed of public events. */
export function publicFeedUrl(origin: string): string {
  return `${origin}/api/calendar/public.ics`;
}

/**
 * The same URL under the `webcal://` scheme.
 *
 * iOS, macOS and Outlook register a handler for it, so tapping the link
 * opens "Subscribe to this calendar?" directly — which is the entire
 * difference between a member subscribing and a member staring at a
 * wall of iCalendar text that just downloaded. Android and most desktop
 * browsers do nothing with it, which is why the copy button and the
 * Google link are offered alongside rather than instead.
 */
export function webcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https?:\/\//, "webcal://");
}

/**
 * Google Calendar's "add by URL" deep link.
 *
 * Google wants the `https` form here, not `webcal` — it fetches the URL
 * server-side rather than handing it to a local app.
 */
export function googleCalendarAddUrl(httpsUrl: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(httpsUrl)}`;
}
