#!/usr/bin/env bash
# Watch the upstream dsh-superagent prototype without a model call.
#
# Prints one line per run: "unchanged" when upstream main is still the commit recorded in .upstream-commit, or the new
# commits (subject lines) and the files they touch when it moved. Exit 0 either way; exit 2 when upstream is unreachable,
# so a scheduler can tell "nothing new" from "the check itself failed".
#
#   scripts/upstream-check.sh            # compare and report, do not record
#   scripts/upstream-check.sh --record   # compare, report, and record the new head
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/deepseek-ai/dsh-superagent-prototype.git}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$ROOT/.upstream-commit"
RECORD=false
[[ "${1:-}" == "--record" ]] && RECORD=true

last=""
[[ -f "$STAMP" ]] && last="$(tr -d '[:space:]' < "$STAMP")"

head="$(git ls-remote "$UPSTREAM_URL" "refs/heads/$UPSTREAM_BRANCH" 2>/dev/null | awk '{print $1}')" || true
[[ -z "$head" ]] && { echo "upstream-check: cannot reach $UPSTREAM_URL" >&2; exit 2; }

if [[ "$head" == "$last" ]]; then
  echo "upstream $UPSTREAM_BRANCH unchanged ($head)"
  exit 0
fi

if [[ -z "$last" ]]; then
  echo "upstream $UPSTREAM_BRANCH first observation at $head (recording; no diff)"
  $RECORD && printf '%s\n' "$head" > "$STAMP"
  exit 0
fi

echo "upstream $UPSTREAM_BRANCH moved: ${last:0:12} -> ${head:0:12}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone -q --bare --filter=blob:none --no-tags "$UPSTREAM_URL" "$tmp/upstream" 2>/dev/null
git -C "$tmp/upstream" log --no-merges --format='  %h %s' "$last..$head" 2>/dev/null || true
echo "  files:"
git -C "$tmp/upstream" diff --name-only "$last..$head" 2>/dev/null | sed 's/^/    /' || true
echo "  (the plugin depends on src/sources/* and lib/kind-*.d.ts; anything touching key()/threadKey()/SourceKind/SourceContext needs a look)"

$RECORD && printf '%s\n' "$head" > "$STAMP"
exit 0
