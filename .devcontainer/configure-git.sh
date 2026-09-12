#!/usr/bin/env bash
# Runs INSIDE the container from postCreateCommand, with the workspace
# folder as the working directory.
#
# Adapted from the configure-git.sh in dx-with-dev-containers. That repo
# uses a bare-repo + worktrees layout and needs more than this; UCMC is a
# plain single checkout, so the worktree-specific parts are deliberately
# left out rather than copied forward unused.
set -euo pipefail

workspace="$(pwd)"

# `git config --global --add` appends unconditionally, so re-adding the
# same path on every rebuild would grow the list forever.
trust() {
  local path="$1"
  [ -n "$path" ] || return 0
  if ! git config --global --get-all safe.directory 2>/dev/null | grep -qxF "$path"; then
    git config --global --add safe.directory "$path"
  fi
}

# A bind-mounted repository often appears owned by a different uid than
# the container user, and git refuses to touch a repo it thinks belongs
# to someone else. Trusting this one path is preferable to
# `safe.directory=*`.
trust "$workspace"

# Background gc is a repack of the object store, and it takes the same
# locks the editor's Git extension and your own commits are competing
# for. On this virtiofs mount that competition is already tight enough
# (see .vscode/settings.json's files.watcherExclude comment) without a
# repack firing mid-commit. Run `git gc` by hand when you want one.
git config --global gc.auto 0
