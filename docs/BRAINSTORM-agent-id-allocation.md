# Brainstorm prompt: how should an AI agent allocate WorkSpec IDs?

Paste everything below the line into a fresh agent session, from either
`Code/workspec` or `Code/matchday`. It is self-contained: it assumes the agent
knows nothing about this problem.

Written 2026-09-09, after a first exploration that did not reach a decision.

---

I want to **brainstorm** a solution with you. Do not implement anything, do not
edit files, and do not commit. I got confused by an earlier proposal, so start
by reading the code and restating the problem back to me in plain language,
including anything below that turns out to be wrong. Then explore options.

## What WorkSpec is

WorkSpec is a work-item tracker I wrote. Each item is a Markdown file with YAML
frontmatter at `.workspec/items/<TYPE>-<6 digits>.md`, e.g. `STORY-000084.md`.
The ID is also the filename, and IDs are immutable once on the main branch.

Two repositories matter:

- `C:/Users/rdagum/Code/workspec` — the WorkSpec reference implementation: a
  zero-dependency static browser app. No `package.json`, no build step, no
  backend. `index.html` loads classic scripts; `test/load.js` evaluates those
  same files under Node for tests (`node --test`, 258 tests). It also has its
  own `.workspec/` backlog. CI validates on every push and PR
  (`.github/workflows/validate-workspec.yml` → `node tools/validate-workspec.js`).
- `C:/Users/rdagum/Code/matchday` — a large product repo (FastAPI backend,
  React web, React Native mobile, Robot Framework E2E). It only *consumes* the
  `.workspec/` directory format; it vendors **no** WorkSpec tooling — no
  `core/allocation.js`, no `test/load.js`, no Node project.

## How IDs are allocated today

Default strategy is `sequential`: the next ID is `max + 1` over the item files
**in your checkout**. Two working copies that each create an item before syncing
mint the same ID — an add/add conflict on merge, or a silently dropped item when
someone resolves it by taking one side.

To fix that I added per-working-copy **ID blocks** (`SPEC.md` §18.1;
`docs/REVIEW-2026-09.md` §3; the "Avoiding ID collisions between working copies"
section of `README.md` — read all three):

- `.workspec/config/board.yaml` sets `id_allocation: {strategy: block, block_size: 1000}`.
  Block N covers `TYPE-N001 … TYPE-(N+1)000` for every type. Block 0 holds
  pre-existing items, so adopting the scheme renumbers nothing.
- `.workspec/config/id-blocks.yaml` — **committed** registry, one line per
  working copy: `- { block: 5, owner: Fable, claimed: 2026-09-09 }`.
- `.workspec/config/user.local.yaml` — **gitignored**, holds this clone's
  `handle` and `id_block`.
- `core/allocation.js` implements it. Read it, especially `allocationState()`
  (line ~169), `allocateId()` (~208), `knownIds()` (~150), `lowestFreeBlock()`,
  `appendBlockEntry()`, `setLocalKeys()`, `validateRepository()`. Also read
  `utils/ids.js` (`nextId`), `tools/validate-workspec.js` and `tools/renumber.js`.

The board UI refuses to mint an ID until the clone has a registered block, and
offers "Claim a block" inline.

## The problem I want solved

**The block design assumed a human claiming a block through the board UI.** It
never considered how an AI agent gets an ID. I now run agents that file WorkSpec
items automatically, and there are two distinct defects:

**Defect 1 — agent identity.** The block comes only from the gitignored
`user.local.yaml`. My agents run in throwaway git worktrees created per run
(Claude Desktop local routines, under `.claude/worktrees/`). A worktree checks
out **tracked** files, so `id-blocks.yaml` is present but `user.local.yaml` is
not, so `allocationState()` reports `no-block` and `allocateId()` throws. Nobody
is watching to answer a prompt. Note `SKILL.md` (line ~284) already tells agents
to use "the entry in `id-blocks.yaml` whose owner is you" — the spec anticipated
identity-by-owner, but the code never implemented it.

**Defect 2 — tree-only view of what is taken.** `knownIds()` is the files on
disk right now. An ID minted on an unmerged branch is invisible. So:

1. A run branches from `origin/develop`, files an item, opens a PR that then
   waits for my review.
2. The next run branches from `origin/develop` again — still without that item —
   and mints the **same ID**, whether or not blocks are enabled, because it is
   `max + 1` within the same range over the same tree.

This one is not agent-specific: I hit it too with two local branches in one
clone. It may be the more important defect.

**This already happened.** In matchday, commit `34509d8e` on branch
`workspec/story-000074-mobile-e2e-port` minted `TASK-000030`; commit `d74da135`
deleted it during review. No live duplicate survives, but only by luck.

## Three execution contexts that must all work

1. **Agent in an interactive session in my main checkout.** `user.local.yaml`
   exists and names *my* block. Should the agent use my block, or its own?
   Argue it both ways — the agent and I are arguably the same working copy.
2. **Agent in a worktree during an unattended scheduled run.** The important
   one. No local file, nobody to prompt.
3. **Agent in a worktree during an interactive session.** No local file, but a
   human is present and could be asked.

## Constraints

- **No per-repo duplication.** A stopgap script currently lives at
  `.claude/skills/workspec-project-gates/scripts/ensure-id-block.js` in the
  workspec repo. Copying it into every repo is exactly what I do not want.
- **matchday has no WorkSpec tooling**, no Node project, and currently uses
  `sequential` with no `id_allocation` key at all. Whatever you propose has to
  work there.
- **The browser app must keep working** and stay dependency-free; `PROMPT.md`
  §15 forbids git integration *in the app* (tools are a different matter).
- **Existing IDs must not renumber.** IDs on the main branch are immutable;
  `tools/renumber.js` is the only sanctioned exception, and only on the side of
  a collision that has not reached main.
- The ID format is fixed by `SPEC.md` §7.2.
- `docs/REVIEW-2026-09.md` already **rejected** a central counter (§3.2) and
  random/ULID IDs (§3.4). Do not re-propose those without new argument.

## What was already explored (do not just repeat it)

An earlier agent proposed three separable parts:

- **A. Resolve the block from identity.** New `resolveBlock(model, hint)` with
  precedence: explicit `--block` → the working copy's `id_block` → registry
  lookup by `owner` (case-insensitive) → `no-block`. New problems
  `unknown-owner` and `ambiguous-owner` (I own two blocks, so a `label` would
  disambiguate). The browser passes no hint and behaves as today.
- **B. Reserve IDs from every git ref, not just the tree.**
  `allocateId(..., { reservedIds })` fed by
  `git log --all --no-renames --diff-filter=A --name-only --format= -- .workspec/items`.
  An ID minted on any ref is never minted again. Measured 0.2s on matchday.
  Fixes Defect 2 for humans and agents alike, needs no config change, and works
  under `sequential`.
- **C. Ship it once as a CLI** from the workspec repo (`workspec next-id TYPE
  --owner Fable`, plus `claim-block`, `validate`, `renumber`), consumed by a
  personal Claude skill at `~/.claude/skills/` and by other repos via `npx`.
  The per-repo script is deleted.

It rejected: a block per run (burns 999 blocks, registry commit per run); the
per-repo stopgap script (needs `test/load.js`, absent in matchday); a personal
skill that reimplements the allocator (a second implementation the test suite
cannot cover); pushing newly filed items straight to the integration branch
(lands unreviewed files, orphans items when a PR is rejected); identity solely
from an env var (discards working-copy semantics humans rely on); a hashed
agent range (still one block per agent, does not touch Defect 2); a committed
per-block cursor (the rejected central counter in disguise); and consulting open
PRs via `gh` (misses local branches, needs auth, GitHub-specific).

Open questions it left me, which are part of why I stalled:

1. Adding a `package.json` to a project whose stated identity is "no
   package.json, no build step" — even with zero dependencies. The suggested
   alternative was a `WORKSPEC_HOME` env var and `node "$WORKSPEC_HOME/tools/cli.js"`.
2. Whether `rdagum/workspec` is public (unverified), which decides whether
   `npx github:` works in another repo's CI.
3. "Ever minted" vs "live on some branch" semantics for reserved IDs.
   Ever-minted is deletion-immune but permanently burns numbers.
4. Whether an unattended run may claim a block itself. A claim on a PR branch is
   invisible until merged — the same hole one level up.
5. Concurrent runs of the same agent on two machines (I have a PC and a Mac).

## What I want back

1. The problem restated plainly, in your own words, including which of the two
   defects actually matters more and why — and correct me if I have it wrong.
2. Two or three genuinely different approaches, not variations of one. For each:
   how it behaves in all three contexts, what it costs, and how it fails.
3. A recommendation, with the reasoning visible.
4. The smallest useful first step — what I could do this week that makes things
   strictly better without committing me to the whole design.
5. The decisions that are mine to make, stated as questions with your suggested
   default.

Prefer the simplest thing that actually closes the hole. Tell me plainly if part
of the existing block design should be scrapped rather than extended. Flag
anything you could not verify.
