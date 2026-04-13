FROM mcr.microsoft.com/devcontainers/base:debian

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

# Install Pulumi CLI and Claude Code CLI for vscode user
USER vscode
RUN curl -fsSL https://get.pulumi.com | sh
RUN curl -fsSL https://claude.ai/install.sh | bash
USER root
