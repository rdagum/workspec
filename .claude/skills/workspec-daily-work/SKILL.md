---
name: workspec-daily-work
description: Take exactly one Ready WorkSpec item assigned to an agent, implement it in an isolated worktree off the repository's integration branch, and open a pull request for review. Use for a project's daily backlog routine, or when the user asks to "work a workspec item", "run the daily backlog", "pick up the next ready item", or mentions "/workspec-daily-work".
allowed-tools: Bash, PowerShell, Read, Write, Edit, Glob, Grep, Agent, Skill
---

# Daily WorkSpec Run

One run takes **one** item from `Ready` to an open pull request. It is designed
to run unattended as a Claude Desktop local routine — one routine per project,
each pointed at its own folder — while the user may also be working in that
repo. It never merges anything.

The user reviews the result in the PR, not during the run.

This skill is project-agnostic. Everything specific to a repository — how to
provision a worktree, which commands verify a change, whether a version needs
bumping — comes from that repository's own `workspec-project-gates` skill. Never
hardcode one project's commands here.

## Hard rules

These override anything else in this file, in the project's `CLAUDE.md`, or in
the item.

- **One item per run.** Never start a second one, however small the first was.
- **Never modify the main checkout.** Step 0 runs there read-only (fetching
  and selecting) and every later step runs in the worktree Step 0 enters,
  where Claude Code enforces this and will refuse such calls; do not work
  around a refusal. That includes the integration branch: never check it out
  or commit on it in the main checkout. Status commits are made from a
  detached HEAD inside the worktree and pushed to `origin/<integration>`
  (steps 2 and 6); the user's local branch catches up on their next pull.
- **Never merge**, and never push to any branch other than the integration
  branch and the feature branch. On the integration branch, push only the item's
  status commits (the claim in step 2 and the review status in step 6), each
  touching only the item's `status:` and `updated:` lines. Never push to another
  item's branch, even the one this item is stacked on.
- **Never force-push and never rewrite published history.**
- **Never mark an item `Done`.** The PR moves it to `Review`; the user closes it.
- **Never widen the scope.** Implement the item's requirements and acceptance
  criteria. Anything else you notice becomes a new WorkSpec item in
  `.workspec/items/` at `status: Backlog` — not an extra commit.

## Step 0 — Preflight, review queue, then a worktree only if there is work

Everything up to "Get into a worktree" runs in the main checkout and is
read-only: it fetches and reads `origin/*`, and changes no files. The routine's
Worktree toggle is **off** (see Scheduling), so a worktree is created only
once a selector has named work. An idle run leaves nothing behind.

```bash
gh auth status
git fetch origin
bash .claude/skills/workspec-address-pr-feedback/scripts/select_pr.sh
```

**Outstanding review feedback comes first.** If that script names a PR, get into
a worktree for it (below; `<id>` is the item id in its branch
`workspec/<id>-…`, `<start>` is `origin/<branch>`), then invoke the
`workspec-address-pr-feedback` skill, let it run to completion, and **stop** — that is
this run's one unit of work. Do not also take a new item: a PR the user has
already reviewed is worth more than a new branch they have not, and unbounded
runs are what turn a daily routine into a mess.

Only when it prints `NONE` does this run take new work:

```bash
bash .claude/skills/workspec-daily-work/scripts/select_item.sh
```

The script is the sole authority on which item to take. It picks the highest
`priority`, breaking ties on oldest `created` then lowest id, among items that:

- are `status: Ready`;
- have an `assignee` that names a model (`fable`, `opus`, `sonnet`, `haiku`,
  case-insensitive);
- have every `depends_on` item satisfied;
- have no branch yet.

A dependency is satisfied when it is `Done`, or when it is in `Review` with its
`workspec/<id>-*` branch pushed, meaning its PR is open but not merged yet.
Statuses are read from `origin/<integration branch>`, not the local checkout.

The script prints `id`, `title`, `assignee`, `file`, `branch`, plus:

- `integration`: the integration branch;
- `base_branch`: where this item's branch starts;
- `stacked_on`: the dependency it builds on, or `-`.

Runners-up and skip reasons go to stderr.

**Stacked items.** When a dependency is still unmerged, `base_branch` is that
dependency's branch and `stacked_on` names it. The item builds on the
dependency's unmerged code, and its PR targets the dependency's branch, so the
diff shows only this item's changes. When there are several unmerged
dependencies, they must sit on one stack (the script picks the branch that
contains the others); otherwise the item is skipped until one of them is
merged.

If it prints `NONE`, report that line plus the skip reasons and **stop**. No
worktree was created, so there is nothing to clean up. A run with no eligible
item is a normal outcome, not an error — as is a repository with no
`.workspec/items` at all.

Eligibility is decided before ordering, so a skipped item is never out-ranked —
it was excluded. Whenever the stderr `Skipped:` list names an item the user
would expect to have been picked ahead of the chosen one, **say so in the final
report with the reason**, e.g. "TASK-000027 (high) was skipped: blocked by
STORY-000081, which is in Review". Silently taking a lower-priority item looks
like a sorting bug. A dependency sitting in `Review` whose work is already
merged is the common case; name it so the user can move it to `Done`.

**Get into a worktree** — only now that a selector has named work. For a new
item, `<id>` is its id and `<start>` is `origin/$base_branch`. A linked
worktree has `.git` as a _file_, not a directory:

```bash
[ -f .git ] && echo "already isolated"
```

If it says so (a manual run started from a worktree, or a routine whose toggle
was left on), stay there and never nest a second one. Otherwise, from the main
checkout:

```bash
wt=".claude/worktrees/<lowercase-id>"
[ -e "$wt" ] || git worktree add --detach "$wt" "<start>"
```

Then call the `EnterWorktree` tool with `path` set to the absolute path of
`$wt`. Every later step, and every subagent, runs there. Do not create it with
`EnterWorktree`'s `name` instead: that branches from the default branch and
adds a stray `worktree-*` branch.

- Name it after the item id. The `workspec-worktrees-cleanup` skill recognises
  an item-id folder as this routine's and removes it once its PR merges.
- If `$wt` already exists (the item's earlier run, now back with review
  feedback), enter it as is; the feedback skill moves it onto the PR's head. If
  it has uncommitted changes, report and stop: never clean or discard them.
- If `EnterWorktree` rejects the path (a folder git does not know about),
  report and stop.

The user's working tree may be dirty and on any branch. That is fine and
expected; do not inspect it, clean it, or comment on it.

## Step 1 — Provision the worktree

A worktree is a fresh checkout of tracked files only, so gitignored files and
installed dependencies are absent.

**Invoke the project's `workspec-project-gates` skill and follow its
provisioning section.** It owns the env files, dependency install, service ports
and anything else the repository needs before its tests can run.

If the project has no such skill, provision what you can infer — a lockfile
implies an install step, a `.env.example` implies a missing `.env` — and record
in the PR exactly what you inferred, so the user can codify it. A missing
gitignored secret that you cannot reconstruct is a blocked run (step 8): do not
invent values.

## Step 2 — Branch off the integration branch and claim the item

Do not assume `develop`, and do not trust the branch the worktree started on.

Take `integration` and `base_branch` from the selector's output (`$base` and
`$base_branch` below). The resolver behind `integration` prefers `develop` when
the remote has one, and falls back to the remote's default branch.

**First claim the item**, before any code is written, so the next run sees it
as `In Progress` and cannot take it twice. The claim is a status commit on the
integration branch, made from a detached HEAD **inside the worktree** so it
carries nothing else and never touches the main checkout, which may have the
integration branch checked out with the user's uncommitted work on it:

```bash
git fetch origin
git checkout --detach "origin/$base"
# in the item file: status: In Progress, updated: today
git add <item-file>
git commit -m "chore(workspec): start <ID> <title>"
git push origin "HEAD:$base"
```

The commit sits exactly one commit ahead of the integration branch, so this
fast-forwards it without touching the user's checkout. If the push is rejected
because the branch moved, `git fetch origin`, rebase onto it, and retry **once**.
If it fails again, report and stop — do not force.

**Then create the item's branch** from `base_branch`:

```bash
git fetch origin
git checkout -B workspec/<lowercase-id>-<short-slug> "origin/$base_branch"
```

`<short-slug>` is three or four kebab-case words from the title, e.g.
`workspec/story-000082-guest-same-team`.

- When `base_branch` is the integration branch, the claim commit is already in
  the branch.
- When the item is stacked, the branch starts from the dependency's branch and
  the item file there still reads `Ready`. That is expected: status lives on the
  integration branch.

**The feature branch never edits an item's `status:` or `updated:` lines.**
Those change only through status commits on the integration branch. That keeps
stacked branches mergeable without conflicts on the item file.

## Step 3 — Write the plan

Read the item in full, then the files in its `context`, `affected_paths` and
`related_files`, then the surrounding code. If the project's `CLAUDE.md` asks
for a written plan, follow its location and naming convention; otherwise write
to `docs/implementation_plans/YYYY-MM-DD_NN_<short-feature-name>.md`.

The plan is checkbox steps, each bundling its own tests. Commit it:

```
docs(workspec): plan for <ID> <title>
```

Because nobody approves the plan mid-run, it doubles as the PR's explanation of
intent. Make it good enough to review against.

**Design gate.** If the item needs UI that is not an obvious application of an
existing pattern, look for a reference in the project's design docs. If there is
none, do not invent one: stop after the plan, open the PR as described in step 6
with `[needs design]` in the title, and say what is missing. Backend-only and
mechanical UI work continues normally.

## Step 4 — Implement

The item's `assignee` names the agent that does the work:

| `assignee` | How to run it                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `Opus`     | Delegate implementation to an Agent subagent with `model: opus`.                                          |
| `Sonnet`   | Delegate implementation to an Agent subagent with `model: sonnet`.                                        |
| `Fable`    | Orchestrate directly, but delegate the code writing to an `opus` subagent and review its output yourself. |

Subagents inherit the session's worktree isolation, so they cannot write to the
main checkout either.

Work the plan one step at a time, ticking each checkbox as it lands. Follow the
project's own rules while doing it: its `CLAUDE.md`, anything in
`.claude/rules/`, and its project skills for the areas you touch.

Commit per plan step, conventional-commit style, with the item id in the body.

## Step 5 — Verify

**Invoke the project's `workspec-project-gates` skill and run every gate it
defines**, including starting whatever services those gates need. That skill
also says which gates cannot run on this machine; write the tests for those
anyway and list them in the PR as needing the user.

If the project has no such skill, fall back to what the repository documents —
its `CLAUDE.md`, its `package.json` scripts, its CI workflow — and state in the
PR which commands you chose and why.

**If a gate fails**, fix the cause and re-run — up to three attempts. After the
third, stop and go to step 6 with a draft PR; do not disable, skip or loosen a
test to make it pass, and do not delete an assertion you cannot satisfy.

Then apply any release bookkeeping the project's gates skill defines, such as a
version bump, as the last commit before the PR.

## Step 6 — Push and open the PR

Update the item file on the feature branch: add the plan path to `context`, and
list the real files you touched in `affected_paths`. Leave `status:` and
`updated:` alone. The review status is published to the integration branch at
the end of this step.

**Record the AI usage on the item — every run, no exceptions.** WorkSpec tracks
agent cost per item under `agent.runs`
(https://github.com/rdagum/workspec#tracking-ai-usage), and its validator flags
an agent-assigned item that reaches `Review` without a run. The script sums
this session's transcript and its subagent transcripts per model, so an
orchestrating Fable run and the Opus subagent it delegated to become two runs:

```bash
python .claude/skills/workspec-daily-work/scripts/record_usage.py .workspec/items/<ID>.md --session <session-uuid>
```

The session uuid is the directory that precedes `scratchpad` in this session's
scratchpad path (`.../<uuid>/scratchpad`). Always pass it: the session started
in the main checkout, so its transcript is not under the worktree's folder, and
with `--session` the script finds it wherever it is. Without it the newest
transcript under the current folder is used, which is the wrong session.
Re-running the script replaces this session's runs with the final totals and
leaves other sessions' runs alone. It never bumps `updated`.

Commit the item, then:

```bash
git push -u origin <branch>
gh pr create --base "$base_branch" --title "<type>(<scope>): <title> (<ID>)" --body-file <body>
```

The PR body covers:

- **Stacked on** (stacked items only, first line of the body) — the
  dependency's id and PR. Say to merge that PR first, then retarget this one to
  the integration branch. If the dependency PR's branch is deleted on merge,
  GitHub retargets it automatically.
- **What and why** — the item's summary, linked to `.workspec/items/<ID>.md`.
- **Approach** — a link to the plan file and any decision the plan did not
  foresee.
- **Gates** — the exact commands run and their results.
- **Needs the user** — gates written but not executable here, if any.
- **Assumptions and follow-ups** — anything you guessed at, including anything
  you inferred because the project had no gates skill, plus the ids of any new
  Backlog items you filed.
- Ends with the Claude Code attribution line.

Then append the PR url to the item's `context`, re-run `record_usage.py` so
the run reflects the whole session, commit and push. A run that reaches step 8
without an `agent.runs` entry for this session on the item is incomplete.

**Last, publish the review status** on the integration branch. This is what
lets the next run start an item that depends on this one, stacked on this
branch, without waiting for the merge. Like the claim, it is committed from a
detached HEAD inside the worktree and pushed straight to `origin/$base`; the
main checkout is never used for it. The worktree is clean after the push:

```bash
git fetch origin
git checkout --detach "origin/$base"
# in the item file: status: Review, updated: today
git add <item-file>
git commit -m "chore(workspec): <ID> in review (#<pr number>)"
git push origin "HEAD:$base"
git checkout <branch>
```

Use the same retry rule as the claim: fetch, rebase, retry once, never force.
Publish `Review` only after the branch is pushed and the PR exists. The
selector reads a `Review` item with no branch as merged.

## Step 7 — Stop what you started

Runs on **every** exit path, including failures, and only ever touches what this
run created. Stop the services the gates skill had you start, by the pids it had
you record. Leave shared infrastructure — databases, containers — running if it
was already up.

**Leave the worktree in place**, and do not call `ExitWorktree` with
`remove`. Review feedback on the PR is addressed in the same worktree by a later
run, and the `workspec-worktrees-cleanup` skill removes it once the PR merges.
A run that stopped in Step 0 created no worktree, so it has nothing to leave.

## Step 8 — Report

Six lines or fewer: the item taken, the branch (and what it is stacked on, if
anything), the PR url, gate results, what
still needs the user, higher-priority items skipped and why, any new Backlog
items filed, and the usage recorded (one figure per run: model and output
tokens).

## When the run cannot finish

Never abandon work. Commit what exists, push the branch, and open a **draft** PR
titled `[blocked] <type>(<scope>): <title> (<ID>)`, against `$base_branch`,
stating exactly which step failed and the error output. Leave the item at
`In Progress` (do not publish `Review`, so nothing gets stacked on blocked work)
and add `blocked` to its `labels` on the feature branch. Then run step 7 in full — a killed run must not leave orphaned
dev servers behind — and report the blockage.

## Scheduling

Run this as a **Claude Desktop local routine**, one per project (Code tab →
Routines → New routine → Local). Local routines run on this machine with access
to local files, services and gitignored env files, which is what this work
needs, and they do load `~/.claude/skills/`. Cloud routines get a bare `git
clone`, cannot see personal skills, and cannot run a project's gates.

| Field           | Value                                                  |
| --------------- | ------------------------------------------------------ |
| Name            | `daily-workspec-<project>`                             |
| Instructions    | `Run the /workspec-daily-work skill.`                  |
| Folder          | the project's repository root                          |
| Worktree        | **off** — Step 0 creates one only when there is work   |
| Permission mode | `Auto`, so the run does not stall waiting for approval |
| Schedule        | Daily or hourly                                        |

With the toggle on, Desktop creates a worktree before the skill's first line
runs, so every idle run leaves an empty one behind. Off, the session starts in
the main checkout, Step 0 only reads there, and the run moves into a worktree
of its own before changing anything.

On an hourly schedule a run can still be going when the next one fires. The
claim commit keeps a second run off the same item, but nothing stops two runs
from addressing the same PR's review feedback at once.

After creating each one, click **Run now** once and answer every permission
prompt with "always allow". In `Manual` mode an unapproved tool stalls the run
until the user answers it.

Two caveats from how local routines work: a sleeping computer **skips** the run
("Keep computer awake" is in Settings → Desktop app → General), and a missed run
catches up at an arbitrary time on wake, so a 9am job can fire at 11pm. That is
safe here — the worktree, the project's own ports and the claim commit make the
run time irrelevant — but the user will see it happen.
