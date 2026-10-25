/**
 * Thin GitHub REST + GraphQL client for site-feedback triage.
 *
 * Reads `env.SITE_FEEDBACK_GITHUB_*` inside `getGithubConfig()` only, never
 * at module scope. Every non-2xx response throws `GithubError`; callers
 * decide whether that is fatal. Text sent here attributes members by opaque
 * public id only, never name or email.
 */
import { z } from "zod";

import { env } from "#/server/cloudflare-env";
import { errorMessage, log } from "#/server/log/log.server";
import { redactString } from "#/server/log/redact.server";

const API = "https://api.github.com";
const GRAPHQL_CHUNK = 100;

export interface GithubConfig {
  token: string;
  repo: string;
}

export class GithubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GithubError";
    this.status = status;
  }
}

export function getGithubConfig(): GithubConfig | null {
  const token = env.SITE_FEEDBACK_GITHUB_TOKEN;
  const repo = env.SITE_FEEDBACK_GITHUB_REPO;
  if (!token || !repo) {
    return null;
  }
  return { token, repo };
}

function headers(cfg: GithubConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ucmc-web-site-feedback",
    "Content-Type": "application/json",
  };
}

async function request(
  cfg: GithubConfig,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: init.method,
      headers: headers(cfg),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    throw new GithubError(0, `GitHub request failed: ${errorMessage(err)}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    log.error("site_feedback.github_rejected", {
      status: res.status,
      body: redactString(text).slice(0, 500),
    });
    throw new GithubError(res.status, `GitHub responded ${res.status}`);
  }
  return res;
}

async function parse<T extends z.ZodType>(
  res: Response,
  schema: T,
): Promise<z.infer<T>> {
  const json: unknown = await res.json().catch(() => {
    throw new GithubError(res.status, "Unparseable GitHub response");
  });
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new GithubError(res.status, "Unexpected GitHub response shape");
  }
  return parsed.data;
}

const createdSchema = z.object({ number: z.number(), html_url: z.string() });

export async function createIssue(
  cfg: GithubConfig,
  input: { title: string; body: string; labels: string[] },
): Promise<{ number: number; url: string }> {
  const res = await request(cfg, `/repos/${cfg.repo}/issues`, {
    method: "POST",
    body: input,
  });
  const out = await parse(res, createdSchema);
  return { number: out.number, url: out.html_url };
}

export async function createComment(
  cfg: GithubConfig,
  number: number,
  body: string,
): Promise<void> {
  await request(cfg, `/repos/${cfg.repo}/issues/${number}/comments`, {
    method: "POST",
    body: { body },
  });
}

const issueSchema = z.object({
  number: z.number(),
  html_url: z.string(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  pull_request: z.unknown().optional(),
});

export async function getIssue(
  cfg: GithubConfig,
  number: number,
): Promise<{
  number: number;
  url: string;
  title: string;
  state: "open" | "closed";
  isPullRequest: boolean;
} | null> {
  try {
    const res = await request(cfg, `/repos/${cfg.repo}/issues/${number}`, {
      method: "GET",
    });
    const out = await parse(res, issueSchema);
    return {
      number: out.number,
      url: out.html_url,
      title: out.title,
      state: out.state,
      isPullRequest: out.pull_request !== undefined,
    };
  } catch (err) {
    if (err instanceof GithubError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

const searchSchema = z.object({ items: z.array(createdSchema) });

export async function findIssueByMarker(
  cfg: GithubConfig,
  marker: string,
): Promise<{ number: number; url: string } | null> {
  const q = `repo:${cfg.repo} is:issue in:body "${marker}"`;
  const res = await request(
    cfg,
    `/search/issues?q=${encodeURIComponent(q)}&per_page=1`,
    { method: "GET" },
  );
  const out = await parse(res, searchSchema);
  const hit = out.items.at(0);
  return hit ? { number: hit.number, url: hit.html_url } : null;
}

const graphqlSchema = z.object({
  data: z.object({
    repository: z.record(
      z.string(),
      z.object({ state: z.enum(["OPEN", "CLOSED"]) }).nullable(),
    ),
  }),
});

export async function getIssueStates(
  cfg: GithubConfig,
  numbers: readonly number[],
): Promise<Map<number, "open" | "closed" | null>> {
  const [owner, name] = cfg.repo.split("/");
  const states = new Map<number, "open" | "closed" | null>();
  for (let i = 0; i < numbers.length; i += GRAPHQL_CHUNK) {
    const chunk = numbers.slice(i, i + GRAPHQL_CHUNK);
    const fields = chunk
      .map((n) => `i${n}: issue(number: ${n}) { state }`)
      .join(" ");
    const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields} } }`;
    const res = await request(cfg, "/graphql", {
      method: "POST",
      body: { query },
    });
    const out = await parse(res, graphqlSchema);
    for (const n of chunk) {
      const node = out.data.repository[`i${n}`];
      states.set(
        n,
        node ? (node.state === "CLOSED" ? "closed" : "open") : null,
      );
    }
  }
  return states;
}
