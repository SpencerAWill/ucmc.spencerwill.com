#!/usr/bin/env bash
#
# Stop hook: before Claude ends a turn that changed TypeScript, lint the
# changed files and typecheck the packages they belong to. A failure blocks
# the stop and hands Claude the errors, so "done" means the code at least
# passes the checks CI runs first.
#
# ESLint is where most of this repo's invariants are machine-checked: the
# feature import boundaries, the `inArray` ban (#291), the server-only
# boundary. Instructions in AGENTS.md and the rules are advisory; this is
# the deterministic half.
#
# Cheap by construction:
#   - nothing to do when no code or tsconfig differs from HEAD (a turn that
#     only answered a question, or after a commit -- pre-commit already ran
#     the same checks). Deletions and tsconfig edits count, as they do in
#     pre-commit: removing a module breaks whatever imported it;
#   - nothing to do when the changed code is byte-identical to the last
#     state that passed in this session (a fingerprint in $TMPDIR);
#   - ESLint sees only the changed files, and the web lint and typecheck run
#     in parallel (~10s on this repo).
#
# ESLint runs from inside each package, never the repo root: the web
# config's `import/no-restricted-paths` zones resolve against cwd and fail
# OPEN from the root (see AGENTS.md). The binaries are called directly, not
# through `pnpm exec`: pnpm may install first when the manifest changed, and
# the checks run in parallel, so two of them would install at once.
#
# After a block, Claude's next stop arrives with `stop_hook_active` set:
#   - code unchanged since the check that failed: the stop goes through.
#     Claude stopped on purpose (to say why the errors should stay, or
#     because the user said to leave them), and re-running would only
#     repeat the same errors;
#   - code changed: that was a fix attempt, so it is checked again. A
#     wrong fix is caught here rather than ending the turn unchecked.
# Re-checks are capped: after MAX_BLOCKS consecutive blocks the stop goes
# through with a warning to the user, so a fix loop can't run unbounded.
# (Claude Code's own cap counts only blocks with no tool call in between,
# and a fix attempt is a tool call, so it would never trip.)
# Set CLAUDE_SKIP_STOP_VERIFY=1 in the environment to switch it off.
# File lists are word-split on purpose throughout (paths here have no spaces).
# shellcheck disable=SC2086
set -uo pipefail

MAX_BLOCKS=3

payload=$(cat)

# Without jq, `stop_hook_active` can't be read and every stop would block.
if ! command -v jq >/dev/null; then
  exit 0
fi
if [[ ${CLAUDE_SKIP_STOP_VERIFY:-} == "1" ]]; then
  exit 0
fi
retry=$(jq -r '.stop_hook_active // false' <<<"$payload")

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --verify -q HEAD >/dev/null || exit 0

# Everything that can change a lint or typecheck result, deletions included.
changed=$(
  {
    git diff --name-only HEAD
    git ls-files --others --exclude-standard
  } | grep -E '\.(ts|tsx|mts|cts|js|mjs|cjs)$|(^|/)tsconfig[^/]*\.json$' | sort -u
)

# Per-session state in $TMPDIR: the fingerprint that last passed, and the
# fingerprint that last failed with the count of consecutive blocks.
session=$(jq -r '.session_id // "default"' <<<"$payload")
stamp="${TMPDIR:-/tmp}/ucmc-verify-on-stop-${session//[^A-Za-z0-9_-]/_}"
failed_stamp="$stamp.failed"
blocks_stamp="$stamp.blocks"
clear_failure() {
  rm -f "$failed_stamp" "$blocks_stamp"
}

if [[ -z $changed ]]; then
  clear_failure
  exit 0
fi

fingerprint=$(
  {
    git diff HEAD -- $changed
    git ls-files --others --exclude-standard -- $changed | git hash-object --stdin-paths
  } | git hash-object --stdin
)
if [[ -f $stamp && $(cat "$stamp") == "$fingerprint" ]]; then
  clear_failure
  exit 0
fi

if [[ $retry == "true" ]]; then
  # Stopped again without touching the code that failed: let it through.
  if [[ -f $failed_stamp && $(cat "$failed_stamp") == "$fingerprint" ]]; then
    clear_failure
    exit 0
  fi
  blocks=$(cat "$blocks_stamp" 2>/dev/null || echo 0)
else
  # A fresh stop starts a new streak.
  blocks=0
fi

logs=$(mktemp -d)
trap 'rm -rf "$logs"' EXIT
pids=""
names=""

# run <name> <dir> <command...>: run a check in the background, logging to
# $logs/<name>.
run() {
  name=$1
  dir=$2
  shift 2
  (cd "$dir" && "$@") >"$logs/$name" 2>&1 &
  pids="$pids $!"
  names="$names $name"
}

for pkg in apps/ucmc-web infra/cloudflare infra/github; do
  if ! grep -q "^$pkg/" <<<"$changed"; then
    continue
  fi
  label=${pkg##*/}
  # Lint only source files that still exist; generated files are not linted.
  files=$(
    grep "^$pkg/" <<<"$changed" | grep -vE '\.json$|\.gen\.' |
      while read -r f; do [[ -f $f ]] && echo "${f#"$pkg/"}"; done
  )
  if [[ -n $files ]]; then
    run "eslint-$label" "$pkg" node_modules/.bin/eslint --no-warn-ignored -- $files
  fi
  run "tsc-$label" "$pkg" node_modules/.bin/tsc --noEmit
done

failed=""
set -- $names
for pid in $pids; do
  if ! wait "$pid"; then
    failed="$failed $1"
  fi
  shift
done

if [[ -z $failed ]]; then
  echo "$fingerprint" >"$stamp"
  clear_failure
  exit 0
fi

blocks=$((blocks + 1))
if ((blocks > MAX_BLOCKS)); then
  # Out of re-checks: end the turn, but tell the user it ended red.
  clear_failure
  jq -n --arg msg "verify-on-stop: lint/typecheck still failing (${failed# }) after $MAX_BLOCKS blocked stops; letting the turn end." \
    '{systemMessage: $msg}'
  exit 0
fi
echo "$fingerprint" >"$failed_stamp"
echo "$blocks" >"$blocks_stamp"

{
  echo "Stop blocked by .claude/hooks/verify-on-stop.sh (block $blocks of $MAX_BLOCKS): checks failed on the files changed since HEAD."
  echo "Fix them before finishing. To leave them failing, say why and stop again without changing code; that stop goes through."
  for name in $failed; do
    echo
    echo "== $name"
    head -c 4000 "$logs/$name"
  done
} >&2
exit 2
