import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

import { configureOutbox } from "./outbox.ts";

const stack = pulumi.getStack();

const cfg = new pulumi.Config();

const accountId = cfg.require("accountId");
const zoneId = cfg.require("zoneId");
const hostname = cfg.require("hostname");
const workerName = cfg.require("workerName");
const d1DatabaseName = cfg.require("d1DatabaseName");
const r2BucketName = cfg.require("r2BucketName");
const r2PublicBucketName = cfg.require("r2PublicBucketName");
const cdnHostname = cfg.require("cdnHostname");
const kvNamespaceTitle = cfg.require("kvNamespaceTitle");
const webauthnRpName = cfg.require("webauthnRpName");
const resendFromName = cfg.require("resendFromName");

// D1 database for the web app. Wrangler binds to it by UUID
// (see `apps/ucmc-web/wrangler.jsonc`); the UUID is exported below and
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
// Wrangler binds by name (see `apps/ucmc-web/wrangler.jsonc`), so unlike D1 there
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

// Public R2 bucket for content that's safe to serve directly from a
// Cloudflare CDN custom domain — avatars, landing photos, future public
// media. URL bytes bypass the worker entirely, so reads don't pay any
// CPU. Anything held here is implicitly readable by anyone who has the
// URL; the private bucket above is the default for everything else.
//
// `protect: true` — same data-loss reasoning as the private bucket.
const publicBucket = new cloudflare.R2Bucket(
  `ucmc-web-${stack}-public-bucket`,
  {
    accountId,
    name: r2PublicBucketName,
    location: "enam",
  },
  { protect: true },
);

// Binds the CDN hostname to the public bucket. Cloudflare provisions
// the proxied DNS record + edge cert automatically. Setting `enabled`
// explicitly even though it's the default — the resource argument is
// required and Cloudflare's API treats undefined as enabled, so we
// state intent rather than rely on the default.
//
// `minTls: "1.2"` — refuse TLS 1.0/1.1 connections, matching modern
// Cloudflare zone defaults. Avatars are loaded by every modern browser
// over HTTPS; there's no legitimate downstream that can't do 1.2+.
const publicBucketDomain = new cloudflare.R2CustomDomain(
  `ucmc-web-${stack}-cdn`,
  {
    accountId,
    zoneId,
    bucketName: publicBucket.name,
    domain: cdnHostname,
    enabled: true,
    minTls: "1.2",
  },
);

// Workers KV namespace for the web app. Wrangler binds by namespace UUID
// (see `apps/ucmc-web/wrangler.jsonc`); the UUID is exported below and injected
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
// already static in `apps/ucmc-web/wrangler.jsonc`, so this export is for drift
// detection / reference rather than being consumed by any workflow today.
export const r2BucketNameOutput = bucket.name;

// Public R2 bucket name — same drift-detection role as the private
// bucket above. Wrangler will bind to it by name once the public binding
// lands in `apps/ucmc-web/wrangler.jsonc`.
export const r2PublicBucketNameOutput = publicBucket.name;

// CDN hostname for the public bucket. Consumed by `web-deploy.yml` and
// passed to the worker as `R2_PUBLIC_HOST` so the app can construct
// `https://${R2_PUBLIC_HOST}/<key>` URLs that bypass the worker.
export const r2PublicHost = publicBucketDomain.domain;

// KV namespace UUID — wrangler needs this for `kv_namespaces[].id`. The
// web-deploy workflow injects it into `apps/ucmc-web/wrangler.jsonc` before
// build, mirroring the D1 UUID flow.
export const kvNamespaceId = kvNamespace.id;
export const kvNamespaceTitleOutput = kvNamespace.title;

// Worker `vars` values. Single source of truth for per-env runtime config;
// `web-deploy.yml` reads them via `pulumi stack output` and passes them to
// `wrangler deploy --var`. Kept out of `wrangler.jsonc` to avoid drift
// between the hostname Pulumi binds and the hostname the app advertises
// to browsers / WebAuthn.
export const appBaseUrl = `https://${hostname}`;
// The account the worker's own resources live in. Passed to the worker
// as a `--var` so the daily cost snapshot (#268) can build Cloudflare
// API paths, which all embed it. **Not a secret** — it is an identifier,
// it appears in every dashboard URL, and it grants nothing on its own;
// the token that does is a worker secret.
export const cloudflareAccountId = accountId;
export const webauthnRpId = hostname;
export { webauthnRpName };
// Split into two vars (address + display name) rather than a composed
// `Name <email>` string. wrangler-action tokenizes the `command:` input
// on whitespace before wrangler sees it, so a value containing spaces
// or `<>` gets chopped into separate argv entries and only the prefix
// reaches the Worker — Resend then 422s because the `from` field isn't
// a valid address. Composition happens in `apps/ucmc-web/src/server/email/resend.ts`.
//
// `resendFromEmail` is exported below, read from the shared stack that
// owns the verified domain (#298).
export { resendFromName };

// The dev email outbox (#297, docs/adr/0001-dev-email-outbox.md). On
// with `emailOutbox: true` (dev only — `configureOutbox` throws on
// prod); off, all three outputs are empty strings, which the Worker
// reads as "no outbox". `deploy.yml` passes them as `--var`s.
//
// Declared before Resend because it decides whether this stack has
// Resend at all: a stack with the outbox on sends nothing, so it
// neither owns nor borrows a sending key.
const outbox = configureOutbox(cfg, { accountId, hostname, stack });
export const emailOutbox = outbox.emailOutbox;
export const accessTeamDomain = outbox.accessTeamDomain;
export const accessOutboxAud = outbox.accessOutboxAud;

// Resend sending key + from-address (#298). This stack owns no Resend
// resources: the verified sending domain, `spencerwill.com`, belongs to
// the shared infrastructure repo (SpencerAWill/spencerwill.com), which
// issues one sending-scoped key per app. Resend's free plan allows one
// verified domain per account, so it can only live in one place, and
// the place it serves several apps from is the shared one.
//
// - **A stack with the email outbox on** (dev, since #297) has no
//   Resend at all: it sends nothing. Its outputs are empty strings
//   rather than undefined, which would only produce a `will not show
//   as a stack output` warning on every `up`; `deploy.yml` reads
//   neither on a stack like this.
// - **Any other stack** must name the shared stack in `emailStack`
//   (`<org>/<project>/<stack>`) and reads `ucmcResendApiKey` and
//   `ucmcFromEmail` from it. The key is scoped to the domain, not to
//   the address, so nothing here could send as another app's address
//   that it can't already.
//
// **Apply order:** the shared stack before this one. A StackReference
// to a stack that hasn't exported these outputs fails the `up`.
const emailStack = cfg.get("emailStack");

if (outbox.emailOutbox && emailStack) {
  throw new Error(
    "emailOutbox and emailStack are exclusive: a stack whose email goes " +
      "to the outbox must not hold a sending key (#297).",
  );
}
if (!outbox.emailOutbox && !emailStack) {
  throw new Error(
    "Set emailStack (the shared stack issuing this app's Resend key, " +
      "e.g. SpencerAWill/spencerwill-shared/prod) or emailOutbox (dev " +
      "only). With neither, the Worker would have no way to send.",
  );
}

const emailRef = emailStack ? new pulumi.StackReference(emailStack) : null;

/**
 * Reads one string output from the shared stack and fails the `up` if
 * it is missing, empty or malformed. `requireOutput` only rejects
 * `undefined`, so without this an empty string or an object would be
 * uploaded to the Worker and surface as a failed sign-in email in prod
 * rather than as a failed deploy.
 */
function sharedString(
  ref: pulumi.StackReference,
  name: string,
  isValid: (value: string) => boolean,
): pulumi.Output<string> {
  return ref.requireOutput(name).apply((value: unknown) => {
    if (typeof value !== "string" || !isValid(value)) {
      throw new Error(
        `${emailStack} output \`${name}\` is missing or malformed (#298).`,
      );
    }
    return value;
  });
}

// Sending-scoped API key. Consumed by `deploy.yml` as the Worker's
// RESEND_API_KEY secret via `pulumi stack output --show-secrets`.
// Wrapped in `pulumi.secret` HERE rather than trusted to arrive as one:
// if the shared stack ever exported it plainly, the live key would sit
// unencrypted in this stack's state and print from a bare
// `pulumi stack output`.
export const resendApiKey = emailRef
  ? pulumi.secret(
      sharedString(emailRef, "ucmcResendApiKey", (key) => key.length > 0),
    )
  : pulumi.secret("");
// The envelope address, `ucmc@spencerwill.com` on prod. `deploy.yml`
// reads it WITHOUT `--show-secrets` and passes it as RESEND_FROM, so it
// is explicitly unsecreted: an address isn't a secret, and a secret
// output would reach the Worker as the literal `[secret]` and fail
// every send with a 422. The display name is `resendFromName` above.
export const resendFromEmail = emailRef
  ? pulumi.unsecret(
      sharedString(emailRef, "ucmcFromEmail", (email) =>
        /^[^\s@]+@[^\s@]+$/.test(email),
      ),
    )
  : pulumi.output("");

// Cloudflare Turnstile widget — anti-bot challenge on the sign-in form.
// Pulumi creates the widget and exports both keys; the deploy workflow
// reads them via `pulumi stack output`. The site key is public (baked
// into the client bundle at build time as VITE_TURNSTILE_SITE_KEY); the
// secret is a Worker secret (uploaded via `wrangler secret put`).
//
// `managed` mode shows an interactive challenge only when Cloudflare's
// risk score is high; most humans pass invisibly.
const turnstile = new cloudflare.TurnstileWidget(
  `ucmc-web-${stack}-turnstile`,
  {
    accountId,
    name: `ucmc-web-${stack} sign-in`,
    domains: [hostname],
    mode: "managed",
  },
);

export const turnstileSiteKey = turnstile.sitekey;
// Marked as a Pulumi secret so it's encrypted in state and masked in
// logs, matching the resendApiKey pattern.
export const turnstileSecretKey = pulumi.secret(turnstile.secret);
