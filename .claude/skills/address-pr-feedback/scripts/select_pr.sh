#!/usr/bin/env bash
# Pick the open workspec pull request whose review feedback to address next.
#
# Eligible: an open PR whose head branch starts with "workspec/" and which has
# at least one UNRESOLVED review thread. Ordered by PR number, so the oldest
# open PR drains first.
#
# Detection deliberately ignores reviewDecision: a review submitted as a plain
# "Comment" leaves reviewDecision null while still carrying change requests in
# its threads, so only thread state is reliable.
#
# Prints "NONE\t<reason>" or a "key\tvalue" block for the winner; the other
# candidates go to stderr.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

repo=$(gh repo view --json owner,name --jq '.owner.login + "\t" + .name')
owner=${repo%%	*}
name=${repo##*	}

prs=$(gh pr list --state open --json number,headRefName \
        --jq '[.[] | select(.headRefName | startswith("workspec/"))] | sort_by(.number) | .[] | "\(.number)\t\(.headRefName)"')

if [ -z "$prs" ]; then
  printf 'NONE\tno open workspec pull request\n'
  exit 0
fi

winner=""
others=""

while IFS=$'\t' read -r num branch; do
  [ -n "$num" ] || continue
  counts=$(gh api graphql -f query='
    query($o:String!,$n:String!,$p:Int!){
      repository(owner:$o,name:$n){ pullRequest(number:$p){
        reviewThreads(first:100){ nodes { isResolved isOutdated } } } } }' \
    -f o="$owner" -f n="$name" -F p="$num" \
    --jq '.data.repository.pullRequest.reviewThreads.nodes
          | "\([.[]|select(.isResolved|not)]|length)\t\([.[]|select((.isResolved|not) and .isOutdated)]|length)"')

  open_threads=${counts%%	*}
  outdated=${counts##*	}

  if [ "$open_threads" -eq 0 ]; then
    others="$others$num\t$branch\tno unresolved threads\n"
  elif [ -z "$winner" ]; then
    winner="$num	$branch	$open_threads	$outdated"
  else
    others="$others$num\t$branch\t$open_threads unresolved\n"
  fi
done <<< "$prs"

if [ -z "$winner" ]; then
  printf 'NONE\tevery open workspec pull request has its review threads resolved\n'
  [ -n "$others" ] && { printf 'Other PRs:\n' >&2; printf "$others" >&2; }
  exit 0
fi

IFS=$'\t' read -r num branch open_threads outdated <<< "$winner"
printf 'pr\t%s\n' "$num"
printf 'branch\t%s\n' "$branch"
printf 'unresolved\t%s\n' "$open_threads"
printf 'outdated\t%s\n' "$outdated"
printf 'url\thttps://github.com/%s/%s/pull/%s\n' "$owner" "$name" "$num"

[ -n "$others" ] && { printf 'Other PRs:\n' >&2; printf "$others" >&2; }
exit 0
