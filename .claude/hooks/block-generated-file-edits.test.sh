#!/usr/bin/env bash
#
# Regression suite for `block-generated-file-edits.sh`. Run it after any
# change to that hook:
#
#   .claude/hooks/block-generated-file-edits.test.sh
#
# It exists because the first cut of the hook scanned the whole Bash
# command string and so denied a heredoc that merely *documented* an
# in-place edit -- it blocked the very commit that documented it. The
# "prose about the guard" case pins that. Both directions matter: a guard
# that denies ordinary reads is as unusable as one that misses writes.
#
# Each line of the .cases.tsv fixture is: EXPECTED <tab> label <tab> payload.
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
HOOK="$here/block-generated-file-edits.sh"
CASES="$here/block-generated-file-edits.cases.tsv"

fail=0
while IFS=$'\t' read -r expected label payload; do
  [ -z "${expected:-}" ] && continue
  out=$(printf '%s' "$payload" | "$HOOK")
  if [ -z "$out" ]; then actual=ALLOW; else actual=DENY; fi
  if [ "$actual" = "$expected" ]; then
    mark="ok  "
  else
    mark="FAIL"
    fail=1
  fi
  printf '%s  %-6s %s\n' "$mark" "$actual" "$label"
done <"$CASES"

if [ "$fail" -ne 0 ]; then
  echo "FAILED" >&2
fi
exit "$fail"
