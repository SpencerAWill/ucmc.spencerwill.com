FROM mcr.microsoft.com/devcontainers/base:debian

# Image-intrinsic env: static values that should apply regardless of how
# the container is launched (VS Code devcontainer, `docker-compose up`,
# `docker exec`, CI smoke-tests, etc.). Dynamic/per-host values like TZ
# stay in devcontainer.json so they can read ${localEnv:...}.
# COREPACK_ENABLE_DOWNLOAD_PROMPT=0: corepack otherwise prompts "Do you want
# to continue?" before downloading the pnpm pinned in package.json's
# packageManager field. Node comes from the node:2 feature with
# pnpmVersion:"none", so corepack fetches pnpm on first use — meaning
# update-content's `pnpm install` triggers that prompt and hangs an
# unattended rebuild. 0 makes it download without asking.
ENV CLAUDE_CONFIG_DIR=/home/vscode/.claude \
    NODE_OPTIONS=--max-old-space-size=4096 \
    DEVCONTAINER=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PATH=/home/vscode/.pulumi/bin:${PATH}

# Pre-create volume mount points with correct ownership so Docker
# initializes named volumes as vscode instead of root, plus PNPM_HOME.
# (.config/gh is a host bind-mount, not a named volume, so it's omitted.)
# node_modules is a named volume too, but it mounts at /workspace (a bind
# mount) so it can't be pre-created here — lifecycle.sh claims it instead.
RUN for dir in \
      .local/share/pnpm \
      .pulumi \
      .claude \
      .cache/ms-playwright \
    ; do \
      mkdir -p "/home/vscode/$dir"; \
    done \
    && chown -R vscode:vscode \
      /home/vscode/.local \
      /home/vscode/.pulumi \
      /home/vscode/.claude \
      /home/vscode/.cache

# Persist bash/zsh history across container rebuilds via a named volume
# mounted at /commandhistory. Symlinks beat HISTFILE env because they
# survive any oh-my-zsh or user .rc override.
RUN mkdir -p /commandhistory \
    && touch /commandhistory/.bash_history /commandhistory/.zsh_history \
    && chown -R vscode:vscode /commandhistory \
    && ln -sfn /commandhistory/.bash_history /home/vscode/.bash_history \
    && ln -sfn /commandhistory/.zsh_history /home/vscode/.zsh_history \
    && chown -h vscode:vscode /home/vscode/.bash_history /home/vscode/.zsh_history

# Playwright system dependencies — Chromium needs X11, GTK, GStreamer,
# fonts, and a virtual framebuffer. Installing them here means
# `npx playwright install chromium` and `pnpm e2e` just work after
# rebuild, with no manual `install-deps` step.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       # Core Chromium runtime deps
       libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 \
       libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 \
       libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
       libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
       # Fonts (emoji, CJK, Latin) so text rendering doesn't break
       fonts-noto-color-emoji fonts-liberation fonts-freefont-ttf \
       # Xvfb for headless mode
       xvfb \
    && rm -rf /var/lib/apt/lists/*

# gitleaks, for the pre-commit secret scan (`.husky/pre-commit`, #316).
# No devcontainer feature verifies what it downloads, so the binary is
# fetched from the pinned release and checked against the SHA-256 in that
# release's `gitleaks_<version>_checksums.txt`. Dependabot cannot see this
# pin: bump it by hand, together with GITLEAKS_VERSION / GITLEAKS_SHA256 in
# ci.yml's `secrets` job, and take both checksums from the new release.
# The architecture comes from dpkg rather than BuildKit's TARGETARCH, which
# a legacy (non-BuildKit) build leaves empty (arm64 on Apple silicon,
# amd64 elsewhere).
ARG GITLEAKS_VERSION=8.30.1
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "${arch}" in \
      amd64) asset=linux_x64; sha=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;; \
      arm64) asset=linux_arm64; sha=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080 ;; \
      *) echo "no pinned gitleaks checksum for ${arch}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/gitleaks.tar.gz \
      "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${asset}.tar.gz"; \
    echo "${sha}  /tmp/gitleaks.tar.gz" | sha256sum --check --strict; \
    tar xzf /tmp/gitleaks.tar.gz --no-same-owner -C /usr/local/bin gitleaks; \
    rm /tmp/gitleaks.tar.gz; \
    gitleaks version

# Install Pulumi CLI and Claude Code CLI for vscode user
USER vscode
RUN curl -fsSL https://get.pulumi.com | sh
RUN curl -fsSL https://claude.ai/install.sh | bash
USER root
