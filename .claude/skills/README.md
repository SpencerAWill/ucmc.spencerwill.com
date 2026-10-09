# `.claude/skills/`

Two kinds of entry live here, and the difference is visible at a glance:
**a directory is ours, a symlink is a library's.**

## Repo-owned skills (real directories)

`add-feature-module`, `add-page-flag`, `rename-permission-or-setting` —
multi-step procedures specific to this codebase that we wrote and maintain.
CLAUDE.md's "Where things live" table is the rule for what earns one.

## Vendored library skills (symlinks into `node_modules`)

The nine `*-chart*` entries are symlinks into
`apps/ucmc-web/node_modules/@tanstack/charts/skills/`. `@tanstack/charts`
publishes twelve skills inside its own npm package; these are the ones
load-bearing for `/analytics` (see `.claude/rules/feature-analytics.md`).

**They are symlinks, not copies, and that is the whole point.** Issue #267's
own comment argued against vendoring them precisely because a copy is "332K of
vendored prose that silently drifts from the installed version on every
upgrade, with nothing to catch the drift". A symlink cannot drift: it resolves
to whatever version is installed, so upgrading the package upgrades the skills
in the same `pnpm install`. Each one also carries `library_version` in its own
frontmatter, so the version being read is stated in the file.

The failure mode is a **dangling** symlink rather than a stale one — the
package removed, renamed, or simply not installed yet on a fresh clone. That
is self-healing (`pnpm install` restores it) and self-evident (the skill
disappears from the list rather than quietly answering from a stale version).

Deliberately **not** linked: `extend-tanstack-charts` (authoring custom marks
and renderers — we compose built-ins), `coordinate-charts-with-tanstack`
(TanStack DB live queries, which this app does not use), and
`update-and-animate-charts` (keyed animation; the analytics panels are static
reads). Link one if that changes — it is one `ln -s`.

```sh
# Add another, from this directory:
ln -s ../../apps/ucmc-web/node_modules/@tanstack/charts/skills/<name> <name>

# Verify none dangle:
for d in */; do test -f "$d/SKILL.md" || echo "DANGLING: $d"; done
```
