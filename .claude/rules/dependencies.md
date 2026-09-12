---
paths:
  - "pnpm-workspace.yaml"
  - "package.json"
  - "**/package.json"
  - ".npmrc"
  - "pnpm-lock.yaml"
---

# Dependencies & supply chain

**pnpm config lives in `pnpm-workspace.yaml`, not `package.json`.** pnpm 11 stopped reading the `pnpm.*` block in `package.json` — `overrides`, `peerDependencyRules`, `auditConfig`, `minimumReleaseAge`, and `allowBuilds` must all be in the workspace file or they silently no-op.

## The three hardening mechanisms

- **`minimumReleaseAge: 10080`** quarantines any version published in the last 7 days — the primary defense against publish-compromise incidents (e.g. the TanStack `latest`-tag hijack). **Never spec a dep as `"latest"`**: it bypasses the resolver's age check and is exactly what got hijacked. Every direct dep gets an exact version or a caret pin where every in-range version is ≥7 days old.
- **`allowBuilds`** (renamed from pnpm 10's `onlyBuiltDependencies`) is a map of `pkg: true|false`. Lifecycle scripts run only for listed packages; everything else is blocked. Audit pnpm's actual decisions in `node_modules/.modules.yaml`.
- **`.npmrc`** pins `registry=https://registry.npmjs.org/` so an environment-level registry override can't redirect us to a poisoned mirror.

## Rules for clearing an advisory

Read the current pins out of `pnpm-workspace.yaml` — they are not duplicated here, and a copy would drift.

- **An override is for transitive deps only. When the vulnerable package is a _direct_ dependency, bump its pin instead**, so `package.json` states the floor rather than leaving a caret that silently resolves back down. That's how `@simplewebauthn/server`, `vitest`, and the `@tiptap/*` family were cleared. The whole tiptap family moves in lockstep, so all eight pins bump together rather than overriding `@tiptap/core` underneath them and risking core/extension skew.
- **Prefer an override to a `minimumReleaseAgeExclude` entry**: the override forces a known-good version while the resolver's age check still rejects anything fresher, whereas an exclude bypasses the quarantine entirely.
- **Pick a patched floor that has already cleared the 7-day quarantine**, so we never need `minimumReleaseAgeExclude` at all.
- **Cap major bumps** (`<8`, `<6`, `<5`, `<4`, `<2`) to the major the consumers expect.
- **When a whole dependency graph must move majors in lockstep, move the package that owns it rather than forcing a mismatched major.** The OTel advisories are fixed only on the OTel 2.x line, so instead of forcing a mismatched OTel major we pin `@pulumi/pulumi >=3.252.0` — the release train that migrated Pulumi's own OTel deps to 2.9.x (providers accept `^3.142.0`, so any 3.x runtime works) — which pulls the patched OTel 2.x set and drops the vulnerable 0.57.x exporters.
- Peer deps that must stay in lockstep with a pinned package get an override too (e.g. `@tanstack/query-core` against the pinned `@tanstack/react-query`).

**Reconcile against `pnpm audit`, not Dependabot's raw count** — Dependabot may surface alerts that lag `pnpm audit`. The target state is `pnpm audit` clean with no knowingly-unpatched advisories.
