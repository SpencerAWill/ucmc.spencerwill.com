import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

const stack = pulumi.getStack();

const cfg = new pulumi.Config();

const accountId = cfg.require("accountId");
const zoneId = cfg.require("zoneId");
const hostname = cfg.require("hostname");
const workerName = cfg.require("workerName");
const d1DatabaseName = cfg.require("d1DatabaseName");
const webauthnRpName = cfg.require("webauthnRpName");
const resendFromName = cfg.require("resendFromName");

// D1 database for the web app. Wrangler references it by UUID in
// `apps/web/wrangler.jsonc`; the UUID is surfaced below as a stack output and
// must be pasted into that file after first `pulumi up` in a new stack.
//
// `protect: true` — replacing a D1 DB wipes all data. If we ever need to
// recreate this resource, remove the protection deliberately via
// `pulumi state` and accept the data loss.
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

// D1 database UUID — the value wrangler needs for its `d1_databases[].database_id`.
export const d1DatabaseId = database.uuid;

// Worker `vars` values. These are the single source of truth for per-env
// runtime config; `web-deploy.yml` reads them via `pulumi stack output` and
// passes them to `wrangler deploy --var`. Kept out of `wrangler.jsonc` to
// avoid drift between the hostname Pulumi binds and the hostname the app
// advertises to browsers / WebAuthn.
export const appBaseUrl = `https://${hostname}`;
export const webauthnRpId = hostname;
export { webauthnRpName };
export const resendFrom = `${resendFromName} <noreply@${hostname}>`;
