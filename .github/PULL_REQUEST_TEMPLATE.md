<!--
Thanks for contributing! A few notes before you submit:

- The PR title must be a valid Conventional Commit (it lands on `main` via squash merge).
  Format: `type(scope): description` — e.g. `feat(ucmc-web): add gear barcode printing`.
  Valid scopes are pnpm workspace names, plus `wiki` and `devcontainer`.
- For security-sensitive findings, please do NOT open a PR. See SECURITY.md.
- Bumping `WAIVER_VERSION`, editing legal copy, or changing compliance flows? Call it out explicitly below.
-->

## Summary

<!-- What does this PR do, and why? 1–3 bullets is plenty. Link issues with "Closes #123". -->

-

## Changes

<!-- The notable user-visible or developer-visible changes. Skip if obvious from the diff. -->

-

## Screenshots / recordings

<!-- Required for UI changes. Before/after if you're modifying existing screens. Delete this section for non-UI PRs. -->

## Test plan

<!--
How did you verify this works? Be specific — "I clicked through the flow" beats "tested locally".
For bug fixes, include the regression test you added.
-->

- [ ]
- [ ]

## Checklist

- [ ] Commits follow [Conventional Commits](https://www.conventionalcommits.org/) with a valid workspace scope (`pnpm commit` if unsure).
- [ ] `pnpm exec eslint .` and `pnpm exec prettier --check .` pass.
- [ ] `pnpm --filter ucmc-web typecheck` passes (if `apps/ucmc-web/` changed).
- [ ] `pnpm --filter ucmc-web test` passes (if `apps/ucmc-web/` changed). New behavior has a test; bug fixes have a regression test.
- [ ] `README.md` and `CLAUDE.md` updated together if tooling / scripts / workflows / repo structure changed.
- [ ] `.wiki/Compliance.md` updated if this PR adds or changes a compliance obligation.

## Risk / rollout notes

<!--
Anything reviewers should know before merging:
- Does this require a coordinated deploy (e.g. infra before web, or prod-before-dev for Resend)?
- Does this invalidate sessions, waiver attestations, or other user state?
- Does it touch auth, RBAC, audit, or rate limiting?
- Any feature flags or env vars to set in the GitHub environment(s) first?
Delete this section if there's nothing to flag.
-->
