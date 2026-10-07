/**
 * The one place server code calls `console.*`.
 *
 * Workers Logs is the transport, not a library: `wrangler.jsonc` sets
 * `observability.enabled` with `head_sampling_rate: 1` in both
 * environments, and the platform ingests `console.*` directly — the
 * method name becomes the level, and an object passed as the second
 * argument becomes queryable fields in the dashboard. A logging library
 * here would resolve to a console shim and cost bundle size for
 * behaviour the platform already provides, which is why there isn't
 * one.
 *
 * What this module adds over bare `console.*`:
 *
 *   - **One `eslint-disable no-console`** instead of the four that were
 *     scattered across call sites, and one place to change if the
 *     transport ever does.
 *   - **Levels with a runtime threshold**, so `log.debug` lines can
 *     live in the code permanently and stay out of production logs.
 *   - **Ambient context**, so a request's Ray ID lands on every line
 *     without being threaded through every function that might log.
 *   - **Redaction by default** on error messages (`errorMessage`).
 *
 * **Event names are `namespace.event_in_snake_case`** —
 * `retention.sweep_failed`, `feedback.github_mirror_rejected`. They are
 * what you filter on in the dashboard, so they are stable identifiers,
 * not prose. The message goes in the fields.
 *
 * **Fields carry non-PII context only**, the same discipline the audit
 * log keeps. Anything that might hold user data goes through
 * `redact.server.ts` first.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { env } from "#/server/cloudflare-env";
import { redactString } from "#/server/log/redact.server";

/** Structured context for a log line. Non-PII; see the module note. */
export type LogFields = Record<string, unknown>;

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Lines below the threshold are dropped. Default `info`, so `log.debug`
 * is free to leave in place.
 *
 * `LOG_LEVEL` is an optional var — unset everywhere today, which is the
 * point: it can be set on a deployed worker to turn debug on for an
 * incident without a code change. Resolved lazily and memoised because
 * reading a binding at module scope breaks the client build (see
 * CLAUDE.md), and defensively because `env` is not readable in every
 * context this module might be imported from.
 */
const threshold: { rank?: number } = {};

function thresholdRank(): number {
  if (threshold.rank === undefined) {
    const configured = readConfiguredLevel();
    threshold.rank = LEVEL_RANK[configured];
  }
  return threshold.rank;
}

function readConfiguredLevel(): LogLevel {
  try {
    const raw = env.LOG_LEVEL;
    if (raw && raw in LEVEL_RANK) {
      return raw as LogLevel;
    }
  } catch {
    // No binding context (module init, a unit test outside workerd).
    // `info` is the right answer there too.
  }
  return "info";
}

/**
 * Ambient fields merged into every line logged inside `runWithLogContext`.
 *
 * `AsyncLocalStorage` survives an `await` in workerd under
 * `nodejs_compat` — verified, not assumed. Without it the alternative is
 * passing a request id down through every call that might log, which is
 * why four of the call sites this replaced had no correlatable context
 * at all.
 */
const logContext = new AsyncLocalStorage<LogFields>();

/**
 * Run `fn` with `fields` attached to every line it logs, directly or
 * through anything it awaits. Nests: an inner call merges onto the
 * outer store rather than replacing it.
 */
export function runWithLogContext<T>(fields: LogFields, fn: () => T): T {
  return logContext.run({ ...logContext.getStore(), ...fields }, fn);
}

/**
 * An `unknown` from a `catch`, as a string that is safe to log.
 *
 * Always redacted. The structured call sites this replaced logged
 * `err.message` raw, which is fine until the error is a D1 constraint
 * violation echoing the row, or a fetch failure carrying a URL with a
 * token in its query string — both are what `redactString` exists for.
 */
export function errorMessage(err: unknown): string {
  return redactString(err instanceof Error ? err.message : String(err));
}

function emit(level: LogLevel, event: string, fields: LogFields): void {
  if (LEVEL_RANK[level] < thresholdRank()) {
    return;
  }
  const line = { ...logContext.getStore(), ...fields };
  // The single sanctioned `console.*` call site in server code.
  // The level maps to the same-named method: Workers Logs derives the
  // line's level from it, and workerd implements all four (verified in
  // `__tests__/log.test.ts`, because `console.debug` is the one people
  // assume is missing).
  // eslint-disable-next-line no-console
  console[level](event, line);
}

/**
 * Structured server logging. `log.error("feedback.mirror_failed", {...})`.
 *
 * Exported as one object rather than four functions on purpose: it is a
 * single API surface, and four separate exports would leave the
 * currently-unused levels as dead exports for knip to report.
 */
export const log = {
  debug: (event: string, fields: LogFields = {}) =>
    emit("debug", event, fields),
  info: (event: string, fields: LogFields = {}) => emit("info", event, fields),
  warn: (event: string, fields: LogFields = {}) => emit("warn", event, fields),
  error: (event: string, fields: LogFields = {}) =>
    emit("error", event, fields),
};
