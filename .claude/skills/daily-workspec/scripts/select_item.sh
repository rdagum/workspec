#!/usr/bin/env bash
# Pick the single WorkSpec item for today's automated run.
#
# Eligible: status Ready, assignee is an agent handle, every depends_on item is
# Done, and no branch for it exists yet. Ordered by priority (high > medium >
# low), then oldest created, then lowest id.
#
# Prints "NONE\t<reason>" or a "key\tvalue" block for the winner, followed by
# the runners-up on stderr so the caller can report what it skipped.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
ITEMS=.workspec/items
# An assignee is an agent when it names a model. Deriving it this way keeps
# the script generic: no per-project handle list to maintain.
AGENTS="fable opus sonnet haiku"

if [ ! -d "$ITEMS" ]; then
  printf 'NONE	this repository has no .workspec/items directory
'
  exit 0
fi
if ! ls "$ITEMS"/*.md > /dev/null 2>&1; then
  printf 'NONE	no WorkSpec items in %s
' "$ITEMS"
  exit 0
fi

# Frontmatter only: one "key<TAB>value" line per scalar, one per list entry.
# Body text is ignored -- some items have prose lines that look like keys.
frontmatter() {
  awk '
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
  ' "$1"
}

get() { printf '%s\n' "$1" | awk -F'\t' -v k="$2" '$1 == k { print $2; exit }'; }

status_of() {
  local f="$ITEMS/$1.md"
  [ -f "$f" ] || { echo MISSING; return; }
  frontmatter "$f" | awk -F'\t' '$1 == "status" { print $2; exit }'
}

rank() {
  case "$1" in
    high|critical|urgent) echo 0 ;;
    medium)               echo 1 ;;
    *)                    echo 2 ;;
  esac
}

# Branch names already taken, so a re-run never re-takes an in-flight item.
taken=$( { git branch --format='%(refname:short)'
           git ls-remote --heads origin 2>/dev/null | sed 's#.*refs/heads/##'
         } | tr 'A-Z' 'a-z' | sort -u )

candidates=""
skipped=""

for f in "$ITEMS"/*.md; do
  fm=$(frontmatter "$f")
  [ "$(get "$fm" status)" = "Ready" ] || continue

  id=$(get "$fm" id)
  assignee=$(get "$fm" assignee)
  title=$(get "$fm" title | sed 's/^"//; s/"$//')

  case " $AGENTS " in
    *" $(printf '%s' "$assignee" | tr 'A-Z' 'a-z') "*) ;;
    *) skipped="$skipped$id\tassignee '$assignee' is not an agent\n"; continue ;;
  esac

  blocked=""
  while IFS= read -r dep; do
    [ -n "$dep" ] || continue
    st=$(status_of "$dep")
    [ "$st" = "Done" ] || blocked="$blocked $dep($st)"
  done <<< "$(printf '%s\n' "$fm" | awk -F'\t' '$1 == "depends_on" { print $2 }')"
  if [ -n "$blocked" ]; then
    skipped="$skipped$id\tblocked by$blocked\n"; continue
  fi

  lid=$(printf '%s' "$id" | tr 'A-Z' 'a-z')
  if printf '%s\n' "$taken" | grep -q "^workspec/$lid-"; then
    skipped="$skipped$id\tbranch already exists\n"; continue
  fi

  created=$(get "$fm" created); : "${created:=9999-99-99}"
  candidates="$candidates$(rank "$(get "$fm" priority)")\t$created\t$id\t$assignee\t$f\t$title\n"
done

if [ -z "$candidates" ]; then
  printf 'NONE\tno Ready item is assigned to an agent with its dependencies met\n'
  [ -n "$skipped" ] && printf 'Skipped:\n' >&2 && printf "$skipped" >&2
  exit 0
fi

sorted=$(printf "$candidates" | sort -t"$(printf '\t')" -k1,1n -k2,2 -k3,3)
IFS=$'\t' read -r _ created id assignee file title <<< "$(printf '%s\n' "$sorted" | head -1)"

printf 'id\t%s\n' "$id"
printf 'title\t%s\n' "$title"
printf 'assignee\t%s\n' "$assignee"
printf 'file\t%s\n' "$file"
printf 'created\t%s\n' "$created"
printf 'branch\tworkspec/%s\n' "$(printf '%s' "$id" | tr 'A-Z' 'a-z')"

runners=$(printf '%s\n' "$sorted" | tail -n +2)
[ -n "$runners" ] && { printf 'Runners-up:\n' >&2; printf '%s\n' "$runners" >&2; }
[ -n "$skipped" ] && { printf 'Skipped:\n' >&2; printf "$skipped" >&2; }
exit 0
