# Architecture decision records

One file per decision that is hard to reverse or easy to second-guess later: what was decided, what forced it, and what it costs. They exist so a later reader (or agent) can tell a deliberate choice from an accident before changing it.

ADRs hold the **why**. The `.claude/rules/` files hold the **what to do**: each rule that rests on an ADR opens by naming it, and keeps only the instructions. When the two disagree, the code is the tiebreaker, and whichever document is wrong gets fixed in the same change.

## When to write one

Write an ADR when a change:

- picks between real alternatives that someone could reasonably revisit (a library, a platform service, a data model),
- sets a rule the rest of the code has to follow, or
- trades something away on purpose (cost, speed, flexibility).

Small, easily reversed choices don't need one; a comment beside the code is the right home. When in doubt, write the short version.

## How

1. Copy [`template.md`](./template.md) to `NNNN-short-title.md`, using the next number. Numbers are never reused or renumbered.
2. Start it as **Proposed**, and move it to **Accepted** when the change that implements it merges.
3. Don't rewrite an accepted ADR when the decision changes. Write a new one, and mark the old one **Superseded by NNNN**, so the reasoning that was once true stays readable. Correcting a fact that was wrong when written, or adding a pointer to where the code moved, is fine.
4. Add it to the index below in the same change.

`0003`–`0010` were backfilled on 2026-10-27 (#322) from reasoning that had lived in `.claude/rules/` and CLAUDE.md. Their **Date** is when the decision was made, from the history, not when the file was written.

## Index

| ADR                                                  | Decision                                                                         | Status   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- | -------- |
| [0001](0001-dev-email-outbox.md)                     | A dev email outbox behind Cloudflare Access                                      | Accepted |
| [0002](0002-one-pipeline-from-check-to-prod.md)      | One pipeline from check to prod                                                  | Accepted |
| [0003](0003-temporal-everywhere-forced-polyfill.md)  | Temporal for every timestamp, with the polyfill forced                           | Accepted |
| [0004](0004-the-club-season-is-the-waiver-term.md)   | The club season runs Aug 1 → Jul 31, and is the waiver term                      | Accepted |
| [0005](0005-own-auth-magic-links-and-passkeys.md)    | Our own auth: magic links, optional passkeys, sessions in D1                     | Accepted |
| [0006](0006-d1-statements-bind-a-fixed-number.md)    | No D1 statement binds a number of parameters that grows with the data            | Accepted |
| [0007](0007-every-migration-through-generate.md)     | Every migration goes through `drizzle-kit generate`, and only adds               | Accepted |
| [0008](0008-events-is-a-base-table.md)               | `events` is a base table; kinds own satellite tables                             | Accepted |
| [0009](0009-tanstack-charts-through-chartsurface.md) | TanStack Charts, mounted through `ChartSurface`                                  | Accepted |
| [0010](0010-registries-not-rows.md)                  | Settings, notifications, prompts and badges are registries; permissions are rows | Accepted |
