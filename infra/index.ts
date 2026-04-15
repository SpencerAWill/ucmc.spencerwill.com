import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

const stack = pulumi.getStack();

const cfg = new pulumi.Config();

const accountId = cfg.require("accountId");
const zoneId = cfg.require("zoneId");
const hostname = cfg.require("hostname");
const workerName = cfg.require("workerName");
const d1DatabaseName = cfg.require("d1DatabaseName");

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
