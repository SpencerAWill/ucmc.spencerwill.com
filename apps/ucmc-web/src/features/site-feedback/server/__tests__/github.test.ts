import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import {
  GithubError,
  createComment,
  createIssue,
  findIssueByMarker,
  getGithubConfig,
  getIssue,
  getIssueStates,
} from "#/features/site-feedback/server/github.server";
import { env } from "#/server/cloudflare-env";

const cfg = { token: "tok", repo: "o/r" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getGithubConfig", () => {
  it("returns null when either env var is unset", () => {
    const priorToken = env.SITE_FEEDBACK_GITHUB_TOKEN;
    const priorRepo = env.SITE_FEEDBACK_GITHUB_REPO;
    try {
      delete env.SITE_FEEDBACK_GITHUB_TOKEN;
      env.SITE_FEEDBACK_GITHUB_REPO = "o/r";
      expect(getGithubConfig()).toBeNull();
      env.SITE_FEEDBACK_GITHUB_TOKEN = "t";
      delete env.SITE_FEEDBACK_GITHUB_REPO;
      expect(getGithubConfig()).toBeNull();
      env.SITE_FEEDBACK_GITHUB_REPO = "o/r";
      expect(getGithubConfig()).toEqual({ token: "t", repo: "o/r" });
    } finally {
      if (priorToken === undefined) {
        delete env.SITE_FEEDBACK_GITHUB_TOKEN;
      } else {
        env.SITE_FEEDBACK_GITHUB_TOKEN = priorToken;
      }
      if (priorRepo === undefined) {
        delete env.SITE_FEEDBACK_GITHUB_REPO;
      } else {
        env.SITE_FEEDBACK_GITHUB_REPO = priorRepo;
      }
    }
  });
});

describe("createIssue", () => {
  it("posts title, body and labels and returns number and url", async () => {
    fetchSpy.mockResolvedValue(
      json({ number: 7, html_url: "https://github.com/o/r/issues/7" }, 201),
    );
    const out = await createIssue(cfg, {
      title: "T",
      body: "member usr_abc123 reported",
      labels: ["bug", "feedback"],
    });
    expect(out).toEqual({
      number: 7,
      url: "https://github.com/o/r/issues/7",
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/o/r/issues");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(headers["User-Agent"]).toBe("ucmc-web-site-feedback");
    expect(JSON.parse(init.body as string)).toEqual({
      title: "T",
      body: "member usr_abc123 reported",
      labels: ["bug", "feedback"],
    });
    expect(init.body as string).not.toContain("@");
  });

  it("throws GithubError carrying the status on a 422", async () => {
    fetchSpy.mockResolvedValue(json({ message: "Validation Failed" }, 422));
    const err = await createIssue(cfg, {
      title: "T",
      body: "B",
      labels: [],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect((err as GithubError).status).toBe(422);
  });
});

describe("createComment", () => {
  it("posts the body to the issue's comments", async () => {
    fetchSpy.mockResolvedValue(json({ id: 1 }, 201));
    await createComment(cfg, 7, "hello");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/o/r/issues/7/comments");
    expect(JSON.parse(init.body as string)).toEqual({ body: "hello" });
  });
});

describe("getIssue", () => {
  it("flags pull requests", async () => {
    fetchSpy.mockResolvedValue(
      json({
        number: 3,
        html_url: "https://github.com/o/r/pull/3",
        title: "PR",
        state: "open",
        pull_request: { url: "x" },
      }),
    );
    expect(await getIssue(cfg, 3)).toEqual({
      number: 3,
      url: "https://github.com/o/r/pull/3",
      title: "PR",
      state: "open",
      isPullRequest: true,
    });
  });

  it("returns a plain issue as not a pull request", async () => {
    fetchSpy.mockResolvedValue(
      json({
        number: 4,
        html_url: "u",
        title: "I",
        state: "closed",
      }),
    );
    const out = await getIssue(cfg, 4);
    expect(out?.isPullRequest).toBe(false);
    expect(out?.state).toBe("closed");
  });

  it("returns null on 404", async () => {
    fetchSpy.mockResolvedValue(json({ message: "Not Found" }, 404));
    expect(await getIssue(cfg, 99)).toBeNull();
  });
});

describe("findIssueByMarker", () => {
  it("searches by marker and returns the first hit", async () => {
    fetchSpy.mockResolvedValue(
      json({ items: [{ number: 5, html_url: "https://x/5" }] }),
    );
    const out = await findIssueByMarker(cfg, "<!-- ucmc:sfi_1 -->");
    expect(out).toEqual({ number: 5, url: "https://x/5" });
    const [url] = fetchSpy.mock.calls[0] as [string];
    const q = new URL(url).searchParams.get("q");
    expect(q).toBe('repo:o/r is:issue in:body "<!-- ucmc:sfi_1 -->"');
  });

  it("returns null when nothing matches", async () => {
    fetchSpy.mockResolvedValue(json({ items: [] }));
    expect(await findIssueByMarker(cfg, "m")).toBeNull();
  });
});

describe("getIssueStates", () => {
  it("chunks at 100 and maps states", async () => {
    fetchSpy.mockImplementation((_url, init) => {
      const query = (
        JSON.parse((init as RequestInit).body as string) as {
          query: string;
        }
      ).query;
      const aliases = [...query.matchAll(/i(\d+): issue/g)].map((m) =>
        Number(m[1]),
      );
      const repository: Record<string, { state: string } | null> = {};
      for (const n of aliases) {
        repository[`i${n}`] =
          n === 2 ? null : { state: n === 1 ? "CLOSED" : "OPEN" };
      }
      return Promise.resolve(json({ data: { repository } }));
    });
    const numbers = Array.from({ length: 150 }, (_, i) => i + 1);
    const out = await getIssueStates(cfg, numbers);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(out.size).toBe(150);
    expect(out.get(1)).toBe("closed");
    expect(out.get(2)).toBeNull();
    expect(out.get(150)).toBe("open");
  });

  it("makes no request for an empty list", async () => {
    expect((await getIssueStates(cfg, [])).size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
