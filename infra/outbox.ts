import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

/**
 * The dev email outbox (#297, docs/adr/0001-dev-email-outbox.md): the
 * dev Worker stores email in D1 instead of sending it and lists it at
 * `/dev/outbox`, which the Access application below restricts to
 * `outboxViewers`. The page also verifies Access's token itself (issuer
 * `https://<accessTeamDomain>`, audience this application's tag), so a
 * loosened policy still doesn't expose it.
 *
 * **Never on prod**: the outbox holds working sign-in links. That is
 * enforced here, at `pulumi preview`, rather than trusted to config.
 *
 * The Zero Trust organization (`accessTeamDomain`) and its login methods
 * are account-wide and set up by hand; they are shared with the
 * account's other projects and are not this program's to manage.
 */
export interface OutboxArgs {
  accountId: string;
  hostname: string;
  stack: string;
}

export interface Outbox {
  /** `"1"` turns the Worker's outbox tier on; `""` leaves it off. */
  emailOutbox: string;
  /** `<team>.cloudflareaccess.com`, or `""` with the outbox off. */
  accessTeamDomain: string;
  /** The Access application's audience tag, or `""` with the outbox off. */
  accessOutboxAud: pulumi.Output<string>;
}

export function configureOutbox(
  cfg: pulumi.Config,
  { accountId, hostname, stack }: OutboxArgs,
): Outbox {
  const enabled = cfg.getBoolean("emailOutbox") ?? false;
  if (!enabled) {
    return {
      emailOutbox: "",
      accessTeamDomain: "",
      accessOutboxAud: pulumi.output(""),
    };
  }

  if (stack === "prod") {
    throw new Error(
      "emailOutbox is for dev only: it stores working sign-in links in D1.",
    );
  }

  const viewers = cfg.requireObject<string[]>("outboxViewers");
  if (viewers.length === 0) {
    throw new Error("emailOutbox needs at least one address in outboxViewers.");
  }
  const accessTeamDomain = cfg.require("accessTeamDomain");
  if (!accessTeamDomain.endsWith(".cloudflareaccess.com")) {
    throw new Error(
      "accessTeamDomain is the Zero Trust team domain, " +
        "e.g. `<team>.cloudflareaccess.com`, with no scheme.",
    );
  }

  const app = new cloudflare.ZeroTrustAccessApplication(
    `ucmc-web-${stack}-outbox-access`,
    {
      accountId,
      name: `ucmc-web-${stack} outbox`,
      type: "self_hosted",
      // The path and everything under it, on this stack's hostname only.
      // No other hostname is covered; wrangler.jsonc turns `workers_dev`
      // and `preview_urls` off so there isn't one, and the page verifies
      // the token itself in case that changes.
      domain: `${hostname}/dev/outbox`,
      sessionDuration: "24h",
      appLauncherVisible: false,
      policies: [
        {
          name: "outbox viewers",
          decision: "allow",
          precedence: 1,
          includes: viewers.map((email) => ({ email: { email } })),
        },
      ],
    },
  );

  return { emailOutbox: "1", accessTeamDomain, accessOutboxAud: app.aud };
}
