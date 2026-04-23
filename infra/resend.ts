import * as command from "@pulumi/command";
import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

import { fileURLToPath } from "node:url";
import * as path from "node:path";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "scripts",
  "resend.mjs",
);

interface ResendRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl?: string | number;
  priority?: number;
  status?: string;
}

interface CreateDomainOutput {
  id: string;
  records: ResendRecord[];
}

export interface ResendDomainArgs {
  /** FQDN to register in Resend (e.g. "dev.ucmc.spencerwill.com"). */
  domainName: pulumi.Input<string>;
  /** Management API key (full_access) used to call the Resend API. */
  resendApiKey: pulumi.Input<string>;
  /** Cloudflare zone that owns `domainName`. */
  cloudflareZoneId: pulumi.Input<string>;
  /** Name for the sending API key that scopes to this domain. */
  apiKeyName: pulumi.Input<string>;
}

/**
 * Provisions a Resend sending domain with DNS records in Cloudflare and a
 * sending-scoped API key, all wired together so `pulumi up` leaves the
 * domain in a verifying/verified state with a usable token.
 *
 * Implementation uses `@pulumi/command` rather than a dynamic provider
 * because Pulumi's dynamic providers are incompatible with pnpm
 * (pulumi/pulumi#9085). The Resend API calls themselves live in
 * `scripts/resend.mjs`; this component wires the command outputs into
 * Cloudflare DNS records managed as first-class Pulumi resources.
 *
 * Record shape assumption: Resend returns three DNS records for a default
 * sending-only domain — one MX (return-path), one TXT (SPF), one TXT
 * (DKIM). If Resend changes this shape, the apply() callbacks below will
 * throw and the code must be updated.
 */
export class ResendDomain extends pulumi.ComponentResource {
  public readonly domainId: pulumi.Output<string>;
  public readonly apiKeyId: pulumi.Output<string>;
  public readonly apiKeyToken: pulumi.Output<string>;

  constructor(
    name: string,
    args: ResendDomainArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super("ucmc:resend:Domain", name, {}, opts);

    const parentOpts: pulumi.ResourceOptions = { parent: this };
    const runScript = `node ${JSON.stringify(SCRIPT)}`;

    // 1. Create (or look up) the Resend domain. Idempotent: re-running
    //    against an existing domain fetches its records rather than
    //    erroring, so partial-failure recovery on subsequent `pulumi up`
    //    runs works.
    const createDomainCmd = new command.local.Command(
      `${name}-domain-create`,
      {
        create: `${runScript} create-domain`,
        delete: `${runScript} delete-domain`,
        environment: {
          RESEND_API_KEY: args.resendApiKey,
          DOMAIN_NAME: args.domainName,
        },
      },
      parentOpts,
    );

    const domainOutput: pulumi.Output<CreateDomainOutput> =
      createDomainCmd.stdout.apply(
        (raw) => JSON.parse(raw) as CreateDomainOutput,
      );

    this.domainId = domainOutput.apply((d) => d.id);
    const records = domainOutput.apply((d) => d.records);

    // Helper: pick a record by `record` classification (SPF/DKIM). For
    // the return-path MX record, Resend classifies it as "SPF" alongside
    // the TXT SPF record, so disambiguate by `type`.
    const pickRecord = (
      predicate: (r: ResendRecord) => boolean,
      label: string,
    ): pulumi.Output<ResendRecord> =>
      records.apply((list) => {
        const found = list.find(predicate);
        if (!found) {
          throw new Error(
            `resend: expected ${label} record in domain response, found: ${JSON.stringify(list.map((r) => ({ record: r.record, type: r.type })))}`,
          );
        }
        return found;
      });

    const mxRecord = pickRecord((r) => r.type === "MX", "MX return-path");
    const spfRecord = pickRecord(
      (r) => r.record === "SPF" && r.type === "TXT",
      "SPF TXT",
    );
    const dkimRecord = pickRecord((r) => r.record === "DKIM", "DKIM");

    // 2. Create Cloudflare DNS records for each Resend-mandated entry.
    //    Resend's `name` field is returned as a FQDN, which Cloudflare's
    //    DnsRecord accepts directly. TTL 1 === "auto" in Cloudflare.
    const mxDns = new cloudflare.DnsRecord(
      `${name}-dns-mx`,
      {
        zoneId: args.cloudflareZoneId,
        name: mxRecord.apply((r) => r.name),
        type: "MX",
        content: mxRecord.apply((r) => r.value),
        priority: mxRecord.apply((r) => r.priority ?? 10),
        ttl: 1,
        comment: "managed-by-ucmc-pulumi: resend return-path",
      },
      parentOpts,
    );

    const spfDns = new cloudflare.DnsRecord(
      `${name}-dns-spf`,
      {
        zoneId: args.cloudflareZoneId,
        name: spfRecord.apply((r) => r.name),
        type: "TXT",
        content: spfRecord.apply((r) => r.value),
        ttl: 1,
        comment: "managed-by-ucmc-pulumi: resend spf",
      },
      parentOpts,
    );

    const dkimDns = new cloudflare.DnsRecord(
      `${name}-dns-dkim`,
      {
        zoneId: args.cloudflareZoneId,
        name: dkimRecord.apply((r) => r.name),
        type: dkimRecord.apply((r) => r.type),
        content: dkimRecord.apply((r) => r.value),
        ttl: 1,
        comment: "managed-by-ucmc-pulumi: resend dkim",
      },
      parentOpts,
    );

    // 3. Trigger verification once DNS is in place. Verification is async
    //    on Resend's side — domain status transitions as DNS propagates.
    //    The call itself just kicks it off.
    const verifyCmd = new command.local.Command(
      `${name}-domain-verify`,
      {
        create: `${runScript} verify-domain`,
        // triggers re-runs the verify call whenever the domain id changes
        // (i.e. after a recreation).
        triggers: [this.domainId],
        environment: {
          RESEND_API_KEY: args.resendApiKey,
          DOMAIN_ID: this.domainId,
        },
      },
      { ...parentOpts, dependsOn: [mxDns, spfDns, dkimDns] },
    );

    // 4. Issue a sending-scoped API key for the Worker. The script
    //    deletes+recreates to guarantee a usable token (Resend only
    //    discloses the token at creation time).
    const apiKeyCmd = new command.local.Command(
      `${name}-api-key`,
      {
        create: `${runScript} create-api-key`,
        delete: `${runScript} delete-api-key`,
        triggers: [this.domainId],
        environment: {
          RESEND_API_KEY: args.resendApiKey,
          KEY_NAME: args.apiKeyName,
          PERMISSION: "sending_access",
          DOMAIN_ID: this.domainId,
        },
      },
      { ...parentOpts, dependsOn: [verifyCmd] },
    );

    const apiKeyOutput = apiKeyCmd.stdout.apply(
      (raw) => JSON.parse(raw) as { id: string; token: string },
    );

    this.apiKeyId = apiKeyOutput.apply((o) => o.id);
    this.apiKeyToken = pulumi.secret(apiKeyOutput.apply((o) => o.token));

    this.registerOutputs({
      domainId: this.domainId,
      apiKeyId: this.apiKeyId,
      apiKeyToken: this.apiKeyToken,
    });
  }
}
