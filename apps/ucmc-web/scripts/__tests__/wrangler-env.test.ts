import { applyEdits, modify, parse } from "jsonc-parser";
import type { JSONPath } from "jsonc-parser";
import { describe, expect, it } from "vitest";

// The committed file, so a binding added without teaching sync-env fails
// here rather than in the first deploy after it merges.
import committed from "../../wrangler.jsonc?raw";
import {
  parseStack,
  parseStackOutputs,
  SyncError,
  syncWranglerConfig,
} from "../wrangler-env";
import type { StackOutputs } from "../wrangler-env";

/** Shaped like `pulumi stack output --json` for each stack. */
const DEV: StackOutputs = {
  stackName: "dev",
  workerNameOutput: "ucmc-web-dev",
  d1DatabaseId: "aaaaaaaa-0000-4000-8000-000000000001",
  d1DatabaseNameOutput: "ucmc-web-dev",
  kvNamespaceId: "kv-dev-0123456789abcdef",
  r2BucketNameOutput: "ucmc-web-dev-storage",
  r2PublicBucketNameOutput: "ucmc-web-dev-public-storage",
  appBaseUrl: "https://dev.ucmc.spencerwill.com",
  webauthnRpId: "dev.ucmc.spencerwill.com",
  webauthnRpName: "UCMC (dev)",
  resendFromName: "UCMC",
  cloudflareAccountId: "account-id",
  resendFromEmail: "",
  emailOutbox: "1",
  accessTeamDomain: "team.cloudflareaccess.com",
  accessOutboxAud: "aud-tag",
};

const PROD: StackOutputs = {
  ...DEV,
  stackName: "prod",
  workerNameOutput: "ucmc-web",
  d1DatabaseId: "bbbbbbbb-0000-4000-8000-000000000002",
  d1DatabaseNameOutput: "ucmc-web",
  kvNamespaceId: "kv-prod-0123456789abcdef",
  r2BucketNameOutput: "ucmc-web-storage",
  r2PublicBucketNameOutput: "ucmc-web-public-storage",
  appBaseUrl: "https://ucmc.spencerwill.com",
  webauthnRpId: "ucmc.spencerwill.com",
  webauthnRpName: "UCMC",
  resendFromEmail: "ucmc@spencerwill.com",
  emailOutbox: "",
  accessTeamDomain: "",
  accessOutboxAud: "",
};

interface Section {
  name: string;
  vars?: Record<string, string>;
  d1_databases: { database_id: string }[];
  kv_namespaces: { id: string }[];
}
interface Config extends Section {
  env: { production: Section };
}

const read = (text: string) => parse(text) as Config;

/** The committed file with one value changed (`undefined` removes it). */
const edit = (path: JSONPath, value: unknown) =>
  applyEdits(committed, modify(committed, path, value, {}));

describe("syncWranglerConfig", () => {
  it("points the top level at dev and leaves env.production alone", () => {
    const synced = read(syncWranglerConfig(committed, "dev", DEV));
    const before = read(committed);

    expect(synced.d1_databases[0].database_id).toBe(DEV.d1DatabaseId);
    expect(synced.kv_namespaces[0].id).toBe(DEV.kvNamespaceId);
    expect(synced.vars).toEqual({
      APP_BASE_URL: "https://dev.ucmc.spencerwill.com",
      WEBAUTHN_RP_ID: "dev.ucmc.spencerwill.com",
      WEBAUTHN_RP_NAME: "UCMC (dev)",
      RESEND_FROM_NAME: "UCMC",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      EMAIL_OUTBOX: "1",
      ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      ACCESS_OUTBOX_AUD: "aud-tag",
    });
    expect(synced.env.production).toEqual(before.env.production);
  });

  it("points env.production at prod and leaves the top level alone", () => {
    const synced = read(syncWranglerConfig(committed, "prod", PROD));
    const before = read(committed);
    const prod = synced.env.production;

    expect(prod.d1_databases[0].database_id).toBe(PROD.d1DatabaseId);
    expect(prod.kv_namespaces[0].id).toBe(PROD.kvNamespaceId);
    // No outbox vars on prod: those outputs are empty there.
    expect(prod.vars).toEqual({
      APP_BASE_URL: "https://ucmc.spencerwill.com",
      WEBAUTHN_RP_ID: "ucmc.spencerwill.com",
      WEBAUTHN_RP_NAME: "UCMC",
      RESEND_FROM: "ucmc@spencerwill.com",
      RESEND_FROM_NAME: "UCMC",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
    });
    const { env: _syncedEnv, ...syncedTop } = synced;
    const { env: _beforeEnv, ...beforeTop } = before;
    expect(syncedTop).toEqual(beforeTop);
  });

  it("keeps the file's comments", () => {
    const synced = syncWranglerConfig(committed, "prod", PROD);
    const comments = (text: string) =>
      text.split("\n").filter((line) => line.trim().startsWith("//"));

    expect(comments(synced)).toEqual(comments(committed));
  });

  it("refuses outputs from the other stack", () => {
    expect(() => syncWranglerConfig(committed, "prod", DEV)).toThrow(
      /dev stack's, not prod's/,
    );
  });

  // The failure this exists for: prod's secrets once went to the dev
  // Worker because a deploy targeted the wrong section.
  it("refuses a section whose Worker name isn't the stack's", () => {
    const text = edit(["env", "production", "name"], "ucmc-web-dev");

    expect(() => syncWranglerConfig(text, "prod", PROD)).toThrow(
      /Worker name is "ucmc-web-dev" but the prod stack's is "ucmc-web"/,
    );
  });

  it("refuses a D1 database name that disagrees with the stack", () => {
    const text = edit(["d1_databases", 0, "database_name"], "ucmc-web");

    expect(() => syncWranglerConfig(text, "dev", DEV)).toThrow(
      /D1 DB's database_name/,
    );
  });

  it("refuses an R2 bucket name that disagrees with the stack", () => {
    const text = edit(
      ["env", "production", "r2_buckets", 1, "bucket_name"],
      "ucmc-web-dev-public-storage",
    );

    expect(() => syncWranglerConfig(text, "prod", PROD)).toThrow(
      /R2 BUCKET_PUBLIC's bucket_name/,
    );
  });

  it("refuses a binding it has no output for", () => {
    // Renamed in both sections, so the shape check passes and the lookup
    // is what refuses it.
    const top = edit(["kv_namespaces", 0, "binding"], "CACHE");
    const text = applyEdits(
      top,
      modify(
        top,
        ["env", "production", "kv_namespaces", 0, "binding"],
        "CACHE",
        {},
      ),
    );

    expect(() => syncWranglerConfig(text, "prod", PROD)).toThrow(
      /env\.production: no stack output for the KV binding "CACHE"/,
    );
  });

  it("refuses a top-level key it hasn't been taught", () => {
    const text = edit(["services"], []);

    expect(() => syncWranglerConfig(text, "dev", DEV)).toThrow(
      /doesn't know whether services is per stack/,
    );
  });

  it("refuses a key in env.production it hasn't been taught", () => {
    const text = edit(["env", "production", "routes"], []);

    expect(() => syncWranglerConfig(text, "dev", DEV)).toThrow(
      /env\.production: sync-env doesn't know whether routes/,
    );
  });

  it("refuses an environment it doesn't deploy", () => {
    const text = edit(["env", "staging"], { name: "ucmc-web-staging" });

    expect(() => syncWranglerConfig(text, "dev", DEV)).toThrow(
      /env\.staging isn't a stack/,
    );
  });

  // Bindings are non-inheritable: one added at the top level only would
  // leave prod running without it, and wrangler only warns.
  it("refuses a binding env.production doesn't repeat", () => {
    const text = edit(
      ["env", "production", "unsafe", "bindings", 4],
      undefined,
    );

    expect(() => syncWranglerConfig(text, "dev", DEV)).toThrow(
      /env\.production\.unsafe binds .* but the top level binds .*CEREMONY_RATE_LIMITER/,
    );
  });

  it("names the parse error in a malformed file", () => {
    expect(() => syncWranglerConfig("{ name: ", "dev", DEV)).toThrow(SyncError);
  });
});

describe("parseStackOutputs", () => {
  it("accepts a full set, with empty optional outputs", () => {
    expect(parseStackOutputs({ ...PROD, extra: 1 })).toMatchObject(PROD);
  });

  it("names every missing or empty required output", () => {
    const { d1DatabaseId: _id, ...rest } = DEV;

    expect(() => parseStackOutputs({ ...rest, appBaseUrl: "" })).toThrow(
      /d1DatabaseId \(string\), appBaseUrl \(string\)/,
    );
  });

  it("rejects an optional output that isn't a string", () => {
    expect(() => parseStackOutputs({ ...DEV, emailOutbox: true })).toThrow(
      /emailOutbox \(string\?\)/,
    );
  });

  it("rejects anything but an object", () => {
    expect(() => parseStackOutputs([])).toThrow(SyncError);
    expect(() => parseStackOutputs(null)).toThrow(SyncError);
  });
});

describe("parseStack", () => {
  it("accepts dev and prod only", () => {
    expect(parseStack("dev")).toBe("dev");
    expect(parseStack("prod")).toBe("prod");
    expect(() => parseStack("production")).toThrow(SyncError);
    expect(() => parseStack(undefined)).toThrow(SyncError);
  });
});
