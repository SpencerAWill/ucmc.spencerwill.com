#!/usr/bin/env bash
#
# PreToolUse guard: generated files are written by the build, never by hand.
#
# Today that means `apps/ucmc-web/src/routeTree.gen.ts`, produced by
# @tanstack/router-plugin during `vite dev` / `vite build`. It IS committed
# (typecheck and CI read it), so it looks editable -- but a hand-edit is
# silently clobbered on the next build, and a hand-edit that *disagrees*
# with the route files is worse: `tsc` passes against the fake tree while
# the real routes 404.
#
# The `permissions.deny` rules in `.claude/settings.json` already block the
# Edit and Write tools. This hook is the second layer, because those rules
# cannot see a shell redirect -- an in-place editor, `>`, or `tee` reach
# the file through Bash. Regenerate instead:
#
#   pnpm --filter ucmc-web build     # or `dev`
#
# Reads the PreToolUse payload on stdin, prints a deny decision, exits 0.
set -euo pipefail

payload=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$payload")

REASON='Generated file: do not hand-edit. Regenerate with `pnpm --filter ucmc-web build` (or `dev`) and commit the result.'

deny() {
  jq -n --arg reason "$REASON" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

case "$tool" in
  Write | Edit | NotebookEdit)
    file=$(jq -r '.tool_input.file_path // ""' <<<"$payload")
    if [[ $file =~ \.gen\.(ts|tsx|js|jsx|mjs|cjs)$ ]]; then
      deny
    fi
    ;;
  Bash)
    cmd=$(jq -r '.tool_input.command // ""' <<<"$payload")
    # Cheap bail-out: no generated path named anywhere, nothing to weigh.
    if [[ $cmd != *.gen.* ]]; then
      exit 0
    fi
    # Split on shell separators and inspect each segment's HEAD -- the
    # word that decides which program actually runs. Scanning the whole
    # command string instead is what makes this class of guard unusable:
    # a heredoc that merely *documents* an in-place edit (this repo's
    # CLAUDE.md does) reads identically to one that performs it. The
    # head check costs nothing and removes that false-positive class.
    #
    # Reads stay allowed on purpose: `git diff --exit-code
    # .../routeTree.gen.ts` is how pr-preflight verifies the file is in
    # sync, and grep/cat over it are ordinary navigation.
    while IFS= read -r segment; do
      head=$(awk '{print $1}' <<<"$segment")
      head=${head##*/}
      case "$head" in
        sed | perl | ed)
          if [[ $segment == *-i* && $segment == *.gen.* ]]; then
            deny
          fi
          ;;
        tee)
          if [[ $segment == *.gen.* ]]; then
            deny
          fi
          ;;
      esac
      # A redirect names its target structurally (`> path`), so matching
      # it anywhere in the segment carries no prose ambiguity.
      if [[ $segment =~ \>\>?[[:space:]]*[^[:space:]\;\|\&]*\.gen\. ]]; then
        deny
      fi
    done < <(printf '%s\n' "$cmd" | tr ';|&' '\n')
    ;;
esac

exit 0
