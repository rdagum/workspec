---
name: address-pr-feedback
description: Address the review feedback on one open workspec pull request — implement the requested changes, reply to each thread and resolve it, and re-run the project's quality gates. Use before starting new backlog work, or when the user asks to "address the PR comments", "handle review feedback", "resolve the review threads on PR N", or mentions "/address-pr-feedback".
allowed-tools: Bash, PowerShell, Read, Write, Edit, Glob, Grep, Agent, Skill
---

# Address PR Feedback

One run drains the review feedback on **one** pull request. It is the front half
of the daily backlog routine: unreviewed work piling up is worse than new work
not starting, so feedback is answered before another item is taken.

This skill assumes the branch, the WorkSpec item and the implementation plan all
already exist. It never creates them, and it never merges.

It is project-agnostic: the repository is derived from the checkout, and
everything about provisioning and verification comes from that repository's own
`workspec-project-gates` skill.

## Hard rules

- **One pull request per run.** Even if another has feedback too.
- **Never merge, never close a PR, and never push to the integration branch.**
  The only push is to the PR's own head branch.
- **Never force-push.** The user is reading this branch; rewriting it destroys
  the line anchors their comments point at.
- **Never resolve a thread you did not act on.** Resolving is the signal that
  something happened; using it to tidy up hides feedback.
- **Never silently disagree.** If a comment is wrong or is really a question,
  reply saying so and leave the thread open. Do not change code to match a
  comment you believe is mistaken.
- **Never touch the main checkout**, per the worktree isolation rules.

## Step 0 — Select the pull request

```bash
gh auth status
bash ~/.claude/skills/address-pr-feedback/scripts/select_pr.sh
```

The script picks the lowest-numbered open PR whose head branch starts with
`workspec/` and which has at least one unresolved review thread. It prints `pr`,
`branch`, `unresolved`, `outdated` and `url`; other PRs go to stderr.

It deliberately ignores `reviewDecision`. A review submitted as a plain
**Comment** leaves `reviewDecision` null while still carrying change requests in
its threads, so thread state is the only reliable signal.

If it prints `NONE`, report that line and **stop** — the review queue is clear.

## Step 1 — Get onto the branch

The branch is very likely already checked out in another worktree, and git
refuses the same branch in two. Work detached and push to the branch ref:

```bash
git fetch origin "<branch>"
git checkout --detach FETCH_HEAD
```

Never `git checkout -B` here: that would move the branch pointer and can discard
commits the user or another run pushed.

Then provision the worktree by invoking the project's `workspec-project-gates`
skill and following its provisioning section — env files, dependency install,
service ports. Do not restate those values here; follow that skill so the two
cannot drift apart. If the project has no such skill, infer what you can and say
so in the report.

## Step 2 — Read the feedback in full

Derive the repository from the checkout rather than hardcoding it:

```bash
owner=$(gh repo view --json owner --jq .owner.login)
name=$(gh repo view --json name --jq .name)

gh api graphql -f query='
  query($o:String!,$n:String!,$p:Int!){
    repository(owner:$o,name:$n){ pullRequest(number:$p){
      reviewThreads(first:100){ nodes {
        id isResolved isOutdated path line diffSide
        comments(first:20){ nodes { author{login} body createdAt } } } } } } }' \
  -f o="$owner" -f n="$name" -F p=<pr>
```

Read **every** comment in each unresolved thread, not just the first: a thread
often ends with a clarification that changes what is being asked. Then read the
code the thread points at, and the WorkSpec item and plan the PR references.

An `isOutdated` thread points at a line that has since moved or changed. Its
feedback is usually still valid — find where the code went rather than assuming
the point is stale.

## Step 3 — Classify each thread, then act

Sort every unresolved thread into one of three buckets and handle it:

| Bucket | What it looks like | What to do |
| --- | --- | --- |
| **Change** | A concrete request: remove this, rename that, handle this case | Implement it |
| **Question** | Asks why something was done, or what happens if | Answer in a reply; change code only if the answer reveals a real defect |
| **Disagreement** | The request rests on something you believe is factually wrong | Reply with the evidence and leave the thread **open** for the user to decide |

Bias toward implementing. Use the disagreement bucket only when you can point at
a specific file, test or doc that contradicts the comment — not when you merely
prefer your version.

**When feedback says the item itself is wrong, fix the item too.** Review
comments often reveal that the WorkSpec item's acceptance criteria or scope were
mistaken, not just the code. Correcting only the code leaves the bad criteria in
`.workspec/items/` to mislead the next run or the next reader. Update the item
file in the same commit and say so in the reply.

Commit per thread where the changes are separable, conventional-commit style,
referencing the item id and the PR number in the body.

## Step 4 — Re-run the quality gates

Run the **full** gate set the project's `workspec-project-gates` skill defines,
including starting whatever services those gates need.

Review changes are exactly where partial re-testing fails: a change made to
satisfy one comment routinely breaks a test the original run had passing. Run
everything, not just what looks related.

Same three-attempt limit on a failing gate, and the same prohibition on loosening
a test to make it pass. If the gates cannot be made to pass, push what exists,
reply on the threads explaining the blockage, leave them **unresolved**, and
report.

## Step 5 — Push

```bash
git push origin HEAD:<branch>
```

If this is rejected because the branch moved, `git fetch origin <branch>`, rebase
your commits onto it, and retry **once**. Never force.

## Step 6 — Reply, then resolve

Only after the push, so the reply can name a commit that exists. For each thread
you acted on:

```bash
gh api graphql -f query='
  mutation($t:ID!,$b:String!){
    addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$t, body:$b}){
      comment{ url } } }' -f t=<thread-id> -f b="<reply>"
```

The reply says what changed and in which commit, in one or two sentences. Then,
**only for threads you actually addressed**:

```bash
gh api graphql -f query='
  mutation($t:ID!){ resolveReviewThread(input:{threadId:$t}){ thread{ isResolved } } }' \
  -f t=<thread-id>
```

Leave open, with a reply but no resolve: threads you disagreed with, threads
whose question you answered without changing code, and threads whose fix the
gates rejected. The user closes those.

## Step 7 — Stop what you started

Stop the services the gates skill had you start, by the pids it had you record.
Leave shared infrastructure running. Leave the worktree for Desktop to archive.

## Step 8 — Report

Six lines or fewer: the PR, how many threads were addressed, resolved and left
open, what each open one is waiting on, gate results, and whether the WorkSpec
item was corrected.
