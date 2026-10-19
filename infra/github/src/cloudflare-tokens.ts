import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

/**
 * Least-privilege Cloudflare permissions for each CI token, by the names
 * Cloudflare's permission-groups API returns ("Write" where the dashboard
 * says "Edit"). Names are resolved to ids at apply time,
 * and an unknown name fails the run rather than silently granting less.
 *
 * These replace one hand-made token with every permission, which was a
 * repository secret readable by any job on any branch (#311).
 *
 * Account groups apply to the whole account. Zone groups apply to this
 * site's zone only (`zoneId`), never to every zone in the account.
 * spencerwill.com is shared with www and flareling, so no token gets
 * zone-wide settings or WAF: those would change the other sites too.
 *
 * Add a permission in the same PR as the resource or command that needs it.
 * infra/cloudflare's resources are created rarely, so a missing permission
 * shows up the next time one changes, not on the next deploy: `pulumi up`
 * with no diff makes no write calls.
 */
const tokenPermissions = {
  // Wrangler, in the deploy action (.github/actions/deploy) and
  // seed-admin.yml: upload the Worker and its secrets, apply D1 migrations,
  // read a D1 Time Travel bookmark, roll back a version, run D1 SQL. No zone
  // permissions at all: wrangler.jsonc declares no `routes` (the custom
  // domain is infra/cloudflare's), so a deploy never touches the zone.
  deploy: {
    account: ["Workers Scripts Write", "D1 Write", "Account Settings Read"],
    zone: [],
  },
  // `pulumi up` on infra/cloudflare (the deploy action's first step). One entry
  // per resource type there: D1Database; R2Bucket and R2CustomDomain;
  // WorkersKvNamespace; TurnstileWidget; WorkersCustomDomain (Workers
  // Scripts + zone Workers Routes + DNS); ZeroTrustAccessApplication (dev).
  // The same set flareling's infra token runs on, which covers every type
  // here except R2CustomDomain — the first change to that resource is the
  // first real test of `DNS Write` being enough for it.
  infra: {
    account: [
      "Account Settings Read",
      "Workers Scripts Write",
      "D1 Write",
      "Workers KV Storage Write",
      "Workers R2 Storage Write",
      "Turnstile Sites Write",
      "Access: Apps and Policies Write",
    ],
    zone: ["Zone Read", "DNS Write", "Workers Routes Write"],
  },
} as const;

/**
 * `pulumi preview` on PRs (cicd.yml's `pulumi-preview` jobs, in the `preview`
 * environment): the infra token's reach, read-only. Derived rather than
 * listed, so a permission added to the infra token reaches previews too.
 */
const readOnly = (names: readonly string[]) =>
  names.map((name) => {
    const read = name.replace(/ Write$/, " Read");
    // A write permission named otherwise ("... Edit") must not reach PRs.
    if (!read.endsWith(" Read")) {
      throw new Error(
        `No read-only form of "${name}" for the preview token: map it in readOnly.`,
      );
    }
    return read;
  });

const allPermissions = {
  ...tokenPermissions,
  preview: {
    account: readOnly(tokenPermissions.infra.account),
    zone: readOnly(tokenPermissions.infra.zone),
  },
};

export type TokenKind = keyof typeof allPermissions;

export function createCiTokens({
  accountId,
  zoneId,
  repositoryName,
}: {
  readonly accountId: string;
  readonly zoneId: string;
  readonly repositoryName: string;
}): Record<TokenKind, pulumi.Output<string>> {
  const groups = cloudflare.getAccountApiTokenPermissionGroupsListOutput({
    accountId,
    maxItems: 1000,
  });

  // Some names exist at both scopes (for example "Access: Apps and Policies
  // Write"), so the lookup matches on scope as well as name.
  const scopes = {
    account: "com.cloudflare.api.account",
    zone: "com.cloudflare.api.account.zone",
  };
  const idsFor = (scope: keyof typeof scopes, names: readonly string[]) =>
    groups.results.apply((results) =>
      names.map((name) => {
        const match = results.find(
          (group) =>
            group.name === name && group.scopes.includes(scopes[scope]),
        );
        if (!match) {
          throw new Error(
            `Unknown ${scope}-scoped Cloudflare permission group: "${name}"`,
          );
        }
        return { id: match.id };
      }),
    );

  const accountResource = `com.cloudflare.api.account.${accountId}`;
  const zoneResource = JSON.stringify({
    [accountResource]: { [`com.cloudflare.api.account.zone.${zoneId}`]: "*" },
  });

  const mint = (kind: TokenKind) => {
    const { account, zone } = allPermissions[kind];
    const token = new cloudflare.AccountToken(`${kind}-token`, {
      accountId,
      name: `${repositoryName} CI (${kind})`,
      policies: [
        {
          effect: "allow",
          permissionGroups: idsFor("account", account),
          resources: JSON.stringify({ [accountResource]: "*" }),
        },
        // An empty policy is rejected, and the deploy token needs no zone.
        ...(zone.length > 0
          ? [
              {
                effect: "allow",
                permissionGroups: idsFor("zone", zone),
                resources: zoneResource,
              },
            ]
          : []),
      ],
    });
    return pulumi.secret(token.value);
  };

  return {
    deploy: mint("deploy"),
    infra: mint("infra"),
    preview: mint("preview"),
  };
}
