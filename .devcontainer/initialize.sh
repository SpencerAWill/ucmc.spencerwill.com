#!/usr/bin/env bash
# Runs on the HOST, before the container is created or started — so it can
# only assume host tools, nothing from the image.
#
# Sole job: guarantee the bind-mount source for the container's gh config
# exists. docker-compose.yml bind-mounts ${HOME}/.config/gh into the
# container so `gh auth login` on the host carries in. Docker invents a
# missing bind source as a **root-owned** directory, which gh then cannot
# write to from inside the container — the failure looks like gh silently
# failing to persist auth rather than anything mount-related.
#
# This is a script rather than an inline `initializeCommand` string
# because that string is not portably shell-interpreted: some clients
# split it on whitespace and exec it directly, so an inline
# `mkdir -p "$HOME/.config/gh"` can create a literal directory named
# `"$HOME` in the repo root. Borrowed, with the same reasoning, from the
# www.spencerwill.com devcontainer.
set -euo pipefail

mkdir -p "$HOME/.config/gh"
