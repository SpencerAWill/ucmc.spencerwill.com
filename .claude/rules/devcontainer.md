---
paths:
  - ".devcontainer/**"
  - ".zed/**"
  - ".vscode/**"
---

# Devcontainer & editors

Debian-based devcontainer: Node 24, Pulumi, gh, Claude Code, Playwright, Mailpit sidecar.

- `initialize.sh` runs on the **host** from `initializeCommand` (pre-creates the `~/.config/gh` bind source so Docker can't invent it root-owned).
- Every in-container hook routes through **`lifecycle.sh <stage>`** (`on-create` / `update-content` / `post-create` / `post-start`), which claims volume ownership and calls `configure-git.sh` (`safe.directory`, `gc.auto 0`, git identity + credential helper derived from `gh`).
- **Dependency install lives in `updateContentCommand`, not `postCreateCommand`** — that hook also fires when prebuilt content refreshes, so a lockfile change is picked up without a full rebuild.

## `node_modules` is a named volume, and the pnpm store lives inside it

`storeDir: node_modules/.store` in `pnpm-workspace.yaml`. The virtiofs bind mount is ~90× slower on bulk metadata (72k files: `find` ~1.5 s vs ~17 ms container-native), which taxed every install / `tsc` / vitest / esbuild run.

The store must share a filesystem with `node_modules` to hardlink rather than copy, so it goes _inside_ the same volume — this is why the two move together, and why the old `pnpm-store` volume (mounted at `~/.local/share/pnpm/store`, a different filesystem, so pnpm ignored it) was dead weight.

**Trade-off:** `node_modules` is no longer visible on the host (source still is, via the bind mount) — host-side tooling that needs the dependency tree must run in the container. A fresh volume is root-owned, so `lifecycle.sh`'s `claim_volumes` chowns it before `update-content` installs.

## Editors

Zed is the primary IDE (`.zed/settings.json`). `.vscode/settings.json` is kept for anyone attaching VS Code, but **no VS Code Server runs in this container by default** — don't assume it when diagnosing behaviour here.

## Git index-lock contention is Zed-specific

Measured by swapping editors with everything else held constant (`claude` running and polling in both arms), idle, over the same 75 s window:

|                      | idle `index.lock` acquisitions / 75 s                          |
| -------------------- | -------------------------------------------------------------- |
| **Zed** attached     | **224** (~3/s; lock held ~84 ms, gap ~383 ms; ~18% duty cycle) |
| **VS Code** attached | **0**                                                          |

In **Zed** an index-writing command (`git add`, `git commit`, `git mv`) collides ~18% of the time, and lint-staged's several index writes per commit give roughly a 60% chance at least one collides. A lost race leaves a **truncated index that reports every tracked file as deleted** — that reached a commit twice. **Recovery is `git reset` (mixed — never `--hard`; the worktree is fine).** On `Unable to create '.git/index.lock'`, re-run; it is transient. Only delete the lock by hand once `pgrep -a git` shows no live process.

**The `claude` CLI is NOT a contributor, despite spawning git constantly.** In the VS Code arm it was caught spawning git in every 2 s sample yet the lock count was 0 — its polling uses read-only / `--no-optional-locks` operations that never create `index.lock`. Zed's integration writes the index (a `git status` that refreshes the stat cache takes the optional lock unless `--no-optional-locks` is passed; on this virtiofs mount the cache constantly looks stale).

**Three things that are NOT the cause, each previously believed and then measured:**

1. **Not VS Code — the opposite.** No `vscode-server` even ran during the original diagnosis, and attaching VS Code _eliminates_ the contention. The command flag signature (`-c core.fsmonitor=false --no-optional-locks`) is shared by several clients and is not an attribution.
2. **Not the file watcher.** Scan/watch exclusions (`files.watcherExclude`, `file_scan_exclusions`) do not change the rate. Keep them for editor responsiveness, not as a fix for this.
3. **Not virtiofs.** For git's actual workload it is **not slower than container-native**: a real 107 KB index write is ~3 ms on both, and create+write+fsync+rename is 0.72 ms on virtiofs vs 0.86 ms on overlayfs. The oft-quoted "~20× slower" came from create+unlink of an _empty_ file — pure syscall overhead, unrepresentative. **Moving the checkout into a Docker volume would not fix this.**

**What the committed mitigations buy:** `lint-staged --no-stash` and `gc.auto 0` cut the _number_ of index writes per commit, reducing collision exposure under Zed and doing nothing under VS Code. The `gh` bind-mount guard (`initialize.sh`) and the git identity derived from `gh` (`configure-git.sh`) are unrelated bug fixes in the same files — the identity one is **required under Zed**, which has no equivalent of VS Code's `dev.containers.copyGitConfig`.

**The lever for fixing it at source is Zed's git poll rate, still unverified.** Zed exposes a `git` settings block (`disable_git`, `enable_status`, `enable_diff`, `gutter_debounce`) and its watcher polls on a compile-time `POLL_INTERVAL`. Setting `"git": { "disable_git": true }` did **not** change the rate in testing — either the shape is wrong or it needs a full restart. **Do not document it as a fix until someone measures it.**
