#!/usr/bin/env bash
# Pick the single WorkSpec item for today's automated run.
#
# Eligible: status Ready, assignee is an agent handle, every depends_on item is
# satisfied, and no branch for it exists yet. Ordered by priority (critical/high
# > medium > low), then oldest created, then lowest id.
#
# A dependency is satisfied when it is Done, or when it is in Review and its
# workspec/<id>-* branch is pushed (its PR is open, not merged yet). An item
# with an unmerged dependency is stacked: it branches off that dependency's
# branch and its PR targets it. Several unmerged dependencies must sit on one
# stack (one branch contains the others); otherwise the item waits.
#
# Statuses are read from origin/<integration branch>, where the routine
# publishes its claim and review status commits, so a stale local checkout
# cannot hide them. Without that ref the working tree is read instead.
#
# Prints "NONE\t<reason>" or a "key\tvalue" block for the winner, followed by
# the runners-up on stderr so the caller can report what it skipped.
set -euo pipefail
# Git Bash on Windows rewrites "origin/develop:.workspec/..." into a Windows
# path; these turn that off (and are ignored everywhere else).
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"

here=$(cd "$(dirname "$0")" && pwd)
cd "$(git rev-parse --show-toplevel)"
ITEMS=.workspec/items
# An assignee is an agent when it names a model. Deriving it this way keeps
# the script generic: no per-project handle list to maintain.
AGENTS="fable opus sonnet haiku"

base=$(bash "$here/resolve_base.sh")
ref=""
if git rev-parse -q --verify "refs/remotes/origin/$base" > /dev/null; then
  ref="origin/$base"
fi

list_items() {
  if [ -n "$ref" ]; then
    git ls-tree --name-only "$ref" "$ITEMS/" 2>/dev/null | grep '\.md$' || true
  elif [ -d "$ITEMS" ]; then
    ls "$ITEMS"/*.md 2>/dev/null || true
  fi
}

read_item() {
  if [ -n "$ref" ]; then git show "$ref:$1" 2>/dev/null; else cat "$1" 2>/dev/null; fi
}

files=$(list_items)
if [ -z "$files" ]; then
  printf 'NONE	no WorkSpec items in %s\n' "${ref:+$ref:}$ITEMS"
  exit 0
fi

# Frontmatter only: one "key<TAB>value" line per scalar, one per list entry.
# Body text is ignored -- some items have prose lines that look like keys.
frontmatter() {
  tr -d '\r' | awk '
    NR == 1 && $0 == "---" { inside = 1; next }
    inside && $0 == "---"  { exit }
    !inside { exit }
    /^[a-z_]+:/ {
      key = $0; sub(/:.*/, "", key)
      val = $0; sub(/^[a-z_]+:[ \t]*/, "", val)
      sub(/[ \t]+$/, "", val)
      list = (val == "") ? key : ""
      if (val != "" && val != "[]") printf "%s\t%s\n", key, val
      next
    }
    /^  - / && list != "" { v = $0; sub(/^  - /, "", v); sub(/[ \t]+$/, "", v); printf "%s\t%s\n", list, v }
  '
}

get() { printf '%s\n' "$1" | awk -F'\t' -v k="$2" '$1 == k { print $2; exit }'; }

status_of() {
  local content
  content=$(read_item "$ITEMS/$1.md") || true
  [ -n "$content" ] || { echo MISSING; return; }
  printf '%s\n' "$content" | frontmatter | awk -F'\t' '$1 == "status" { print $2; exit }'
}

rank() {
  case "$1" in
    critical|urgent|high) echo 0 ;;
    medium)               echo 1 ;;
    *)                    echo 2 ;;
  esac
}

lower() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }

# Remote branch names, and every taken name (local or remote), so a re-run
# never re-takes an in-flight item.
remote_heads=$(git ls-remote --heads origin 2>/dev/null | sed 's#.*refs/heads/##' || true)
taken=$( { git branch --format='%(refname:short)'; printf '%s\n' "$remote_heads"; } \
         | tr 'A-Z' 'a-z' | sort -u )

# The pushed branch of a dependency: "<name>", "" when none, "AMBIGUOUS" when
# several match.
branch_of() {
  local matches
  matches=$(printf '%s\n' "$remote_heads" | grep -i "^workspec/$(lower "$1")-" || true)
  case "$(printf '%s' "$matches" | grep -c . || true)" in
    0) echo "" ;;
    1) echo "$matches" ;;
    *) echo AMBIGUOUS ;;
  esac
}

# Make origin/<branch> available locally for the ancestry checks.
ensure_ref() {
  git rev-parse -q --verify "refs/remotes/origin/$1" > /dev/null \
    || git fetch -q origin "+refs/heads/$1:refs/remotes/origin/$1" 2>/dev/null
}

is_ancestor() { git merge-base --is-ancestor "$1" "$2" 2>/dev/null; }

candidates=""
skipped=""

while IFS= read -r f; do
  [ -n "$f" ] || continue
  fm=$(read_item "$f" | frontmatter)
  [ "$(get "$fm" status)" = "Ready" ] || continue

  id=$(get "$fm" id)
  assignee=$(get "$fm" assignee)
  title=$(get "$fm" title | sed 's/^"//; s/"$//')

  case " $AGENTS " in
    *" $(lower "$assignee") "*) ;;
    *) skipped="$skipped$id\tassignee '$assignee' is not an agent\n"; continue ;;
  esac

  blocked=""
  unmerged=""   # "<dep id>\t<branch>" per dependency whose PR is still open
  while IFS= read -r dep; do
    [ -n "$dep" ] || continue
    st=$(status_of "$dep")
    case "$st" in
      Done) ;;
      Review)
        br=$(branch_of "$dep")
        if [ "$br" = AMBIGUOUS ]; then
          blocked="$blocked $dep(Review, several workspec/$(lower "$dep")-* branches)"
        elif [ -z "$br" ]; then
          # Review is only published after the branch is pushed, so a missing
          # branch was deleted on merge: treat it like Done.
          :
        elif ! ensure_ref "$br"; then
          blocked="$blocked $dep(Review, branch $br not fetchable)"
        elif [ -n "$ref" ] && is_ancestor "origin/$br" "$ref"; then
          : # already merged into the integration branch
        else
          unmerged="$unmerged$dep	$br
"
        fi
        ;;
      *) blocked="$blocked $dep($st)" ;;
    esac
  done <<< "$(printf '%s\n' "$fm" | awk -F'\t' '$1 == "depends_on" { print $2 }')"
  if [ -n "$blocked" ]; then
    skipped="$skipped$id\tblocked by$blocked\n"; continue
  fi

  lid=$(lower "$id")
  if printf '%s\n' "$taken" | grep -q "^workspec/$lid-"; then
    skipped="$skipped$id\tbranch already exists\n"; continue
  fi

  # Stack on the unmerged dependency whose branch contains all the others.
  base_branch="$base"
  stacked_on="-"
  if [ -n "$unmerged" ]; then
    tip=""
    tip_id=""
    while IFS=$'\t' read -r dep br; do
      [ -n "$dep" ] || continue
      if [ -z "$tip" ] || is_ancestor "origin/$tip" "origin/$br"; then
        tip="$br"; tip_id="$dep"
      fi
    done <<< "$unmerged"
    split=""
    while IFS=$'\t' read -r dep br; do
      [ -n "$dep" ] || continue
      is_ancestor "origin/$br" "origin/$tip" || split="$split $dep"
    done <<< "$unmerged"
    if [ -n "$split" ]; then
      skipped="$skipped$id\tunmerged dependencies on separate branches ($tip_id and$split); merge one first\n"
      continue
    fi
    base_branch="$tip"
    stacked_on="$tip_id"
  fi

  created=$(get "$fm" created); : "${created:=9999-99-99}"
  candidates="$candidates$(rank "$(get "$fm" priority)")\t$created\t$id\t$assignee\t$f\t$base_branch\t$stacked_on\t$title\n"
done <<< "$files"

if [ -z "$candidates" ]; then
  printf 'NONE\tno Ready item is assigned to an agent with its dependencies met\n'
  [ -n "$skipped" ] && printf 'Skipped:\n' >&2 && printf "$skipped" >&2
  exit 0
fi

sorted=$(printf "$candidates" | sort -t"$(printf '\t')" -k1,1n -k2,2 -k3,3)
IFS=$'\t' read -r _ created id assignee file base_branch stacked_on title <<< "$(printf '%s\n' "$sorted" | head -1)"

printf 'id\t%s\n' "$id"
printf 'title\t%s\n' "$title"
printf 'assignee\t%s\n' "$assignee"
printf 'file\t%s\n' "$file"
printf 'created\t%s\n' "$created"
printf 'branch\tworkspec/%s\n' "$(lower "$id")"
printf 'integration\t%s\n' "$base"
printf 'base_branch\t%s\n' "$base_branch"
printf 'stacked_on\t%s\n' "$stacked_on"

runners=$(printf '%s\n' "$sorted" | tail -n +2)
[ -n "$runners" ] && { printf 'Runners-up:\n' >&2; printf '%s\n' "$runners" >&2; }
[ -n "$skipped" ] && { printf 'Skipped:\n' >&2; printf "$skipped" >&2; }
exit 0
