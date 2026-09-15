#!/usr/bin/env bash
# Print the branch this repository integrates work into.
#
# Prefers "develop" when the remote has one, otherwise the remote's default
# branch. Nothing about the routine may assume "develop": matchday has one,
# other WorkSpec repos integrate straight into main.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if git ls-remote --exit-code --heads origin develop > /dev/null 2>&1; then
  echo develop
  exit 0
fi

if head=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null); then
  echo "${head#origin/}"
  exit 0
fi

# origin/HEAD is not cached locally; ask the remote directly.
if head=$(git ls-remote --symref origin HEAD 2>/dev/null | awk '/^ref:/{sub("refs/heads/","",$2); print $2; exit}') && [ -n "$head" ]; then
  echo "$head"
  exit 0
fi

echo "main"
