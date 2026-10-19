import * as github from "@pulumi/github";
import {
  description,
  homepage,
  repositoryName,
  requiredChecks,
} from "./config.ts";

/** `gh api apps/github-actions --jq .id` */
const GITHUB_ACTIONS_APP_ID = 15368;

/**
 * The repository itself. It already exists, so it is adopted with `pnpm
 * adopt` (a `pulumi import`, see adopt.json) rather than created.
 *
 * Every setting is declared explicitly, and each matches what the repo had
 * when it was adopted (2026-10-19). The provider treats an omitted optional
 * field as "clear it", so leaving out `homepageUrl` or `hasWiki` would
 * quietly change the repo. The adopt-then-preview step in the README is
 * what proves the two agree: it must show no change to this resource.
 *
 * It must stay public: on GitHub Free, rulesets, environment secrets and
 * required reviewers are available to a personal account's repos only when
 * they are public, and every safeguard below depends on them.
 */
export const repository = new github.Repository(
  "repository",
  {
    name: repositoryName,
    description,
    homepageUrl: homepage,
    visibility: "public",
    isTemplate: false,
    topics: [],

    hasIssues: true,
    // The compliance wiki lives here (CLAUDE.md, "Keeping docs honest").
    hasWiki: true,
    hasProjects: false,
    hasDiscussions: false,

    // Squash-only, titled from the PR. lint-pr.yaml enforces Conventional
    // Commit PR titles, so every commit on main is conventional too.
    allowSquashMerge: true,
    allowMergeCommit: false,
    allowRebaseMerge: false,
    squashMergeCommitTitle: "PR_TITLE",
    squashMergeCommitMessage: "BLANK",
    allowAutoMerge: false,
    allowUpdateBranch: true,
    deleteBranchOnMerge: true,
    webCommitSignoffRequired: false,

    securityAndAnalysis: {
      secretScanning: { status: "enabled" },
      secretScanningPushProtection: { status: "enabled" },
    },

    // `protect` blocks any plan that would delete the repo; if it is ever
    // removed, destroy archives instead of deleting.
    archiveOnDestroy: true,
  },
  { protect: true, retainOnDelete: true },
);

// Dependabot alerts, and the security-update PRs that answer them. Both were
// on before adoption; separate resources because the Repository fields for
// them are deprecated.
new github.RepositoryVulnerabilityAlerts("vulnerability-alerts", {
  repository: repository.name,
  enabled: true,
});
new github.RepositoryDependabotSecurityUpdates("dependabot-security-updates", {
  repository: repository.name,
  enabled: true,
});

/**
 * Safeguards on main: changes arrive by PR, after ci.yml's `required` job
 * passes, and history stays linear (squash-only).
 *
 * Repository admins bypass, so nobody can be locked out by a bad rule or a
 * broken CI — the merge button offers the bypass explicitly. Everyone else,
 * Dependabot included, goes through the PR and the check.
 *
 * `strictRequiredStatusChecksPolicy` makes a PR re-run CI against the
 * latest main before it merges. Merging to main deploys dev, so a PR that
 * was green against an older main isn't evidence enough.
 *
 * Adopted from the hand-made "Main Protection" ruleset (adopt.json), which
 * had only the deletion, non-fast-forward and linear-history rules.
 */
new github.RepositoryRuleset(
  "main-protection",
  {
    repository: repository.name,
    name: "Main Protection",
    target: "branch",
    enforcement: "active",
    conditions: {
      refName: { includes: ["~DEFAULT_BRANCH"], excludes: [] },
    },
    bypassActors: [
      // actorId 5 is GitHub's built-in "Repository admin" role.
      { actorId: 5, actorType: "RepositoryRole", bypassMode: "always" },
    ],
    rules: {
      deletion: true,
      nonFastForward: true,
      requiredLinearHistory: true,
      pullRequest: {
        requiredApprovingReviewCount: 0,
        dismissStaleReviewsOnPush: true,
        requiredReviewThreadResolution: true,
      },
      requiredStatusChecks: {
        strictRequiredStatusChecksPolicy: true,
        // Only the GitHub Actions app (id 15368) may satisfy it. Without
        // `integrationId`, a commit status of the same name posted by anyone
        // with write access, or any app, would count.
        requiredChecks: requiredChecks.map((context) => ({
          context,
          integrationId: GITHUB_ACTIONS_APP_ID,
        })),
      },
    },
  },
  { protect: true },
);
