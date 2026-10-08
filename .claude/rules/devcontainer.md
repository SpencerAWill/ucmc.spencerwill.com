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

## Ports reach the host by Docker publishing, not by VS Code forwarding

`docker-compose.yml` **publishes** 3000 (Vite), 4173 (`vite preview`), 6006 (Storybook), 9323 (Playwright UI mode and `show-report`) and — on the mailpit service — 8025 / 1025. `devcontainer.json` deliberately has **no `forwardPorts`**.

The two mechanisms are not interchangeable:

|                    | compose `ports:` (publish)               | `forwardPorts` (forward)                |
| ------------------ | ---------------------------------------- | --------------------------------------- |
| Mechanism          | Docker binds the port on the Docker host | VS Code tunnels over its own connection |
| Needs VS Code?     | **No** — Zed, `devcontainer up`, CI too  | **Yes** — dies with the window          |
| Server must bind   | `0.0.0.0`; loopback-only is unreachable  | anything; arrives as localhost inside   |
| Host port conflict | fails loudly at container start          | **silently remaps to a random port**    |
| Other compose svc  | only its own service                     | `"mailpit:8025"` service:port form      |

Publishing is the choice here because forwarding is a devcontainer **client** feature and this repo is not VS Code-only. Every server already binds `0.0.0.0` (Vite `server.host: true`, Storybook `--host 0.0.0.0`, and `vite preview`, which resolves `preview.host ?? server.host`), which publishing requires and forwarding does not.

**Never list a published port in `forwardPorts` as well.** VS Code finds the host port taken and silently remaps to a random one ([vscode-remote-release#3025](https://github.com/microsoft/vscode-remote-release/issues/3025)) — which presents as "port forwarding is broken" and sends you looking in the wrong place. Adding a new long-running server means adding it to `ports:`, and to `portsAttributes` only for its label.

**An address is relative to where you are standing, and both sides are correct.** Mailpit is `http://localhost:8025` from a host browser and `http://mailpit:8025` from inside the container, where compose DNS resolves service names; neither is the "real" one. Anything running in the container — the worker's `MAILPIT_URL`, the Playwright fixtures — wants the service name. The same split is why CI sets `MAILPIT_URL=http://localhost:8025`: GitHub service containers publish to the runner's loopback and there is no compose network. See `testing.md`.

## Nothing visual runs in here — there is no X server

`chromium` and `webkit` are installed (Playwright), but **headed** launches die immediately:

```
ERROR:ui/ozone/platform/x11/ozone_platform_x11.cc:257] Missing X server or $DISPLAY
ERROR:ui/aura/env.cc:246] The platform failed to initialize.  Exiting.
```

`xvfb-run` and `Xvfb` are installed, so a headed run _can_ be wrapped — but you still cannot see the window, which defeats the point. **Prefer the things that serve over HTTP instead**, because a published port is something you can actually open:

- `pnpm --filter ucmc-web e2e:ui` — UI mode on `:9323` (`--ui-host 0.0.0.0 --ui-port 9323`), not a window.
- `playwright show-report` / `show-trace` — same port.
- `Simple Browser: Show` — VS Code's bundled webview browser. It renders in the host window and does **not** call `asExternalUri`, so it reaches the app through the published port like any host browser would. No breakpoints, but it keeps the app in the editor.

**Client-side Chrome debugging is a special case and currently depends on VS Code forwarding being healthy.** There is no browser here, which js-debug handles by design: `ms-vscode.js-debug-companion` (`extensionKind: ["ui"]`, bundled with VS Code) launches Chrome on the host for it. But js-debug also opens a tunnel labelled _"Browser Debug Tunnel"_ for its CDP server port and passes the companion a `proxyUri` for the local end — **and that request is wrapped in a swallowing `.catch(() => {})`.** When forwarding is broken the `proxyUri` silently falls back to `127.0.0.1:<serverPort>` on the host, where nothing listens; Chrome opens and the attach then fails. Publishing cannot rescue this one — the tunnel port is allocated per debug session, so there is nothing static to put in `ports:`.

Breakpoints in the Vitest and tsx configs are unaffected: those are `node-terminal`, entirely in-container, no browser and no tunnel.

## Editors

Zed (`.zed/settings.json`) and VS Code (`.vscode/settings.json`) are both supported and either may be attached — **check which, rather than assuming, when diagnosing behaviour here.**

With VS Code attached a full VS Code Server runs in this container (`~/.vscode-server`, plus a host-injected `/tmp/vscode-remote-containers-server-*.js` relay); the host window talks to it over that connection. Under Zed, or a headless `devcontainer up`, none of it exists.

**Claude runs inside the container and cannot see the host.** It can reach other compose services by name and the bridge gateway `172.18.0.1` (which is the Docker Desktop VM, not the developer's machine) — the VM→host hop is neither visible nor traversable. Host-side questions (the Ports panel, the Dev Containers output channel, what already holds a port) have to be handed to a human. Port forwarding straddles that line: the listener is opened on the **host**, the dial-out to `127.0.0.1:<port>` happens **in the container**. So a refused connection on the host means no host listener was ever created, while one that accepts and then hangs implicates the container half.

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
