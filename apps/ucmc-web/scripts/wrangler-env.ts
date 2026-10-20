/**
 * Rewrites `wrangler.jsonc` for one Pulumi stack (`sync-env.ts`, #312).
 *
 * The committed config carries placeholder D1 and KV ids, which is all
 * local development needs: Miniflare keys on the binding name. A deploy
 * points ONE section at the stack — the top level for `dev`,
 * `env.production` for `prod` — from the stack's outputs:
 *
 *   - D1 `database_id` and KV `id`, the two values Cloudflare generates.
 *   - Worker `vars`, which used to be `--var` flags on `wrangler deploy`.
 *     Written into the config instead, they're part of the build's
 *     flattened `dist/server/wrangler.json`, and a value with spaces
 *     (`UCMC (dev)`) is no longer at the mercy of a shell tokenizer.
 *
 * and CHECKS, rather than rewrites, what the program and this file must
 * already agree on: the Worker `name`, the D1 database name and the two
 * R2 bucket names. A mismatch there is drift between two committed
 * files, and deploying through it would bind one stack's Worker to the
 * other's resources.
 *
 * It fails closed. The `sed` it replaces was a silent no-op if a
 * placeholder was renamed; here a binding it doesn't know, a top-level or
 * section key it hasn't been taught, or a binding `env.production` forgot
 * to repeat (bindings are non-inheritable, so prod would quietly run
 * without it) is an error. Teach it here when adding a binding.
 *
 * Wrangler environments stay (rather than one config rewritten wholesale
 * per stack): they're Cloudflare's documented model for persistent
 * environments, the Vite plugin selects one at build time with
 * `CLOUDFLARE_ENV`, and the built config records that target, so every
 * later `wrangler` command in the job refuses a different `--env`.
 *
 * Edits go through jsonc-parser, so comments and formatting survive.
 */
import { applyEdits, modify, parse, printParseErrorCode } from "jsonc-parser";
import type { FormattingOptions, JSONPath, ParseError } from "jsonc-parser";

export type Stack = "dev" | "prod";

export const STACKS: readonly Stack[] = ["dev", "prod"];

/** The `wrangler.jsonc` section each stack deploys from. */
const SECTION: Record<Stack, JSONPath> = {
  dev: [],
  prod: ["env", "production"],
};

/**
 * The Pulumi outputs (`infra/cloudflare/index.ts`) a deploy reads. Secret
 * outputs are absent on purpose: `pulumi stack output --json` prints them
 * as `[secret]`, and the deploy action reads them separately into the
 * secrets file.
 */
export interface StackOutputs {
  readonly stackName: string;
  readonly workerNameOutput: string;
  readonly d1DatabaseId: string;
  readonly d1DatabaseNameOutput: string;
  readonly kvNamespaceId: string;
  readonly r2BucketNameOutput: string;
  readonly r2PublicBucketNameOutput: string;
  readonly appBaseUrl: string;
  readonly webauthnRpId: string;
  readonly webauthnRpName: string;
  readonly resendFromName: string;
  readonly cloudflareAccountId: string;
  /** Empty on a stack using the outbox (dev). */
  readonly resendFromEmail: string;
  /** Empty on a stack without the outbox (prod). */
  readonly emailOutbox: string;
  readonly accessTeamDomain: string;
  readonly accessOutboxAud: string;
}

/** `string?` may be an empty string (a stack without that feature). */
const OUTPUT_KEYS = {
  stackName: "string",
  workerNameOutput: "string",
  d1DatabaseId: "string",
  d1DatabaseNameOutput: "string",
  kvNamespaceId: "string",
  r2BucketNameOutput: "string",
  r2PublicBucketNameOutput: "string",
  appBaseUrl: "string",
  webauthnRpId: "string",
  webauthnRpName: "string",
  resendFromName: "string",
  cloudflareAccountId: "string",
  resendFromEmail: "string?",
  emailOutbox: "string?",
  accessTeamDomain: "string?",
  accessOutboxAud: "string?",
} as const satisfies Record<keyof StackOutputs, "string" | "string?">;

/**
 * Worker vars, by name. One whose output is empty is left out, so prod
 * gets no outbox vars and dev no RESEND_FROM — the same set the `--var`
 * flags passed. `wrangler deploy` replaces the Worker's vars with exactly
 * these.
 */
const VARS: Record<string, (o: StackOutputs) => string> = {
  APP_BASE_URL: (o) => o.appBaseUrl,
  WEBAUTHN_RP_ID: (o) => o.webauthnRpId,
  WEBAUTHN_RP_NAME: (o) => o.webauthnRpName,
  RESEND_FROM: (o) => o.resendFromEmail,
  RESEND_FROM_NAME: (o) => o.resendFromName,
  CLOUDFLARE_ACCOUNT_ID: (o) => o.cloudflareAccountId,
  EMAIL_OUTBOX: (o) => o.emailOutbox,
  ACCESS_TEAM_DOMAIN: (o) => o.accessTeamDomain,
  ACCESS_OUTBOX_AUD: (o) => o.accessOutboxAud,
};

/** D1 bindings: the committed name to check, the generated id to write. */
const D1: Record<string, (o: StackOutputs) => { name: string; id: string }> = {
  DB: (o) => ({ name: o.d1DatabaseNameOutput, id: o.d1DatabaseId }),
};

const KV: Record<string, (o: StackOutputs) => string> = {
  KV: (o) => o.kvNamespaceId,
};

/** R2 binds by name, so there is nothing to write, only drift to catch. */
const R2: Record<string, (o: StackOutputs) => string> = {
  BUCKET_PRIVATE: (o) => o.r2BucketNameOutput,
  BUCKET_PUBLIC: (o) => o.r2PublicBucketNameOutput,
};

/**
 * Keys whose meaning per stack is settled. Anything else (`services`,
 * `queues`, `durable_objects`, a new env) stops the sync until someone
 * decides how it maps. `unsafe` holds the rate limiters, whose namespace
 * ids are committed per section and aren't stack outputs.
 */
const BINDING_KEYS = [
  "d1_databases",
  "kv_namespaces",
  "r2_buckets",
  "unsafe",
] as const;
const SECTION_KEYS = new Set<string>([
  "name",
  "observability",
  "triggers",
  "vars",
  ...BINDING_KEYS,
]);
const TOP_LEVEL_KEYS = new Set<string>([
  ...SECTION_KEYS,
  "$schema",
  "compatibility_date",
  "compatibility_flags",
  "main",
  "workers_dev",
  "preview_urls",
  "env",
]);
const ENVIRONMENTS = new Set(["production"]);

const FORMATTING: FormattingOptions = { insertSpaces: true, tabSize: 2 };

interface Section {
  readonly [key: string]: unknown;
  readonly name?: unknown;
  readonly d1_databases?: readonly {
    binding: string;
    database_name: string;
  }[];
  readonly kv_namespaces?: readonly { binding: string }[];
  readonly r2_buckets?: readonly { binding: string; bucket_name: string }[];
  readonly unsafe?: { readonly bindings?: readonly { name: string }[] };
  readonly env?: Readonly<Record<string, Section>>;
}

export class SyncError extends Error {
  override name = "SyncError";
}

/** The binding names a section declares under one key. */
function bindingNames(
  section: Section,
  key: (typeof BINDING_KEYS)[number],
): string[] {
  if (key === "unsafe") {
    return (section.unsafe?.bindings ?? []).map((b) => b.name);
  }
  return (section[key] ?? []).map((b) => b.binding);
}

/**
 * Structural checks on the whole file, independent of the stack: only
 * known keys, and every top-level binding repeated in each environment.
 */
function checkShape(config: Section): void {
  const unknownTop = Object.keys(config).filter((k) => !TOP_LEVEL_KEYS.has(k));
  if (unknownTop.length > 0) {
    throw new SyncError(
      `sync-env doesn't know whether ${unknownTop.join(", ")} is per stack. Teach scripts/wrangler-env.ts.`,
    );
  }
  for (const [envName, section] of Object.entries(config.env ?? {})) {
    if (!ENVIRONMENTS.has(envName)) {
      throw new SyncError(
        `env.${envName} isn't a stack sync-env deploys. Teach scripts/wrangler-env.ts.`,
      );
    }
    const unknown = Object.keys(section).filter((k) => !SECTION_KEYS.has(k));
    if (unknown.length > 0) {
      throw new SyncError(
        `env.${envName}: sync-env doesn't know whether ${unknown.join(", ")} is per stack. Teach scripts/wrangler-env.ts.`,
      );
    }
    for (const key of BINDING_KEYS) {
      const top = bindingNames(config, key).sort();
      const env = bindingNames(section, key).sort();
      if (top.join() !== env.join()) {
        throw new SyncError(
          `env.${envName}.${key} binds [${env.join(", ")}] but the top level binds [${top.join(", ")}]. Bindings don't inherit: repeat each one in every environment.`,
        );
      }
    }
  }
}

/** `text` (wrangler.jsonc) with `stack`'s section pointed at `outputs`. */
export function syncWranglerConfig(
  text: string,
  stack: Stack,
  outputs: StackOutputs,
): string {
  const errors: ParseError[] = [];
  const config = parse(text, errors, { allowTrailingComma: true }) as Section;
  if (errors.length > 0) {
    const codes = errors.map(
      (e) => `${printParseErrorCode(e.error)} at ${e.offset}`,
    );
    throw new SyncError(`wrangler.jsonc doesn't parse: ${codes.join(", ")}`);
  }
  if (outputs.stackName !== stack) {
    throw new SyncError(
      `The outputs are the ${outputs.stackName} stack's, not ${stack}'s.`,
    );
  }
  checkShape(config);

  const path = SECTION[stack];
  const where = path.length === 0 ? "top level" : path.join(".");
  const section = path.reduce<Section | undefined>(
    (node, key) => node?.[key] as Section | undefined,
    config,
  );
  if (section === undefined) {
    throw new SyncError(`wrangler.jsonc has no ${where} section for ${stack}.`);
  }

  const mismatch = (what: string, committed: unknown, expected: string) =>
    new SyncError(
      `${where}: ${what} is "${String(committed)}" but the ${stack} stack's is "${expected}". wrangler.jsonc and infra/cloudflare disagree.`,
    );
  const lookup = <T>(
    table: Record<string, (o: StackOutputs) => T>,
    binding: string,
    what: string,
  ): T => {
    // `Object.hasOwn`, not a bare index: a binding named `toString` or
    // `constructor` would otherwise find Object.prototype's function and
    // slip past the "untaught binding" refusal.
    const map = Object.hasOwn(table, binding) ? table[binding] : undefined;
    if (!map) {
      throw new SyncError(
        `${where}: no stack output for the ${what} binding "${binding}". Teach scripts/wrangler-env.ts.`,
      );
    }
    return map(outputs);
  };

  if (section.name !== outputs.workerNameOutput) {
    throw mismatch("the Worker name", section.name, outputs.workerNameOutput);
  }

  const changes: [JSONPath, string][] = [];
  section.d1_databases?.forEach((db, i) => {
    const target = lookup(D1, db.binding, "D1");
    if (db.database_name !== target.name) {
      throw mismatch(
        `D1 ${db.binding}'s database_name`,
        db.database_name,
        target.name,
      );
    }
    changes.push([[...path, "d1_databases", i, "database_id"], target.id]);
  });
  section.kv_namespaces?.forEach((kv, i) => {
    changes.push([
      [...path, "kv_namespaces", i, "id"],
      lookup(KV, kv.binding, "KV"),
    ]);
  });
  section.r2_buckets?.forEach((bucket) => {
    const expected = lookup(R2, bucket.binding, "R2");
    if (bucket.bucket_name !== expected) {
      throw mismatch(
        `R2 ${bucket.binding}'s bucket_name`,
        bucket.bucket_name,
        expected,
      );
    }
  });
  for (const [name, map] of Object.entries(VARS)) {
    const value = map(outputs);
    if (value !== "") {
      changes.push([[...path, "vars", name], value]);
    }
  }

  return changes.reduce(
    (result, [at, value]) =>
      applyEdits(
        result,
        modify(result, at, value, { formattingOptions: FORMATTING }),
      ),
    text,
  );
}

const SECRET_PLACEHOLDER = "[secret]";

/**
 * Validates `pulumi stack output --json`, naming every missing, empty
 * (where required) or secret output.
 */
export function parseStackOutputs(json: unknown): StackOutputs {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new SyncError(
      "Stack outputs must be a JSON object (pulumi stack output --json).",
    );
  }
  const record = json as Record<string, unknown>;
  const problems = Object.entries(OUTPUT_KEYS)
    .filter(([key, type]) => {
      const value = record[key];
      if (typeof value !== "string") {
        return true;
      }
      // `pulumi stack output --json` prints a secret output as this
      // literal. Deployed as a var it would reach the Worker as the
      // string "[secret]" (a RESEND_FROM that 422s every send, #298).
      if (value === SECRET_PLACEHOLDER) {
        return true;
      }
      return type === "string" && value === "";
    })
    .map(([key, type]) => `${key} (${type})`);
  if (problems.length > 0) {
    throw new SyncError(
      `Stack outputs are missing, malformed or secret: ${problems.join(", ")}`,
    );
  }
  return record as unknown as StackOutputs;
}

export function parseStack(value: string | undefined): Stack {
  const stack = STACKS.find((s) => s === value);
  if (!stack) {
    throw new SyncError(`--stack must be one of ${STACKS.join(", ")}.`);
  }
  return stack;
}
