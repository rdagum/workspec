#!/usr/bin/env bash
# Tests for select_item.sh. Each case builds a throwaway origin + clone with
# WorkSpec items and branches, runs the selector inside the clone, and checks
# its output. Run: bash .claude/skills/workspec-daily-work/scripts/test_select_item.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
SELECT="$here/select_item.sh"
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

pass=0
fail=0
n=0

# item <id> <status> <assignee> <priority> [deps...]
item() {
  local id=$1 st=$2 who=$3 pri=$4; shift 4
  {
    echo "---"
    echo "id: $id"
    echo "title: Item $id"
    echo "status: $st"
    echo "priority: $pri"
    echo "assignee: $who"
    echo "created: 2026-10-08"
    if [ $# -gt 0 ]; then echo "depends_on:"; for d in "$@"; do echo "  - $d"; done
    else echo "depends_on: []"; fi
    echo "---"
    echo
    echo "# Summary"
  } > ".workspec/items/$id.md"
}

# Fresh origin (with develop) and a clone; leaves the cwd in the clone.
setup() {
  n=$((n + 1))
  local dir="$root/case$n"
  git init -q --bare "$dir/origin.git"
  git clone -q "$dir/origin.git" "$dir/clone" 2>/dev/null
  cd "$dir/clone"
  git config core.autocrlf false
  git checkout -q -b develop
  mkdir -p .workspec/items
}

publish() { git add -A && git commit -qm "${1:-items}" && git push -q origin HEAD:develop; }

# A pushed branch with one commit on top of <from>.
branch() {
  local name=$1 from=$2
  git checkout -q -b "$name" "$from"
  echo "$name" > "$(echo "$name" | tr '/' '_').txt"
  git add -A && git commit -qm "work on $name" && git push -q origin "$name"
  git checkout -q develop
}

run() { bash "$SELECT" 2> "$root/stderr" || true; }

expect() {
  local label=$1 key=$2 want=$3 got
  got=$(run | awk -F'\t' -v k="$key" '$1 == k { print $2; exit }')
  if [ "$got" = "$want" ]; then pass=$((pass + 1)); echo "ok   $label"
  else fail=$((fail + 1)); echo "FAIL $label: $key = '$got', want '$want'"; sed 's/^/     /' "$root/stderr"; fi
}

expect_skip() {
  local label=$1 pattern=$2
  run > /dev/null
  if grep -q -- "$pattern" "$root/stderr"; then pass=$((pass + 1)); echo "ok   $label"
  else fail=$((fail + 1)); echo "FAIL $label: stderr lacks '$pattern'"; sed 's/^/     /' "$root/stderr"; fi
}

# --- cases -------------------------------------------------------------------

setup; item TASK-000001 Ready Opus medium; publish
expect "no dependencies: picked" id TASK-000001
expect "no dependencies: integration base" base_branch develop
expect "no dependencies: not stacked" stacked_on -

setup; item TASK-000001 Ready Opus medium; item TASK-000002 Ready Opus critical; item TASK-000003 Ready rdagum critical; publish
expect "critical outranks medium" id TASK-000002
expect_skip "a person's item is skipped" "TASK-000003.*not an agent"

setup; item BUG-000001 Done Opus high; item TASK-000002 Ready Opus high BUG-000001; publish
expect "Done dependency: picked" id TASK-000002
expect "Done dependency: integration base" base_branch develop

setup; item BUG-000001 "In Progress" Opus high; item TASK-000002 Ready Opus high BUG-000001; publish
expect "In Progress dependency: nothing eligible" id ""
expect_skip "In Progress dependency: reason" "TASK-000002.*blocked by BUG-000001(In Progress)"

setup; item BUG-000001 Review Opus high; item TASK-000002 Ready Opus high BUG-000001; publish
branch workspec/bug-000001-fix origin/develop
expect "Review + unmerged branch: picked" id TASK-000002
expect "Review + unmerged branch: stacked base" base_branch workspec/bug-000001-fix
expect "Review + unmerged branch: stacked on" stacked_on BUG-000001

setup; item BUG-000001 Review Opus high; item TASK-000002 Ready Opus high BUG-000001; publish
branch workspec/bug-000001-fix origin/develop
git merge -q --no-ff workspec/bug-000001-fix -m merge && git push -q origin develop
expect "Review + merged branch: integration base" base_branch develop
expect "Review + merged branch: not stacked" stacked_on -

setup; item BUG-000001 Review Opus high; item TASK-000002 Ready Opus high BUG-000001; publish
expect "Review + branch deleted on merge: integration base" base_branch develop

setup; item BUG-000001 Review Opus high; item TASK-000002 Review Opus high BUG-000001
item STORY-000003 Ready Opus high BUG-000001 TASK-000002; publish
branch workspec/bug-000001-fix origin/develop
branch workspec/task-000002-next origin/workspec/bug-000001-fix
expect "two unmerged deps on one stack: tip" base_branch workspec/task-000002-next
expect "two unmerged deps on one stack: stacked on" stacked_on TASK-000002

setup; item BUG-000001 Review Opus high; item TASK-000002 Review Opus high
item STORY-000003 Ready Opus high BUG-000001 TASK-000002; publish
branch workspec/bug-000001-fix origin/develop
branch workspec/task-000002-other origin/develop
expect "unmerged deps on separate branches: nothing eligible" id ""
expect_skip "unmerged deps on separate branches: reason" "STORY-000003.*separate branches"

setup; item BUG-000001 Review Opus high; item TASK-000002 Ready Opus high BUG-000001; publish
branch workspec/bug-000001-fix origin/develop
branch workspec/bug-000001-again origin/develop
expect_skip "several dependency branches: blocked" "TASK-000002.*several workspec/bug-000001-"

setup; item TASK-000001 Ready Opus high; publish
branch workspec/task-000001-started origin/develop
expect_skip "own branch exists: skipped" "TASK-000001.*branch already exists"

setup; item BUG-000001 "In Progress" Opus high; item TASK-000002 Ready Opus high BUG-000001; publish
branch workspec/bug-000001-fix origin/develop
# Another run publishes Review on origin; this clone's working tree stays stale.
other="$root/other$n"; git clone -q -c core.autocrlf=false -b develop "$(git remote get-url origin)" "$other"
(cd "$other" && sed -i 's/^status: In Progress$/status: Review/' .workspec/items/BUG-000001.md \
  && git commit -qam review && git push -q origin develop)
git fetch -q origin
expect "statuses come from origin, not the stale checkout" stacked_on BUG-000001

setup; item TASK-000001 Ready Opus high; publish
printf -- '---\r\nid: TASK-000009\r\ntitle: CRLF item\r\nstatus: Ready\r\npriority: critical\r\nassignee: Opus\r\ncreated: 2026-10-01\r\ndepends_on: []\r\n---\r\n' > .workspec/items/TASK-000009.md
publish
expect "CRLF item is parsed" id TASK-000009

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
