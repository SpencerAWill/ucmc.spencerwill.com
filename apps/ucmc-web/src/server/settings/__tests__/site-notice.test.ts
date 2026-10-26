/**
 * Who sees the site notice. This is the whole audience policy: the server
 * read applies it before anything leaves the worker, so a members-only
 * notice never reaches a signed-out browser — not in the HTML, not in the
 * dehydrated query cache.
 *
 * Pure, so it is also in Stryker's `mutate` list.
 */
import { describe, expect, it } from "vitest";

import { siteNoticeQueryKey } from "#/features/settings/api/query-keys";
import {
  noticeViewerOf,
  resolveSiteNotice,
} from "#/server/settings/site-notice";
import type {
  NoticeAudience,
  NoticeViewer,
} from "#/server/settings/site-notice";

const tone = "warning" as const;

function settings(
  enabled: boolean,
  text: string,
  audience: NoticeAudience,
): Parameters<typeof resolveSiteNotice>[0] {
  return { enabled, text, audience, tone };
}

describe("resolveSiteNotice", () => {
  it.each<[boolean, string, NoticeAudience, NoticeViewer]>([
    [false, "Hi", "public", "approved"],
    [true, "", "public", "approved"],
    [true, " ", "public", "anonymous"],
    [true, "\t\n ", "members", "approved"],
    [true, "Hi", "members", "anonymous"],
    [true, "Hi", "members", "pending"],
  ])(
    "shows nothing when enabled=%s text=%j audience=%s viewer=%s",
    (enabled, text, audience, viewer) => {
      expect(
        resolveSiteNotice(settings(enabled, text, audience), viewer),
      ).toBeNull();
    },
  );

  it("shows a members notice to an approved member", () => {
    expect(
      resolveSiteNotice(settings(true, "Hi", "members"), "approved"),
    ).toEqual({ text: "Hi", tone });
  });

  it.each<NoticeViewer>(["anonymous", "pending", "approved"])(
    "shows a public notice to %s",
    (viewer) => {
      expect(resolveSiteNotice(settings(true, "Hi", "public"), viewer)).toEqual(
        { text: "Hi", tone },
      );
    },
  );

  it("trims the text it hands back", () => {
    expect(
      resolveSiteNotice(settings(true, "  Gear due  ", "public"), "anonymous"),
    ).toEqual({ text: "Gear due", tone });
  });

  it("passes the tone through", () => {
    expect(
      resolveSiteNotice(
        { enabled: true, text: "Hi", audience: "public", tone: "danger" },
        "anonymous",
      ),
    ).toEqual({ text: "Hi", tone: "danger" });
  });
});

describe("noticeViewerOf", () => {
  it("is anonymous when signed out", () => {
    expect(noticeViewerOf(null)).toBe("anonymous");
  });

  it("is approved only for an approved principal", () => {
    expect(noticeViewerOf({ status: "approved" })).toBe("approved");
  });

  it.each(["pending", "deactivated", "rejected", "unclaimed"])(
    "treats a %s principal as not a member",
    (status) => {
      expect(noticeViewerOf({ status })).toBe("pending");
    },
  );
});

describe("siteNoticeQueryKey", () => {
  it("differs per viewer, so signing in or out re-keys the banner", () => {
    expect(siteNoticeQueryKey("anonymous")).not.toEqual(
      siteNoticeQueryKey("approved"),
    );
    expect(siteNoticeQueryKey("pending")).not.toEqual(
      siteNoticeQueryKey("approved"),
    );
  });

  it("sits under the site-settings prefix a setting write invalidates", () => {
    expect(siteNoticeQueryKey("approved").slice(0, 1)).toEqual([
      "site-settings",
    ]);
  });
});
