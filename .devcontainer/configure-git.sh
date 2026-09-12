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

# Git identity is NOT inherited into a dev container by the spec. VS Code's
# Dev Containers extension copies the host ~/.gitconfig in automatically
# (`dev.containers.copyGitConfig`, on by default), but that is a behaviour of
# that one extension — open this repo in Zed, a Codespace with a different
# client, or any other devcontainer-compatible tool and every commit aborts
# with "Author identity unknown".
#
# Deriving it from the gh credentials already bind-mounted at ~/.config/gh is
# preferable to bind-mounting the host .gitconfig, which would drag in
# macOS-only settings — credential.helper=osxkeychain, signing keys pointing
# at host paths, commit.gpgsign — that are broken or absent in here.
#
# Guarded on user.email being unset, so a manual `git config --global` always
# wins and the gh API call only happens when there is nothing to fall back on.
# Adapted from the www.spencerwill.com devcontainer's lifecycle.sh.
configure_identity() {
  if git config --global user.email >/dev/null 2>&1; then
    return 0
  fi
  if ! gh auth status >/dev/null 2>&1; then
    printf '\033[1;33mwarning:\033[0m no git identity and gh is not authenticated; commits will fail.\n' >&2
    printf '  Run `gh auth login` (on macOS hosts: --insecure-storage) and reopen.\n' >&2
    return 0
  fi

  local login name email id
  login=$(gh api user --jq '.login' 2>/dev/null || true)
  name=$(gh api user --jq '.name // .login' 2>/dev/null || true)
  email=$(gh api user --jq '.email' 2>/dev/null || true)

  # A profile that keeps its address private reports null; GitHub expects
  # commits to carry the noreply form in that case.
  if [ -z "$email" ] || [ "$email" = "null" ]; then
    id=$(gh api user --jq '.id' 2>/dev/null || true)
    if [ -n "$id" ] && [ -n "$login" ]; then
      email="${id}+${login}@users.noreply.github.com"
    fi
  fi

  if [ -n "$name" ] && [ "$name" != "null" ] && [ -n "$email" ]; then
    git config --global user.name "$name"
    git config --global user.email "$email"
  else
    printf '\033[1;33mwarning:\033[0m could not derive a git identity from gh; commits will fail.\n' >&2
  fi
}

# gh holds a token but does not wire itself into git unless asked, so https
# pushes would otherwise prompt for a password that does not exist.
configure_credential_helper() {
  if git config --global --get-regexp '^credential\..*github\.com.*\.helper' >/dev/null 2>&1; then
    return 0
  fi
  if gh auth status >/dev/null 2>&1; then
    gh auth setup-git 2>/dev/null || true
  fi
}

configure_identity
configure_credential_helper

# Background gc is a repack of the object store, and it takes the same
# locks the editor's Git extension and your own commits are competing
# for. On this virtiofs mount that competition is already tight enough
# (see .vscode/settings.json's files.watcherExclude comment) without a
# repack firing mid-commit. Run `git gc` by hand when you want one.
git config --global gc.auto 0
