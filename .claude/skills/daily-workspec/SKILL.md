---
name: daily-workspec
description: Take exactly one Ready WorkSpec item assigned to an agent, implement it in an isolated worktree off the repository's integration branch, and open a pull request for review. Use for a project's daily backlog routine, or when the user asks to "work a workspec item", "run the daily backlog", "pick up the next ready item", or mentions "/daily-workspec".
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
- **Never touch the main checkout.** When the session is worktree-isolated
  Claude Code enforces this and will refuse such calls; do not work around a
  refusal.
- **Never merge**, and never push to any branch other than the integration
  branch (the claim commit only) and the feature branch.
- **Never force-push and never rewrite published history.**
- **Never mark an item `Done`.** The PR moves it to `Review`; the user closes it.
- **Never widen the scope.** Implement the item's requirements and acceptance
  criteria. Anything else you notice becomes a new WorkSpec item in
  `.workspec/items/` at `status: Backlog` — not an extra commit.

## Step 0 — Preflight, review queue, then worktree

```bash
gh auth status
git fetch origin
bash ~/.claude/skills/address-pr-feedback/scripts/select_pr.sh
```

**Outstanding review feedback comes first.** If that script names a PR, invoke
the `address-pr-feedback` skill, let it run to completion, and **stop** — that is
this run's one unit of work. Do not also take a new item: a PR the user has
already reviewed is worth more than a new branch they have not, and unbounded
runs are what turn a daily routine into a mess.

Only when it prints `NONE` does this run take new work:

```bash
bash ~/.claude/skills/daily-workspec/scripts/select_item.sh
```

The script is the sole authority on which item to take. It picks the highest
`priority`, breaking ties on oldest `created` then lowest id, among items that
are `status: Ready`, whose `assignee` names a model (`fable`, `opus`, `sonnet`,
`haiku` — case-insensitive), whose every `depends_on` item is `Done`, and which
have no branch yet. It prints `id`, `title`, `assignee`, `file` and `branch`;
runners-up and skip reasons go to stderr.

If it prints `NONE`, report that line plus the skip reasons and **stop**. A day
with no eligible item is a normal outcome, not an error — as is a repository
with no `.workspec/items` at all.

Eligibility is decided before ordering, so a skipped item is never out-ranked —
it was excluded. Whenever the stderr `Skipped:` list names an item the user
would expect to have been picked ahead of the chosen one, **say so in the final
report with the reason**, e.g. "TASK-000027 (high) was skipped: blocked by
STORY-000081, which is in Review". Silently taking a lower-priority item looks
like a sorting bug. A dependency sitting in `Review` whose work is already
merged is the common case; name it so the user can move it to `Done`.

**Get into a worktree.** The routine's Worktree toggle should already have put
the session in one. A linked worktree has `.git` as a *file*, not a directory:

```bash
[ -f .git ] && echo "already isolated" || git worktree add --detach ".claude/worktrees/<lowercase-id>" HEAD
```

Only create one when the check says you are in the main checkout — that is the
manual-invocation path. Never nest a second worktree inside an isolated session.

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

```bash
base=$(bash ~/.claude/skills/daily-workspec/scripts/resolve_base.sh)
git fetch origin
git checkout -B workspec/<lowercase-id>-<short-slug> "origin/$base"
```

The resolver prefers `develop` when the remote has one and falls back to the
remote's default branch. `<short-slug>` is three or four kebab-case words from
the title, e.g. `workspec/story-000082-guest-same-team`.

Now claim the item, **before** any code is written, so tomorrow's run sees it as
`In Progress` and cannot take it twice. Set `status: In Progress` and `updated:`
to today's date in the item file, then:

```bash
git add <item-file>
git commit -m "chore(workspec): start <ID> <title>"
git push origin "HEAD:$base"
```

The branch sits exactly one commit ahead of the integration branch, so this
fast-forwards it without touching the user's checkout. If the push is rejected
because the branch moved, `git fetch origin`, rebase onto it, and retry **once**.
If it fails again, report and stop — do not force.

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

| `assignee` | How to run it |
| --- | --- |
| `Opus`   | Delegate implementation to an Agent subagent with `model: opus`. |
| `Sonnet` | Delegate implementation to an Agent subagent with `model: sonnet`. |
| `Fable`  | Orchestrate directly, but delegate the code writing to an `opus` subagent and review its output yourself. |

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

Update the item file: `status: Review`, `updated:` today, add the plan path to
`context`, and list the real files you touched in `affected_paths`. Commit it,
then:

```bash
git push -u origin <branch>
gh pr create --base "$base" --title "<type>(<scope>): <title> (<ID>)" --body-file <body>
```

The PR body covers:

- **What and why** — the item's summary, linked to `.workspec/items/<ID>.md`.
- **Approach** — a link to the plan file and any decision the plan did not
  foresee.
- **Gates** — the exact commands run and their results.
- **Needs the user** — gates written but not executable here, if any.
- **Assumptions and follow-ups** — anything you guessed at, including anything
  you inferred because the project had no gates skill, plus the ids of any new
  Backlog items you filed.
- Ends with the Claude Code attribution line.

Then append the PR url to the item's `context`, commit and push.

## Step 7 — Stop what you started

Runs on **every** exit path, including failures, and only ever touches what this
run created. Stop the services the gates skill had you start, by the pids it had
you record. Leave shared infrastructure — databases, containers — running if it
was already up.

**Do not remove the worktree when the routine created it** — Desktop owns its
lifecycle through the session's archive action and the "Auto-archive after PR
merge or close" setting. Only remove a worktree this skill created itself on the
manual-invocation path, and only once the branch is pushed.

## Step 8 — Report

Six lines or fewer: the item taken, the branch, the PR url, gate results, what
still needs the user, higher-priority items skipped and why, and any new Backlog
items filed.

## When the run cannot finish

Never abandon work. Commit what exists, push the branch, and open a **draft** PR
titled `[blocked] <type>(<scope>): <title> (<ID>)` stating exactly which step
failed and the error output. Leave the item at `In Progress` and add `blocked`
to its `labels`. Then run step 7 in full — a killed run must not leave orphaned
dev servers behind — and report the blockage.

## Scheduling

Run this as a **Claude Desktop local routine**, one per project (Code tab →
Routines → New routine → Local). Local routines run on this machine with access
to local files, services and gitignored env files, which is what this work
needs, and they do load `~/.claude/skills/`. Cloud routines get a bare `git
clone`, cannot see personal skills, and cannot run a project's gates.

| Field | Value |
| --- | --- |
| Name | `daily-workspec-<project>` |
| Instructions | `Run the /daily-workspec skill.` |
| Folder | the project's repository root |
| Worktree | **on** — the run must not touch the main checkout |
| Permission mode | `Auto`, so the run does not stall waiting for approval |
| Schedule | Daily |

After creating each one, click **Run now** once and answer every permission
prompt with "always allow". In `Manual` mode an unapproved tool stalls the run
until the user answers it.

Two caveats from how local routines work: a sleeping computer **skips** the run
("Keep computer awake" is in Settings → Desktop app → General), and a missed run
catches up at an arbitrary time on wake, so a 9am job can fire at 11pm. That is
safe here — the worktree, the project's own ports and the claim commit make the
run time irrelevant — but the user will see it happen.
