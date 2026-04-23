import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

import { ResendDomain } from "./resend.js";

const stack = pulumi.getStack();

const cfg = new pulumi.Config();

const accountId = cfg.require("accountId");
const zoneId = cfg.require("zoneId");
const hostname = cfg.require("hostname");
const workerName = cfg.require("workerName");
const d1DatabaseName = cfg.require("d1DatabaseName");
const r2BucketName = cfg.require("r2BucketName");
const kvNamespaceTitle = cfg.require("kvNamespaceTitle");
const webauthnRpName = cfg.require("webauthnRpName");
const resendFromName = cfg.require("resendFromName");
// Provider credential — authenticates against the Resend API during
// `pulumi up`. Supplied via env var (from GitHub environment secrets in
// CI, or `export` locally), matching how CLOUDFLARE_API_TOKEN works.
const resendManagementApiKey = pulumi.secret(
  process.env.RESEND_MANAGEMENT_API_KEY ?? "",
);

// D1 database for the web app. Wrangler binds to it by UUID
// (see `apps/web/wrangler.jsonc`); the UUID is exported below and
// injected into the wrangler config by the web-deploy workflow.
//
// `protect: true` — replacing a D1 database wipes all data. To
// recreate, remove the protection deliberately via `pulumi state`
// and accept the data loss.
const database = new cloudflare.D1Database(
  `ucmc-web-${stack}-db`,
  {
    accountId,
    name: d1DatabaseName,
    // Eastern North America — close to Cincinnati.
    primaryLocationHint: "enam",
  },
  { protect: true },
);

// R2 bucket for user-uploaded content (trip photos, profile images, etc.).
// Wrangler binds by name (see `apps/web/wrangler.jsonc`), so unlike D1 there
// is no UUID to inject at deploy time.
//
// `protect: true` — replacing an R2 bucket deletes every object in it. To
// recreate, remove the protection deliberately via `pulumi state` and
// accept the data loss.
const bucket = new cloudflare.R2Bucket(
  `ucmc-web-${stack}-bucket`,
  {
    accountId,
    name: r2BucketName,
    // Eastern North America — close to Cincinnati.
    location: "enam",
  },
  { protect: true },
);

// Workers KV namespace for the web app. Wrangler binds by namespace UUID
// (see `apps/web/wrangler.jsonc`); the UUID is exported below and injected
// into the wrangler config by the web-deploy workflow, mirroring D1.
//
// KV is globally replicated — no regional placement hint.
//
// `protect: true` — replacing a KV namespace deletes every key. To
// recreate, remove the protection deliberately via `pulumi state` and
// accept the data loss.
const kvNamespace = new cloudflare.WorkersKvNamespace(
  `ucmc-web-${stack}-kv`,
  {
    accountId,
    title: kvNamespaceTitle,
  },
  { protect: true },
);

// Binds the custom hostname to the Worker script. Cloudflare implicitly
// manages the proxied DNS record and edge cert for this hostname. The
// Worker script itself must already exist (uploaded by `wrangler deploy`)
// before this resource can be created.
const workerDomain = new cloudflare.WorkersCustomDomain(
  `ucmc-web-${stack}-domain`,
  {
    accountId,
    zoneId,
    hostname,
    service: workerName,
  },
);

export const stackName = stack;
export const workerHostname = workerDomain.hostname;

// D1 database UUID — the value wrangler needs for `d1_databases[].database_id`.
// Pulumi's D1Database exposes both `.id` (Pulumi URN) and `.uuid` (the
// Cloudflare database identifier). Wrangler wants the UUID.
export const d1DatabaseId = database.uuid;
export const d1DatabaseNameOutput = database.name;

// R2 bucket name — wrangler binds by name (not UUID), and the value is
// already static in `apps/web/wrangler.jsonc`, so this export is for drift
// detection / reference rather than being consumed by any workflow today.
export const r2BucketNameOutput = bucket.name;

// KV namespace UUID — wrangler needs this for `kv_namespaces[].id`. The
// web-deploy workflow injects it into `apps/web/wrangler.jsonc` before
// build, mirroring the D1 UUID flow.
export const kvNamespaceId = kvNamespace.id;
export const kvNamespaceTitleOutput = kvNamespace.title;

// Worker `vars` values. Single source of truth for per-env runtime config;
// `web-deploy.yml` reads them via `pulumi stack output` and passes them to
// `wrangler deploy --var`. Kept out of `wrangler.jsonc` to avoid drift
// between the hostname Pulumi binds and the hostname the app advertises
// to browsers / WebAuthn.
export const appBaseUrl = `https://${hostname}`;
export const webauthnRpId = hostname;
export { webauthnRpName };
export const resendFrom = `${resendFromName} <noreply@${hostname}>`;

// Resend sending domain + DNS records + sending-scoped API key. The
// component handles domain creation, DNS record provisioning in the
// Cloudflare zone defined above, verification trigger, and issuance of
// a token with `sending_access` permission scoped to this domain.
//
// `protect: true` — replacing a Resend domain re-issues DKIM keys and
// invalidates previously-sent signatures; replacing the API key
// invalidates any reference to the prior token. Remove protection
// deliberately via `pulumi state` if a real rotation is needed.
const resend = new ResendDomain(
  `ucmc-web-${stack}-resend`,
  {
    domainName: hostname,
    resendApiKey: resendManagementApiKey,
    cloudflareZoneId: zoneId,
    apiKeyName: `ucmc-web-${stack}-sending`,
  },
  { protect: true },
);

export const resendDomainId = resend.domainId;
export const resendApiKeyId = resend.apiKeyId;
// Sending-scoped API key. Consumed by `web-deploy.yml` as the Worker's
// RESEND_API_KEY secret via `pulumi stack output --show-secrets`.
export const resendApiKey = resend.apiKeyToken;
