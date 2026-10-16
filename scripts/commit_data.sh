#!/usr/bin/env bash
# Commit generated data on top of the latest main. Only this workflow writes these paths (one run at a time),
# so the freshly built files simply replace whatever main has for them; code changes pushed meanwhile are kept.
set -euo pipefail
message="$1"; shift
stash=$(mktemp -d)
for p in "$@"; do [ -e "$p" ] && mkdir -p "$stash/$(dirname "$p")" && cp -r "$p" "$stash/$p"; done
git fetch -q origin main
git reset -q --hard origin/main
for p in "$@"; do
  if [ -e "$stash/$p" ]; then rm -rf "$p"; mkdir -p "$(dirname "$p")"; cp -r "$stash/$p" "$p"; fi
done
git add -A "$@"
if git diff --cached --quiet; then echo "No changes."; exit 0; fi
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -qm "$message $(date -u +%Y-%m-%d)"
git push -q origin HEAD:main
git log --oneline -1
