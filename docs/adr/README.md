# Architecture decision records

One file per decision that is hard to reverse or easy to second-guess later: what was decided, what forced it, and what it costs. Numbered in order, never renumbered. A decision that is overturned stays here with its status changed to **Superseded by NNNN**, so the reasoning that was once true is still readable.

Most of this repo's reasoning lives next to the code it explains, in comments and in `.claude/rules/`. An ADR is for the decisions that span several of those places at once — infra, app and workflow — where no single file is the right home.

| ADR                              | Decision                                    | Status   |
| -------------------------------- | ------------------------------------------- | -------- |
| [0001](0001-dev-email-outbox.md) | A dev email outbox behind Cloudflare Access | Accepted |

## Format

```markdown
# NNNN. Title

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context

## Decision

## Consequences
```
