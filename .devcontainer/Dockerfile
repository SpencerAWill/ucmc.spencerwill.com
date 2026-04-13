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
    ; do \
      mkdir -p "/home/vscode/$dir"; \
    done \
    && chown -R vscode:vscode \
      /home/vscode/.local \
      /home/vscode/.pulumi \
      /home/vscode/.config/gh \
      /home/vscode/.claude

# Persist bash/zsh history across container rebuilds via a named volume
# mounted at /commandhistory. Symlinks beat HISTFILE env because they
# survive any oh-my-zsh or user .rc override.
RUN mkdir -p /commandhistory \
    && touch /commandhistory/.bash_history /commandhistory/.zsh_history \
    && chown -R vscode:vscode /commandhistory \
    && ln -sfn /commandhistory/.bash_history /home/vscode/.bash_history \
    && ln -sfn /commandhistory/.zsh_history /home/vscode/.zsh_history \
    && chown -h vscode:vscode /home/vscode/.bash_history /home/vscode/.zsh_history

# Install Pulumi CLI and Claude Code CLI for vscode user
USER vscode
RUN curl -fsSL https://get.pulumi.com | sh
RUN curl -fsSL https://claude.ai/install.sh | bash
USER root
