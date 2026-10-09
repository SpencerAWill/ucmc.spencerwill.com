import { describe, expect, it } from "vitest";

import {
  feedUrl,
  googleCalendarAddUrl,
  publicFeedUrl,
  webcalUrl,
} from "#/features/calendar/lib/feed-url";

const ORIGIN = "https://ucmc.spencerwill.com";
const TOKEN = "01912f9a-0000-7000-8000-000000000000";

describe("feedUrl", () => {
  it("builds the member feed path", () => {
    expect(feedUrl(ORIGIN, TOKEN)).toBe(`${ORIGIN}/api/calendar/${TOKEN}.ics`);
  });

  it("omits the query entirely when no kinds are given", () => {
    expect(feedUrl(ORIGIN, TOKEN)).not.toContain("?");
    expect(feedUrl(ORIGIN, TOKEN, [])).not.toContain("?");
  });

  /**
   * Sorted so the same selection always yields the same URL. A member
   * who re-picks the same filters must get the link they already
   * subscribed to, not a second one their calendar treats as new.
   */
  it("sorts the kind filter", () => {
    expect(feedUrl(ORIGIN, TOKEN, ["trip", "meeting"])).toBe(
      feedUrl(ORIGIN, TOKEN, ["meeting", "trip"]),
    );
    expect(feedUrl(ORIGIN, TOKEN, ["trip", "meeting"])).toContain(
      "?kind=meeting,trip",
    );
  });
});

describe("publicFeedUrl", () => {
  it("points at the token-less path", () => {
    expect(publicFeedUrl(ORIGIN)).toBe(`${ORIGIN}/api/calendar/public.ics`);
  });
});

describe("webcalUrl", () => {
  /**
   * The scheme is what makes iOS and macOS offer "Subscribe to this
   * calendar?" rather than downloading a wall of iCalendar text.
   */
  it("swaps https for webcal", () => {
    expect(webcalUrl(`${ORIGIN}/api/calendar/x.ics`)).toBe(
      "webcal://ucmc.spencerwill.com/api/calendar/x.ics",
    );
  });

  it("swaps http too, for local dev", () => {
    expect(webcalUrl("http://localhost:5173/api/calendar/x.ics")).toBe(
      "webcal://localhost:5173/api/calendar/x.ics",
    );
  });

  it("leaves the path and query intact", () => {
    expect(webcalUrl(`${ORIGIN}/api/calendar/x.ics?kind=trip`)).toBe(
      "webcal://ucmc.spencerwill.com/api/calendar/x.ics?kind=trip",
    );
  });
});

describe("googleCalendarAddUrl", () => {
  /**
   * Google fetches the URL server-side, so it wants the https form —
   * handing it `webcal://` produces a calendar that never loads.
   */
  it("encodes the https url as the cid parameter", () => {
    const url = googleCalendarAddUrl(`${ORIGIN}/api/calendar/x.ics`);
    expect(url).toBe(
      "https://calendar.google.com/calendar/r?cid=https%3A%2F%2Fucmc.spencerwill.com%2Fapi%2Fcalendar%2Fx.ics",
    );
  });

  it("encodes a query string so the filter survives", () => {
    expect(
      googleCalendarAddUrl(`${ORIGIN}/api/calendar/x.ics?kind=meeting,trip`),
    ).toContain("kind%3Dmeeting%2Ctrip");
  });
});
