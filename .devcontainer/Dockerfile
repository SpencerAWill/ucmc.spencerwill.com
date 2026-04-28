FROM mcr.microsoft.com/devcontainers/base:debian

# Image-intrinsic env: static values that should apply regardless of how
# the container is launched (VS Code devcontainer, `docker-compose up`,
# `docker exec`, CI smoke-tests, etc.). Dynamic/per-host values like TZ
# stay in devcontainer.json so they can read ${localEnv:...}.
ENV CLAUDE_CONFIG_DIR=/home/vscode/.claude \
    NODE_OPTIONS=--max-old-space-size=4096 \
    DEVCONTAINER=true \
    PATH=/home/vscode/.pulumi/bin:${PATH}

# Pre-create volume mount points with correct ownership so Docker
# initializes named volumes as vscode instead of root
RUN for dir in \
      .local/share/pnpm/store \
      .pulumi \
      .config/gh \
      .claude \
      .cache/ms-playwright \
    ; do \
      mkdir -p "/home/vscode/$dir"; \
    done \
    && chown -R vscode:vscode \
      /home/vscode/.local \
      /home/vscode/.pulumi \
      /home/vscode/.config/gh \
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

# Install Pulumi CLI and Claude Code CLI for vscode user
USER vscode
RUN curl -fsSL https://get.pulumi.com | sh
RUN curl -fsSL https://claude.ai/install.sh | bash
USER root
