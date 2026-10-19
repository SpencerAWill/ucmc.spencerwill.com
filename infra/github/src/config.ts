import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const githubConfig = new pulumi.Config("github");

// Fail fast if unset. Without it the provider silently targets whichever
// account the token belongs to.
export const owner = githubConfig.require("owner");
export const repositoryName = config.require("repository");
export const description = config.require("description");
export const homepage = config.require("homepage");

/** Status checks required on main. ci.yml's aggregate `required` job. */
export const requiredChecks = config.requireObject<string[]>("requiredChecks");

/**
 * GitHub user ids who approve `prod` deploys and PR preview runs. Required
 * reviewers on environments exist for personal accounts only on public
 * repos, which this one is (see repository.ts).
 */
export const reviewerIds = config.requireObject<number[]>("reviewerIds");
if (reviewerIds.length === 0) {
  throw new Error(
    "reviewerIds is empty: prod and preview would run with no approval.",
  );
}

/** The Pulumi Cloud org and user the workflows' OIDC exchange targets. */
export const pulumiOrganization = config.require("pulumiOrganization");
export const pulumiUserLogin = config.require("pulumiUserLogin");

/** Where the CI tokens are minted, and the one zone they may touch. */
export const cloudflareAccountId = config.require("cloudflareAccountId");
export const cloudflareZoneId = config.require("cloudflareZoneId");
