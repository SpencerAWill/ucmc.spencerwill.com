import * as github from "@pulumi/github";
import { createCiTokens } from "./src/cloudflare-tokens.ts";
import {
  cloudflareAccountId,
  cloudflareZoneId,
  pulumiOrganization,
  pulumiUserLogin,
  repositoryName,
  reviewerIds,
} from "./src/config.ts";
import { repository } from "./src/repository.ts";

/**
 * This repo's GitHub settings and CI credentials (#311). See "GitHub as
 * code" in the README for setup, and `.claude/rules/infra.md` for the rules.
 *
 * Run locally by a repo admin, never in CI: the Actions GITHUB_TOKEN cannot
 * change repo settings or write secrets, and CI should not hold a
 * credential that can loosen its own rules.
 *
 * Not managed here, deliberately: the hand-set environment secrets
 * SESSION_SECRET (rotating it signs every member out) and
 * CLOUDFLARE_ACCOUNT_READ_TOKEN (the cost cron's token), and the
 * FEEDBACK_GITHUB_TOKEN secret / FEEDBACK_GITHUB_REPO variable. GitHub never
 * reveals a secret's value, so adopting one means re-entering it; they stay
 * hand-managed until there's a reason to do that.
 */

/**
 * dev and prod deploy only from main. prod also waits for a reviewer.
 *
 * dev deliberately has no reviewer, although its jobs get a Pulumi token
 * through OIDC and spencerwill.com's README asks for a reviewer on every
 * such environment. Every push to main deploys dev, so a reviewer there
 * means approving every merge twice. What gates dev instead: only main may
 * deploy to it (the branch policy below), and main only changes through a
 * PR that passed CI (the ruleset in repository.ts).
 *
 * Both already existed (adopt.json). `retainOnDelete`, because they hold
 * the hand-set secrets above, which a delete would destroy.
 */
const deployEnvironments = (["dev", "prod"] as const).map((name) => {
  const environment = new github.RepositoryEnvironment(
    name,
    {
      repository: repository.name,
      environment: name,
      canAdminsBypass: true,
      ...(name === "prod" && {
        preventSelfReview: false,
        reviewers: [{ users: reviewerIds }],
      }),
      deploymentBranchPolicy: {
        protectedBranches: false,
        customBranchPolicies: true,
      },
    },
    { retainOnDelete: true },
  );

  new github.RepositoryEnvironmentDeploymentPolicy(`${name}-main-only`, {
    repository: repository.name,
    environment: environment.environment,
    branchPattern: "main",
  });

  return { name, environment };
});

/**
 * PR previews of infra/cloudflare (ci.yml's `pulumi-preview` jobs). No
 * branch policy, because every PR branch needs it. Its Cloudflare token can
 * only read, but the Pulumi token a job here gets through OIDC is personal
 * and can read every stack's secrets, in every repo, so each run waits for
 * a reviewer: approve a run only for a branch whose changes you have read.
 */
const preview = new github.RepositoryEnvironment("preview", {
  repository: repository.name,
  environment: "preview",
  canAdminsBypass: true,
  preventSelfReview: false,
  reviewers: [{ users: reviewerIds }],
});

const tokens = createCiTokens({
  accountId: cloudflareAccountId,
  zoneId: cloudflareZoneId,
  repositoryName,
});

// Environment secrets, so only jobs that declare the environment (and pass
// its branch policy and reviewers) can read them. New names rather than the
// old repo-level CLOUDFLARE_API_TOKEN, so applying this before the workflow
// change merges doesn't change what main's workflows read.
// The resource name uses the plain `name`: `environment.environment` is an
// Output, and interpolating one yields Pulumi's "toString on an Output"
// warning text, so both environments would collide on the same URN.
for (const { name, environment } of deployEnvironments) {
  for (const [secretName, value] of Object.entries({
    CLOUDFLARE_DEPLOY_API_TOKEN: tokens.deploy,
    CLOUDFLARE_INFRA_API_TOKEN: tokens.infra,
  })) {
    new github.ActionsEnvironmentSecret(
      `${name}-${secretName}`.toLowerCase(),
      {
        repository: repository.name,
        environment: environment.environment,
        secretName,
        value,
      },
      { deleteBeforeReplace: true },
    );
  }
}
new github.ActionsEnvironmentSecret(
  "preview-cloudflare_preview_api_token",
  {
    repository: repository.name,
    environment: preview.environment,
    secretName: "CLOUDFLARE_PREVIEW_API_TOKEN",
    value: tokens.preview,
  },
  { deleteBeforeReplace: true },
);

// Not secrets, so plain repository variables. The account id was a repo
// secret; as a variable it shows in logs, which an account id may.
const variables = {
  CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
  // What the workflows' pulumi/auth-actions steps ask for.
  PULUMI_ORGANIZATION: pulumiOrganization,
  PULUMI_USER_LOGIN: pulumiUserLogin,
};
for (const [variableName, value] of Object.entries(variables)) {
  new github.ActionsVariable(variableName.toLowerCase().replaceAll("_", "-"), {
    repository: repository.name,
    variableName,
    value,
  });
}

export const repositoryUrl = repository.htmlUrl;
