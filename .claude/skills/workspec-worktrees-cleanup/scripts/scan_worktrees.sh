#!/usr/bin/env bash
# Find — and with --apply, remove — the worktrees the daily-workspec routine
# left behind whose workspec pull request has been merged.
#
# A worktree is removed only when ALL of these hold:
#   - it is a registered linked worktree under <main>/.claude/worktrees/, not
#     locked, and not the worktree this script runs from;
#   - the routine created it: every Claude session transcript recorded for it
#     (~/.claude/projects/<encoded path>/*.jsonl) opens with the
#     <scheduled-task name="daily-workspec..."> prompt, or — the manual
#     invocation path — it is named after an item id, e.g. task-000019;
#   - it can be tied to a workspec/* pull request, and that PR is MERGED;
#   - it has no uncommitted or untracked (non-ignored) changes, and every
#     initialised submodule in it is clean with its HEAD on a remote branch;
#   - its HEAD holds no work missing upstream: HEAD is an ancestor of the
#     merged PR's head, or `git cherry` against the base branch finds no commit
#     whose patch is absent there (so rebased copies count as merged).
#
# Tying a worktree to a PR, first match wins — a worktree is often detached or
# on a Desktop "claude/*" branch, and Desktop reuses worktrees across runs:
#   1. its current branch is workspec/*           -> PR with that head branch
#   2. its HEAD sha is some workspec PR's head    -> that PR
#   3. its HEAD commit message names an item id   -> PR on workspec/<id>-*
#   4. the newest workspec/* branch in its reflog -> PR with that head branch
#
# Local workspec/* branches not checked out anywhere get the same PR and
# no-lost-work checks, and are deleted with --apply when they pass.
#
# Output, one tab-separated line per subject:
#   VERDICT  name  branch  pr  reason
# VERDICT is REMOVE / KEEP / STRAY (dry run), REMOVED / FAILED (--apply), or
# BRANCH-DELETE / BRANCH-KEEP / BRANCH-DELETED for local branches.
set -euo pipefail

apply=0
case "${1:-}" in
  --apply) apply=1 ;;
  "") ;;
  *) echo "usage: $0 [--apply]" >&2; exit 2 ;;
esac

lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

self=$(lc "$(git rev-parse --show-toplevel)")
main=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
root="$main/.claude/worktrees"
cd "$main"

git fetch origin --prune --quiet

if git show-ref --verify --quiet refs/remotes/origin/develop; then
  base=develop
else
  base=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
fi

# number \t state \t headRefName \t headRefOid, newest PR first.
prs=$(gh pr list --state all --limit 500 \
        --json number,state,headRefName,headRefOid \
        --jq '.[] | select(.headRefName | startswith("workspec/"))
                  | [.number, .state, .headRefName, .headRefOid] | @tsv')

pr_by_branch() { awk -F'\t' -v b="$1" '$3 == b { print; exit }' <<< "$prs"; }
pr_by_sha()    { awk -F'\t' -v s="$1" '$4 == s { print; exit }' <<< "$prs"; }
pr_by_id()     { awk -F'\t' -v p="workspec/$1" '$3 == p || index($3, p "-") == 1 { print; exit }' <<< "$prs"; }

# Prints "<pr row>\t<how>" for a worktree, or nothing.
associate() {
  local wt=$1 branch=$2 head=$3 row id rb
  if [[ $branch == workspec/* ]]; then
    row=$(pr_by_branch "$branch"); [ -n "$row" ] && { printf '%s\tbranch\n' "$row"; return; }
  fi
  row=$(pr_by_sha "$head"); [ -n "$row" ] && { printf '%s\tsha\n' "$row"; return; }
  id=$(git log -1 --format=%B "$head" | grep -oE '\b[A-Z]+-[0-9]{3,}\b' | head -1 || true)
  if [ -n "$id" ]; then
    row=$(pr_by_id "$(lc "$id")"); [ -n "$row" ] && { printf '%s\tcommit id\n' "$row"; return; }
  fi
  rb=$(git -C "$wt" reflog --format=%gs 2>/dev/null \
         | grep -oE 'workspec/[A-Za-z0-9._/-]+' | head -1 || true)
  if [ -n "$rb" ]; then
    row=$(pr_by_branch "$rb"); [ -n "$row" ] && { printf '%s\treflog\n' "$row"; return; }
  fi
}

# Empty when every commit in $1 is already upstream; else a short description.
unmerged_work() {
  local head=$1 oid=$2 n
  if [ -n "$oid" ] && git merge-base --is-ancestor "$head" "$oid" 2>/dev/null; then
    return
  fi
  n=$(git cherry "origin/$base" "$head" | grep -c '^+' || true)
  [ "$n" -gt 0 ] && printf '%s commit(s) not on origin/%s' "$n" "$base"
  return 0
}

# Session transcripts live in a folder named after the worktree path with every
# non-alphanumeric character turned into "-"; the drive letter's case varies.
projects="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
# JSON escapes the attribute's quote, hence the backslash.
routine_marker='<scheduled-task name=\"daily-workspec'

# Prints "routine", "manual", or why ownership could not be established.
ownership() {
  local wt=$1 name=$2 enc dir f first total=0 other=0
  if [[ $name =~ ^[a-z]+-[0-9]{3,}$ ]]; then echo manual; return; fi
  enc=$(lc "$(printf '%s' "$wt" | sed 's/[^A-Za-z0-9]/-/g')")
  dir=""
  for f in "$projects"/*/; do
    [ "$(lc "$(basename "$f")")" = "$enc" ] && { dir=$f; break; }
  done
  [ -n "$dir" ] || { echo "no session transcript"; return; }
  for f in "$dir"*.jsonl; do
    [ -f "$f" ] || continue
    total=$((total + 1))
    first=$(grep -m1 '"type":"user"' "$f" || true)
    [[ $first == *"$routine_marker"* ]] || other=$((other + 1))
  done
  if [ "$total" -eq 0 ]; then echo "no session transcript"
  elif [ "$other" -gt 0 ]; then echo "$other of $total sessions were not daily-workspec runs"
  else echo routine; fi
}

emit() { printf '%s\t%s\t%s\t%s\t%s\n' "$@"; }

# Delete every symlink/junction inside a worktree, leaving what it points at.
# The routine junctions <worktree>/.venv to the main checkout's venv, and on
# Windows `git worktree remove` recurses THROUGH junctions: it emptied the
# user's venv until it hit a too-long path. `rm` without -r removes only the
# link (Git Bash sees a junction as a symlink) and `find` does not follow it.
unlink_links() {
  local link
  while IFS= read -r -d '' link; do
    rm -f -- "$link" || return 1
  done < <(find "$1" -type l -print0)
  link=$(find "$1" -type l -print -quit)
  [ -z "$link" ] || { echo "could not unlink $link"; return 1; }
}

# Prints the main venv's installed files that are missing, as a last-line check
# that no removal reached through a link. Silent when the venv is whole.
venv_damage() {
  local py
  for py in "$main/.venv/Scripts/python.exe" "$main/.venv/bin/python"; do
    [ -x "$py" ] && break
  done
  [ -x "$py" ] || return 0
  # importlib.metadata's .files skips missing files on Python 3.12+, so read
  # each RECORD directly.
  "$py" - <<'PY'
import csv, sysconfig
from pathlib import Path
site = Path(sysconfig.get_paths()["purelib"])
for info in sorted(site.glob("*.dist-info")):
    record = info / "RECORD"
    if not record.exists():
        continue
    rows = [r[0] for r in csv.reader(record.read_text(encoding="utf-8").splitlines()) if r]
    missing = [r for r in rows if not r.endswith(".pyc") and not r.startswith("..")
               and not (site / r).exists()]
    if missing:
        print(f"{info.name}: {len(missing)} file(s) missing, e.g. {missing[0]}")
PY
}

# Parse `git worktree list --porcelain` into parallel arrays.
paths=(); heads=(); branches=(); flags=()
while IFS= read -r line; do
  case "$line" in
    "worktree "*) paths+=("${line#worktree }"); heads+=(""); branches+=("(detached)"); flags+=("") ;;
    "HEAD "*)     heads[-1]=${line#HEAD } ;;
    "branch "*)   branches[-1]=${line#branch refs/heads/} ;;
    locked*)      flags[-1]="${flags[-1]} locked" ;;
    prunable*)    flags[-1]="${flags[-1]} prunable" ;;
  esac
done < <(git worktree list --porcelain)

registered=" "
for i in "${!paths[@]}"; do
  wt=${paths[$i]}; head=${heads[$i]}; branch=${branches[$i]}; flag=${flags[$i]}
  case "$(lc "$wt")" in "$(lc "$root")"/*) ;; *) continue ;; esac
  name=${wt#"$root"/}
  registered="$registered$name "

  if [[ $flag == *prunable* ]]; then
    emit KEEP "$name" "$branch" - "directory is gone; 'git worktree prune' clears it"; continue
  fi
  if [[ $flag == *locked* ]]; then
    emit KEEP "$name" "$branch" - "locked"; continue
  fi
  if [ "$(lc "$wt")" = "$self" ]; then
    emit KEEP "$name" "$branch" - "this script is running inside it"; continue
  fi

  owner=$(ownership "$wt" "$name")
  if [ "$owner" != routine ] && [ "$owner" != manual ]; then
    emit KEEP "$name" "$branch" - "not a daily-workspec worktree: $owner"; continue
  fi

  assoc=$(associate "$wt" "$branch" "$head")
  if [ -z "$assoc" ]; then
    emit KEEP "$name" "$branch" - "no workspec pull request found"; continue
  fi
  IFS=$'\t' read -r num state _ oid how <<< "$assoc"
  if [ "$state" != MERGED ]; then
    emit KEEP "$name" "$branch" "#$num" "PR is $state (matched by $how)"; continue
  fi

  dirty=$(git -C "$wt" status --porcelain --ignore-submodules=all | head -3 | cut -c4- | paste -sd, - || true)
  if [ -n "$dirty" ]; then
    emit KEEP "$name" "$branch" "#$num" "uncommitted changes: $dirty"; continue
  fi
  sub=$(git -C "$wt" submodule foreach --quiet --recursive \
          'if [ -n "$(git status --porcelain)" ]; then echo "$displaypath dirty";
           elif [ -z "$(git branch -r --contains HEAD 2>/dev/null)" ]; then echo "$displaypath unpushed"; fi' \
          2>/dev/null | paste -sd, - || true)
  if [ -n "$sub" ]; then
    emit KEEP "$name" "$branch" "#$num" "submodule: $sub"; continue
  fi
  lost=$(unmerged_work "$head" "$oid")
  if [ -n "$lost" ]; then
    emit KEEP "$name" "$branch" "#$num" "$lost"; continue
  fi

  if [ "$apply" -eq 0 ]; then
    emit REMOVE "$name" "$branch" "#$num" "merged, clean (matched by $how)"; continue
  fi
  if err=$(unlink_links "$wt" 2>&1) && err=$(git worktree remove --force "$wt" 2>&1); then
    note="removed"
    if [ "$branch" != "(detached)" ] && git branch -D "$branch" >/dev/null 2>&1; then
      note="removed, deleted branch $branch"
    fi
    emit REMOVED "$name" "$branch" "#$num" "$note"
  else
    emit FAILED "$name" "$branch" "#$num" "$(printf '%s' "$err" | tr '\n' ' ')"
  fi
done

# Directories under the root that git does not know about: report, never touch.
if [ -d "$root" ]; then
  for d in "$root"/*/; do
    [ -d "$d" ] || continue
    name=$(basename "$d")
    [[ $registered == *" $name "* ]] && continue
    emit STRAY "$name" - - "not a registered worktree; left alone"
  done
fi

# Local workspec branches that no worktree has checked out.
checked_out=$(git worktree list --porcelain | sed -n 's#^branch refs/heads/##p')
git for-each-ref --format='%(refname:short) %(objectname)' refs/heads/workspec/ |
while read -r b sha; do
  grep -qxF "$b" <<< "$checked_out" && continue
  row=$(pr_by_branch "$b")
  if [ -z "$row" ]; then
    emit BRANCH-KEEP "$b" "$b" - "no pull request"; continue
  fi
  IFS=$'\t' read -r num state _ oid <<< "$row"
  if [ "$state" != MERGED ]; then
    emit BRANCH-KEEP "$b" "$b" "#$num" "PR is $state"; continue
  fi
  lost=$(unmerged_work "$sha" "$oid")
  if [ -n "$lost" ]; then
    emit BRANCH-KEEP "$b" "$b" "#$num" "$lost"; continue
  fi
  if [ "$apply" -eq 0 ]; then
    emit BRANCH-DELETE "$b" "$b" "#$num" "merged"
  elif git branch -D "$b" >/dev/null 2>&1; then
    emit BRANCH-DELETED "$b" "$b" "#$num" "deleted"
  else
    emit BRANCH-KEEP "$b" "$b" "#$num" "git branch -D failed"
  fi
done

if [ "$apply" -eq 1 ]; then
  git worktree prune
  venv_damage | while IFS= read -r line; do
    emit VENV-DAMAGED .venv - - "$line"
  done
fi
exit 0
