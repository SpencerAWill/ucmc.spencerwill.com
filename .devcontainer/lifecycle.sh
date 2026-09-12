#!/usr/bin/env bash
# Single entry point for every dev container lifecycle hook, so the ordering
# and the reason each step lives where it does stay readable in one file
# rather than spread across inline `&&` chains in devcontainer.json.
#
#   on-create      once, at creation, before repo content is finalized
#   update-content at creation AND whenever prebuild content refreshes
#   post-create    once, after creation and content are done
#   post-start     every container start, including restarts of an existing one
#
# Structure borrowed from the www.spencerwill.com devcontainer.
set -euo pipefail

STAGE="${1:?usage: lifecycle.sh <on-create|update-content|post-create|post-start>}"

HOME_DIR="${HOME:-/home/vscode}"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME_DIR/.claude}"
HISTORY_DIR=/commandhistory
PNPM_STORE="$HOME_DIR/.local/share/pnpm/store"
PULUMI_DIR="$HOME_DIR/.pulumi"
PLAYWRIGHT_DIR="$HOME_DIR/.cache/ms-playwright"

log() { printf '\033[1;34m[%s]\033[0m %s\n' "$STAGE" "$*"; }

# The image seeds these with the right ownership, but a volume created by an
# older revision of docker-compose.yml can still be root-owned — and a
# root-owned pnpm store or Playwright cache fails in ways that read as a
# corrupt install rather than a permissions problem. Cheap and idempotent:
# `-O` is "owned by the current user", so an already-correct volume is skipped.
claim_volumes() {
  local d
  for d in "$CLAUDE_DIR" "$HISTORY_DIR" "$PNPM_STORE" "$PULUMI_DIR" "$PLAYWRIGHT_DIR"; do
    [ -d "$d" ] || continue
    [ -O "$d" ] && continue
    log "claiming $d"
    sudo -n chown -R "$(id -u):$(id -g)" "$d" 2>/dev/null || log "WARN: could not chown $d"
  done
}

on_create() {
  claim_volumes
  ./.devcontainer/configure-git.sh
}

# Dependencies live in `update-content` rather than `post-create` on purpose:
# that hook runs at creation AND whenever prebuilt content is refreshed, so a
# prebuild picks up a lockfile change without a full rebuild. In
# `post-create` it would only ever run once.
update_content() {
  log "corepack enable"
  corepack enable
  log "pnpm install --frozen-lockfile"
  pnpm install --frozen-lockfile
  log "playwright install chromium"
  pnpm --filter ucmc-web exec playwright install chromium
}

post_create() {
  log "node     $(node --version)"
  log "pnpm     $(pnpm --version)  (store: $(pnpm store path 2>/dev/null || echo '?'))"
  log "gh       $(gh --version 2>/dev/null | head -1 | awk '{print $3}' || echo '?')"
  log "wrangler $(pnpm --filter ucmc-web exec wrangler --version 2>/dev/null | tail -1 || echo '?')"

  if gh auth status >/dev/null 2>&1; then
    log "gh authenticated as $(gh api user --jq .login 2>/dev/null || echo '?')"
  else
    log "gh not authenticated — run 'gh auth login' (on a macOS host: --insecure-storage)"
  fi

  if [ -z "$(git config --get user.email || true)" ]; then
    log "WARN: git has no user.email; commits will fail"
  fi
}

# Volume ownership and git identity are re-asserted on every start rather than
# only at creation: both can be invalidated by a rebuild that reuses existing
# volumes, and both are cheap no-ops when already correct.
post_start() {
  claim_volumes
  ./.devcontainer/configure-git.sh
}

case "$STAGE" in
  on-create)      on_create ;;
  update-content) update_content ;;
  post-create)    post_create ;;
  post-start)     post_start ;;
  *) echo "unknown stage: $STAGE" >&2; exit 64 ;;
esac
