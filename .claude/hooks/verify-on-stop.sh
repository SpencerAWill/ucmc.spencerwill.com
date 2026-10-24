#!/usr/bin/env bash
#
# Stop hook: before Claude ends a turn that changed TypeScript, lint the
# changed files and typecheck the packages they belong to. A failure blocks
# the stop and hands Claude the errors, so "done" means the code at least
# passes the checks CI runs first.
#
# ESLint is where most of this repo's invariants are machine-checked: the
# feature import boundaries, the `inArray` ban (#291), the server-only
# boundary. Instructions in CLAUDE.md and the rules are advisory; this is
# the deterministic half.
#
# Cheap by construction:
#   - nothing to do when no .ts/.tsx/.js/.mjs differs from HEAD (a turn that
#     only answered a question, or after a commit -- pre-commit already ran
#     the same checks);
#   - nothing to do when the changed code is byte-identical to the last
#     state that passed in this session (a fingerprint in $TMPDIR);
#   - ESLint sees only the changed files, and the web lint and typecheck run
#     in parallel (~10s on this repo).
#
# ESLint runs from inside each package, never the repo root: the web
# config's `import/no-restricted-paths` zones resolve against cwd and fail
# OPEN from the root (see CLAUDE.md).
#
# It blocks once per stop. When Claude stops again straight after being
# blocked (`stop_hook_active`), the stop goes through, so a check Claude
# can't fix -- or one the user said to leave -- never traps the session.
# Set CLAUDE_SKIP_STOP_VERIFY=1 in the environment to switch it off.
# File lists are word-split on purpose throughout (paths here have no spaces).
# shellcheck disable=SC2086
set -uo pipefail

payload=$(cat)

if [[ $(jq -r '.stop_hook_active // false' <<<"$payload") == "true" ]]; then
  exit 0
fi
if [[ ${CLAUDE_SKIP_STOP_VERIFY:-} == "1" ]]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --verify -q HEAD >/dev/null || exit 0

changed=$(
  {
    git diff --name-only --diff-filter=d HEAD
    git ls-files --others --exclude-standard
  } | grep -E '\.(ts|tsx|js|mjs)$' | grep -v '\.gen\.' | sort -u
)
if [[ -z $changed ]]; then
  exit 0
fi

session=$(jq -r '.session_id // "default"' <<<"$payload")
stamp="${TMPDIR:-/tmp}/ucmc-verify-on-stop-${session//[^A-Za-z0-9_-]/_}"
fingerprint=$(
  {
    git diff HEAD -- $changed
    git ls-files --others --exclude-standard -- $changed | xargs shasum 2>/dev/null
  } | shasum | cut -d' ' -f1
)
if [[ -f $stamp && $(cat "$stamp") == "$fingerprint" ]]; then
  exit 0
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
  files=$(grep "^$pkg/" <<<"$changed" | sed "s#^$pkg/##")
  if [[ -z $files ]]; then
    continue
  fi
  label=${pkg##*/}
  run "eslint-$label" "$pkg" pnpm -s exec eslint --no-warn-ignored -- $files
  run "tsc-$label" "$pkg" pnpm -s exec tsc --noEmit
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
  exit 0
fi

{
  echo "Stop blocked by .claude/hooks/verify-on-stop.sh: checks failed on the files changed since HEAD."
  echo "Fix them before finishing, or say why they should stay failing (stopping again goes through)."
  for name in $failed; do
    echo
    echo "== $name"
    head -c 4000 "$logs/$name"
  done
} >&2
exit 2
