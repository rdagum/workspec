# WorkSpec

**Version:** 1.0.0

WorkSpec is a Git-native, AI-first work management system that stores project planning alongside source code.

Instead of relying on external issue trackers or hosted services, WorkSpec keeps work items, project context, templates, and configuration inside the repository. This makes project planning portable, version-controlled, and immediately accessible to both developers and AI coding agents.

WorkSpec defines a specification for representing software work. The included HTML board is the reference implementation of that specification.

---

# Why WorkSpec?

Traditional project management tools separate planning from implementation.

WorkSpec keeps everything together:

* Source code
* Architecture documentation
* Project context
* Work items
* Templates
* Workflow configuration

Because everything lives inside the repository, Git becomes the single source of truth for both the software and the work required to build it.

---

# Design Goals

WorkSpec is built around a few simple principles:

* **Git-native** – All project planning lives inside the repository.
* **AI-first** – Work items are designed to be consumed directly by AI coding agents.
* **Human-readable** – Every file can be opened and understood in a text editor.
* **Portable** – Copy the `.workspec` directory to another repository and everything moves with it.
* **Implementation-independent** – Any application can implement the WorkSpec specification.

---

# Repository Layout

```text
.workspec/
│
├── config/
│   ├── board.yaml
│   ├── workflow.yaml
│   ├── users.yaml
│   ├── id-blocks.yaml
│   └── user.local.yaml
│
├── items/
│
├── templates/
│
├── context/
│
├── assets/
│
├── archive/
│
└── board/
```

The `.workspec` directory contains everything required to understand and manage the project.

---

# Work Items

Each work item is stored as a separate Markdown file.

Example:

```text
.workspec/items/STORY-000123.md
```

Every work item contains:

* YAML front matter for structured metadata
* Markdown for detailed documentation

This combination provides deterministic data for tooling while remaining easy for humans to edit.

---

# Supported Work Item Types

WorkSpec v1.0 defines the following item types:

* Epic
* Story
* Task
* Bug
* Spike

Each item has an immutable ID.

Examples:

```text
EPIC-000001
STORY-000123
TASK-000045
BUG-000010
SPIKE-000003
```

IDs never change, even if the title changes.

---

# Workflow

Workflow is defined in:

```text
.workspec/config/workflow.yaml
```

The specification does not prescribe Scrum, Kanban, or any particular methodology.

Projects are free to define their own workflow stages.

Example:

```text
Backlog
Ready
In Progress
Review
Done
```

---

# Context Documents

Project-wide documentation belongs in:

```text
.workspec/context/
```

Examples include:

* Architecture
* Coding Standards
* API Design
* Database Design
* Deployment

Work items reference these documents rather than duplicating information.

---

# Templates

Templates reside in:

```text
.workspec/templates/
```

Templates provide the starting point for new work items and help ensure consistency across the project.

---

# AI Integration

WorkSpec is designed to work naturally with AI coding agents.

The repository includes:

* `SPEC.md` – Defines the WorkSpec specification.
* `SKILL.md` – Defines how AI agents should operate on WorkSpec repositories.

A compliant AI agent should:

1. Read `SPEC.md`.
2. Load `SKILL.md`.
3. Locate the requested work item.
4. Load referenced context.
5. Produce an implementation plan.
6. Implement the requested changes.
7. Update the work item status.

---

# Reference Implementation

The HTML board is a reference implementation of the WorkSpec specification.

Its responsibilities are intentionally limited:

* Browse work items
* Search and filter
* Edit metadata
* Edit Markdown
* Create work items
* Move work items between workflow states

The board is **not** the source of truth.

The files are.

---

# Git Philosophy

WorkSpec intentionally relies on Git for:

* Version history
* Authorship
* Change tracking
* Repository synchronization

WorkSpec does not duplicate these capabilities. The one per-run record an item may hold is `agent.runs` (see "Tracking AI usage" below): what a change cost to produce is data Git does not record.

---

# Getting Started

1. Clone your repository.
2. Add the `.workspec` directory to the repository root.
3. Configure `board.yaml` and `workflow.yaml`.
4. Create your first work item from a template.
5. Open the reference HTML board.
6. Begin managing work directly from the repository.

No server, database, or cloud service is required.

---

# Project Documents

| Document    | Purpose                               |
| ----------- | ------------------------------------- |
| `README.md` | Project overview and usage            |
| `SPEC.md`   | Formal WorkSpec specification         |
| `SKILL.md`  | AI agent operating instructions       |
| `PROMPT.md` | Reference implementation requirements |

---

# Contributing

When contributing to a WorkSpec repository:

* Keep changes focused.
* Preserve work item IDs.
* Avoid unnecessary formatting changes.
* Follow the WorkSpec specification.
* Preserve compatibility with existing repositories whenever possible.

---

# License

WorkSpec itself is a specification.

Projects implementing the specification may choose their own software license unless otherwise stated.

---

# WorkSpec Board — Reference Implementation

A zero-backend, file-based visual editor and navigator for `.workspec/`
repositories, implementing the WorkSpec v1.0 specification (`SPEC.md`).

No server. No database. No build step. No runtime dependencies. Just HTML, CSS
and vanilla JavaScript that reads and writes your files directly through the
browser's **File System Access API**.

The scripts are plain classic `<script>` tags sharing a global `window.WS`
namespace (not ES modules), so the page runs straight from the filesystem — no
server needed.

## Requirements

- A **Chromium browser** (Chrome or Edge) — the File System Access API is used
  for in-place read/write. Firefox/Safari are not supported in this build.

## Running it

**Just double-click `index.html`** (or drag it into a Chrome/Edge window). Then
click **Open .workspec folder**, select a `.workspec` directory, and grant
read/write when prompted. This repo's own backlog lives in `.workspec/`; a
sample repository for trying the board out ships in `.workspec-demo/`.

That's it — there is nothing to install or serve.

**Reopening is one click.** Every repository you open is remembered (the
directory handle and the board name go into the browser's IndexedDB, nothing
is written to the repository). Next time, the empty state and the **▾** next
to the open button list your **recent repositories**, most recent first, up to
eight. Click one and the browser asks for permission on that folder again — no
directory picker. An entry whose folder has been moved or deleted is shown as
unavailable and can be removed with **✕**; so can any other entry. Tick
**Reopen the last repository automatically** if you want the board to try on
every page load; it is off by default, and because a page load carries no
click the browser may still ask once, so the entry is focused and Enter
reopens it. The list is per browser profile and per origin, so `file://` and
`http://127.0.0.1` each keep their own.

> Optional: a `run.sh` is included if you'd rather serve over
> `http://127.0.0.1:8000` (some Chrome versions are stricter about write
> permission on `file://`). It's only a static file host and runs none of the
> app logic.

## Running the tests

The pure modules (`utils/yaml.js`, `utils/ids.js`, `core/parser.js`,
`core/allocation.js`, `core/usage.js`, `core/model.js`, `state/store.js`) and
the command-line tools are covered by Node's built-in test runner; every script
`index.html` loads, UI modules included, is at least parse-checked. There is nothing to install:
a stock Node LTS (22 or newer) is the only requirement.

```
node --test                      # discovers test/*.test.js
node --test "test/*.test.js"     # the same, spelled out
node --test test/yaml.test.js    # one file
```

`test/load.js` evaluates the real browser scripts against a stub `window`, so
the app code is tested exactly as shipped; there is no build step and no
`package.json`. The fixture corpus in `test/fixtures/items/` is a set of
complete work-item files (every scalar form, block scalars, nested namespaces,
comments, CRLF line endings, a BOM). Each one must parse without errors and
round-trip through `parseItem` → `serializeItem` content-equal to the source;
see `test/helpers.js` for the exact definition. When you fix a data-handling
defect, add a fixture that reproduces it. Two smaller corpora sit beside it:
`test/fixtures/reformat/` holds valid files the serializer rewrites in its own
layout without changing a value (flow collections, indentless sequences), and
`test/fixtures/lossy/` holds files the round-trip guard must flag (see "Notes &
limits"); `test/fixtures/transcripts/` holds synthetic session transcripts
for `tools/record-usage.js`. Fixtures are byte-exact inputs, so `.gitattributes` disables
line-ending conversion for them.

## What you can do

- **Board** — Kanban columns from `config/workflow.yaml`; cards show id, title,
  type, priority, assignee and labels.
- **Drag & drop** — move a card to another column. Only the `status:` line in
  that one file is rewritten — nothing else is touched.
- **Editor** — click a card for a split view: structured metadata form (with a
  raw-YAML toggle) on the left, Markdown editor/preview on the right. An unsaved
  indicator shows pending changes; **Save** writes the file and closes the
  editor (it stays open if the save fails), **Ctrl+S** writes it and keeps the
  editor open
  (pending edits are also flushed automatically when you switch items or close).
  Only the single file is written; field order and unknown fields are preserved.
  Dragging the card you have open to another column updates the editor too: with
  no unsaved edits it simply shows the new status; with unsaved edits only the
  changed field is merged in (a notice says so), and a field you edited yourself
  is left as you typed it. If a save fails, or the raw YAML does not parse,
  leaving the item (another card, a context document, **New work item**,
  **Refresh**, Esc or ✕) asks **Save / Discard / Cancel** instead of dropping
  your edits; Cancel (or Esc) keeps them exactly as they were.
- **Create** — make a new item from a template in `templates/`; the next
  zero-padded `TYPE-000000` id is generated automatically, from this clone's
  own ID block when the repository allocates in blocks (see below).
- **Search & filter** — by id/title text, and by type, status, priority
  (most urgent first), assignee, label.
- **Collapsible sidebar sections** — click the **Epics**, **Filter** or **AI
  usage** heading to fold it away; the browser remembers which are folded. A
  folded heading still shows what the section is doing: the focused epic, the
  shown count while a filter is set, or the usage total.
- **Epic focus** — the sidebar's **Epics** list shows every item with
  `type: EPIC` and its progress (items done / items in the epic). Click one to
  see only that epic and everything that reaches it through `parent` —
  grandchildren included, so a task under a story under the epic shows too.
  The other filters still apply on top; click the epic again or **Clear
  filters** to see everything. **No epic** shows the work that belongs to no
  epic. Epics in the last column are hidden until you tick **Show done**.
  The focus is a viewer-only filter, not persisted across sessions, and is
  cleared if the epic disappears after a reload. Membership is the whole
  `parent` chain (cycle-safe, nested epics allowed), and progress counts all
  members, not just the filtered ones. The list is a sidebar section rather
  than a board column because every board column is a workflow status and a
  drop target.
  While an epic is focused, **+ New work item** sets the new item's `parent`
  to it (unless you are creating an epic), and a card held up by open work
  outside the epic (its `depends_on`, or another item's `blocks`) shows
  **⛓ blocked outside epic**. An open epic's editor has **Focus on board**.
- **AI usage on cards** — an item that carries `agent.runs` (see "Tracking AI
  usage") shows a cost chip: the list-price cost when every run is priced by
  `config/ai.yaml`, otherwise the total tokens; red once the item is over its
  budget. Hover it for tokens by kind, models, handles and the budget line.
  Each column header shows the cost subtotal of its visible cards (prefixed
  `≥` when some runs are unpriced).
- **AI usage in the editor** — the `agent:` key renders as an "AI usage"
  section instead of a read-only block; in the `floating` detail display it has
  a tab of its own next to Metadata and Markdown, and in the side panels it
  sits in the metadata form. The section holds a budget input (the type
  default is the placeholder), spent and remaining with a progress bar, the
  usage warnings
  (over budget, unpriced model, duplicate run, early run), a runs table (the
  latest 20; past runs are read-only) and an **Add run** form. Adding a run or
  changing the budget is saved like any other edit; other keys under `agent`
  are kept and stay editable in Raw YAML.
- **AI usage totals in the sidebar** — total cost and tokens of the filtered
  items, by column and by handle, for a period you pick (all time, last 7 days,
  last 30 days, this month) by the runs' dates.
- **Context** — read-only viewer for `context/*.md`.
- **Validation** — required fields, ID format, filename-equals-ID, duplicate
  IDs across files and status-vs-workflow are checked; bad files surface
  errors but never stop the rest of the board from loading.
- **Themes** — dark (default) or light, each with a high-contrast variant that
  meets WCAG 2.2 AA: every text colour at least 4.5:1 on its surface, control
  borders and the focus ring at least 3:1. **☀ / ☾** in the top bar switches
  dark and light; **◐** turns high contrast on and off. The choice is kept in
  the browser; without one the board uses `theme:` from
  `config/user.local.yaml` — `dark`, `light`, `dark-aa` or `light-aa`.

## Avoiding ID collisions between working copies

The next ID is `max + 1` over the files in *your* checkout, so two clones that
each create an item before syncing mint the same ID: `STORY-000014` twice, an
add/add conflict on merge, or a silently dropped item when the conflict is
resolved by taking one side. One engineer with a PC and a Mac collides with
themselves, so the unit that matters is the working copy. The fix is
per-clone allocator blocks, backed by validation and a mechanical repair
(design: `docs/REVIEW-2026-09.md` §3; spec: `SPEC.md` §18.1).

**1. Prevention: one block per working copy.** Turn it on in `board.yaml`:

```yaml
id_allocation:
  strategy: block      # sequential (default) | block
  block_size: 1000
```

Every clone that creates items owns a block: block N is
`TYPE-N001 … TYPE-(N+1)000` for every type, and block 0 is where the items
you already have stay, so adoption needs no renumbering. Claimed blocks live
in the committed registry `config/id-blocks.yaml`, one line per clone; your
own block number lives in the git-ignored `config/user.local.yaml`:

```yaml
# config/id-blocks.yaml (committed)
blocks:
  - { block: 1, owner: rdagum, label: windows-pc, claimed: 2026-09-04 }
  - { block: 2, owner: rdagum, label: macbook, claimed: 2026-09-04 }

# config/user.local.yaml (git-ignored, one per clone)
handle: rdagum
id_block: 2
```

The **New work item** dialog refuses to generate an ID until this clone has a
registered block and offers **Claim a block** inline: it appends the lowest
free block to the registry, writes `id_block` to your local config and reminds
you to commit the registry (that commit is what makes the claim visible to
every other clone). The ID preview shows the block owner and label next to
the ID, e.g. `STORY-002007  block 2 · rdagum / macbook`. A person with two
machines has two clones and two blocks; an AI agent is just another allocator.

**2. Detection: the same checks in the app, in a hook and in CI.** Loading a
repository reports duplicate IDs across files, a filename that does not match
its `id:`, duplicate block numbers in the registry, a local `id_block` the
registry does not know, and an item that sits in a claimed block but was
created before the claim. `tools/validate-workspec.js` runs exactly the same
checks from Node with zero dependencies, prints one line per problem and
exits non-zero on errors (2 when the repository cannot be loaded):

```
node tools/validate-workspec.js               # nearest .workspec at or above the cwd
node tools/validate-workspec.js path/to/repo  # or an explicit repo / .workspec dir
node tools/validate-workspec.js --strict      # warnings fail too
```

As a pre-commit hook, checking the *staged* files (`.githooks/pre-commit`;
enable once per clone):

```
git config core.hooksPath .githooks
```

In CI, on the pull-request *merge result*, so that two branches which are each
valid on their own still fail when they collide with each other:
`.github/workflows/validate-workspec.yml` runs the unit tests and the
validator on `push` and `pull_request`. GitHub checks out the merge commit for
`pull_request` events; on a host that checks out the branch head instead, run
`git merge-tree --write-tree origin/main HEAD` and validate that tree.

**3. Repair: a mechanical renumber.** A collision from before adoption, or
from a misconfigured client, is fixed with one command that renames the file,
patches its `id:` line and rewrites every `parent`, `depends_on`, `blocks` and
`related` reference in the other items (whole-word Markdown mentions too with
`--body`):

```
node tools/renumber.js STORY-000014 STORY-002001 --dry-run   # show the plan
node tools/renumber.js STORY-000014 STORY-002001 --body      # do it
```

Policy: **renumber only the side that has not reached `main`**. IDs on `main`
are immutable; the branch adapts. This is the one sanctioned exception to
"never renumber" in `SKILL.md`.

Repositories that do not set `id_allocation` keep the sequential behaviour and
only gain the duplicate-ID and filename checks.

**Known limits — read this before pointing agents at a block repository.**

- *The block comes from `user.local.yaml`, which is git-ignored.* An agent in a
  throwaway worktree (for example a scheduled routine under
  `.claude/worktrees/`) checks out tracked files only, so the registry is
  there but the local file is not, and the app and tools report "no block"
  rather than guess. `SKILL.md` tells agents to use the registry entry whose
  `owner` is them, but the code does not yet resolve a block from the owner;
  until it does, give each such worktree its own `user.local.yaml`.
- *"What is taken" is the files in your checkout.* An ID minted on a branch
  that has not merged is invisible to a second branch cut from the same base,
  so two runs that each file an item from `origin/main` mint the same ID
  whether or not blocks are on. Blocks only separate *different* allocators;
  they do not protect one allocator from itself across branches. Until IDs
  are also reserved from every ref (`git log --all --diff-filter=A --name-only
  -- .workspec/items` lists every ID ever added), merge or push a filed item
  before the next run starts, and let CI's merge-result check catch the rest.
- A claim made on an unmerged branch is likewise invisible until it merges, so
  an unattended run should not claim a block itself.

## Tracking AI usage

Items are worked by AI agents, and every session consumes tokens. Git records
who changed what, not what it cost, and the transcripts that know are local and
short-lived — so a run's usage is recorded on the item itself, under the
reserved `agent:` namespace (`SPEC.md` §18.2):

```yaml
agent:
  budget_usd: 10
  runs:
    - date: 2026-09-09
      handle: Fable
      model: claude-fable-5-1
      input_tokens: 2
      output_tokens: 8000
      cache_read_tokens: 900000
      cache_write_tokens: 40000
      session: c08bb153-da05-4380-a295-7b0fd56f92c5
      source: claude-code
```

Runs are facts: tokens by kind, model, handle, date. They are appended, never
edited, and appending one does not bump `updated`. `date`, `handle` and `model`
are required; every other key is optional (`cache_write_1h_tokens`, `cost_usd`
as reported by the tool, `purpose` — plan, implement, review, feedback or
triage — `ref`, `session`, `source`, `estimated`). Token names mirror the
provider's usage object, an absent count is zero, and decimals such as
`cost_usd` stay exactly as written. `session` makes an import idempotent: a
second run with the same `source`, `session` and `model` is refused (a
validator warning if it gets in anyway). `estimated: true` marks numbers
approximated by hand or trimmed by a filter. There is deliberately no
duration: wall clock is not consumption, and time tracking is a non-goal.
Triage that belongs to no item goes on the parent epic with
`purpose: triage`. A mistaken run is corrected in a dedicated commit that says
why; that is the only time a run changes. Everything else is derived
when the repository loads — the cost of a run from an optional pricing table in
`config/ai.yaml` (a list-price equivalent, so it means the same thing whether
you pay per token or by subscription), an item's total, an epic's roll-up over
its children, and whether the item is over its budget (`agent.budget_usd`, else
the per-type default in `ai.yaml`). Nothing derived is written back. Two
branches that each append a run to the same item conflict on the same lines;
keep both.

**Configuration.** `config/ai.yaml` is optional and committed:

```yaml
# Prices are list-price equivalents per million tokens. Fill them from the
# published price list and date them in a comment; never hard-code them.
pricing:
  claude-fable-5-1: { input: …, output: …, cache_read: …, cache_write: …, cache_write_1h: … }
defaults:
  budget_usd: { STORY: 10, BUG: 5, TASK: 3, SPIKE: 5 }   # EPIC absent: an epic rolls up its children
policy:
  require_usage: true        # agent-assigned item without a `runs` key -> warning …
  require_usage_from: Review # … once it reaches this column or later (default: the last column)
```

The `_usd` suffix is the currency; there is no `currency` key. A budget is
`agent.budget_usd`, else `defaults.budget_usd` for the item's type, else none
(`null` at either level means none). `require_usage` is satisfied by the
presence of `agent.runs`, even empty: `runs: []` says "this agent-assigned
item was finished by hand". In `users.yaml`, `kind: agent` (and `model`) marks
an entry as an agent, which is how `require_usage` and the roll-ups tell
agents from people.

**Derived values.** A run's cost is its `cost_usd`, else its tokens priced by
`pricing[model]`, else unknown. An item's cost is the sum of its runs and is
unknown if any run is unpriced, because a partial sum would be misread. A
derived cost is a list-price equivalent, not an invoice: subscription users
pay no marginal cost, but the number still shows size and trend. An epic's
roll-up sums the items that reach it through `parent` (cycle-safe) and is
compared with the epic's own `budget_usd` if it has one. Archived items are
not loaded, so archived spend is not in any roll-up yet.

**Validation.** The checks run in the board, the validator and CI, with these
codes:

| Code | Severity | Raised when |
| --- | --- | --- |
| `invalid-usage` | error | `agent` is not a mapping, `runs` not a list, a run not a mapping or missing `date`/`handle`/`model`, a malformed date, or a negative or non-numeric token, cost or budget |
| `unpriced-model` | warning | the model is absent from a non-empty `pricing` |
| `over-budget` | warning | the item's cost exceeds its resolved budget |
| `unknown-handle` | warning | a run's `handle` is not in `users.yaml` |
| `missing-usage` | warning | `require_usage` is on, the assignee is a `kind: agent` user, the status is at or after `require_usage_from`, and there is no `runs` key |
| `duplicate-run` | warning | two runs share `source`, `session` and `model` |
| `early-run` | warning | a run is dated before the item's `created` |

**Budgets are a rule for agents, not for CI.** The validator only warns, and
CI runs without `--strict`, so `over-budget` and `missing-usage` never fail a
pull request. An agent cannot read its own usage while it runs — the numbers
exist only in the transcript and are complete when the session ends — so the
protocol (`SKILL.md` "AI Usage and Budgets") is a gate before and a record
after. Before: derive spent against the budget, and if it is spent do not
start; an unattended run opens a draft pull request titled `[over budget] …`,
leaves the item where it is, and reports. After, on every exit path: append one
run per model before the pull request merges. Two branches that append to one
item conflict at the same line; keep both.

**Recording and reporting.** Two zero-dependency tools do this from the command
line, with the same `--key=value` syntax as the other tools. `record-usage`
appends a run — typed in by hand, or imported from a Claude Code session
transcript including its subagents:

```
# by hand (only the token counts you give are written; --source defaults to manual)
node tools/record-usage.js STORY-000012 --handle=Opus --model=claude-opus-5-5 \
     --input=2 --output=8000 --cache-read=900000 --cache-write=40000 \
     --purpose=implement --session=c08bb153-… --dry-run

# from a transcript: a session id (looked up under ~/.claude/projects for this
# repository, worktree folders included) or the path of the .jsonl file
node tools/record-usage.js STORY-000012 --from-transcript=c08bb153-da05-4380-a295-7b0fd56f92c5
node tools/record-usage.js --from-transcript=c08bb153-… --item-from-branch   # ID from a workspec/<id>-… branch
node tools/record-usage.js STORY-000012 --from-transcript=c08bb153-… --branch=workspec/story-000012-x --since=2026-10-19
```

The append is a line-level edit (`appendRunText`): every other line of the file
stays byte-identical, line endings and a BOM are kept, and `updated` is not
touched — re-serializing would drop quotes, comments and flow style and cause
merge conflicts. Only when that edit is impossible (`agent` or `runs` written in
flow style, say) is the front matter re-serialized, and the tool says so on
stderr; an item the serializer would rewrite lossily is refused instead.
`--dry-run` prints exactly the lines that would be inserted. A run whose
`source`, `session` and `model` are already on the item is refused (exit 1,
nothing written) unless `--force`, so importing a session twice cannot
double-count it; an unknown ID is refused too.

A transcript is read once per distinct `message.id`: one API response is logged
as several rows that repeat the same usage block, so summing rows over-reports
several-fold. `<synthetic>` rows and rows without usage are skipped, and a
session's `subagents/agent-*.jsonl` files are included (leave them out with
`--no-subagents`) because the implementing model is often a subagent. One run is
written per model, with `source: claude-code`, `session` set to the session id
and the cache writes split into five-minute and one-hour. The handle comes from
the `users.yaml` entry whose `model` matches, else the entry whose handle occurs
in the model ID, else the model family (`--handle=H` overrides). `--since`,
`--until` and `--branch` keep only some rows; when they drop any, the runs are
marked `estimated: true`. Transcripts are pruned after a retention period, so
record soon, and a session is complete only when it ends — record once, at the
end.

`usage-report` derives the same numbers the board shows:

```
node tools/usage-report.js [PATH] [--by=status|assignee|model|type|label|epic] [--since=DATE] [--until=DATE] [--json] [--strict]
node tools/usage-report.js ID [PATH] [--json] [--strict]
```

Without an ID it prints the repository's totals, optionally grouped
(`.workspec-demo/` has runs to try it on; an item counts under each of its
labels, so label groups overlap, and a blank group is shown as `(none)`):

```
$ node tools/usage-report.js .workspec-demo --by=status
AI usage: 3 item(s) with runs, 4 run(s)
Cost:    unpriced ($5.67 known, 1 unpriced run)
Tokens:  in 28 · out 69.6k · cache read 3.2M · cache write 147k
Over budget: STORY-000002

status       items  runs  tokens             cost
Review           1     2    2.9M            $5.25
Backlog          1     1  122.6k            $0.42
In Progress      1     1    438k  $0.00+ unpriced
```

With an ID it prints that item's spent, budget and remaining — the budget gate
an agent runs before starting (an item without runs has spent nothing; an epic
reports its roll-up against its own budget):

```
$ node tools/usage-report.js STORY-000001
STORY-000001 — A1: Make the YAML engine lossless-or-loud (Done)
  spent      $19.87 (list-price equivalent)
  budget     $10.00
  remaining  -$9.87 (over budget)
  runs       2 (claude-opus-5-5, claude-sonnet-5-5)
  tokens     in 660 · out 79.2k · cache read 67.3M · cache write 1M
```

`--json` prints one object that a script can read; for an item the keys are
`scope` (`item`, or `rollup` for an epic), `id`, `title`, `status`, `assignee`,
`runs`, `tokens`, `totalTokens`, `spent`, `budget`, `remaining`, `overBudget`,
`priced`, `models` and `handles` (amounts rounded to at most four decimals;
`spent` and `remaining` are `null` when a run is unpriced, `budget` and
`remaining` when there is no budget), and for the repository `scope`, `since`,
`until`, `totals`, `by`, `groups` and `overBudget`. For example
`node tools/usage-report.js STORY-000012 --json` and read `remaining`. `--strict`
exits 1 when the item — or, without an ID, any item — is over budget. Exit codes
follow `validate-workspec.js`: 0 ok, 1 refused or over budget under `--strict`,
2 could not load or bad arguments. Archived items are not loaded, so they are in
no report. The board shows the cost chip on cards (leave `cost` out of
`settings.card_fields` in `board.yaml` to hide it), an editor section and sidebar
totals. `.workspec-demo/` carries an `ai.yaml` with Claude list prices and three
items with runs — one over budget, one unpriced, one with a recorded cost — so
all of this can be seen without waiting for a real run.

## Project layout

All JS files wrap their code in an IIFE and attach their public API to a shared
`window.WS` object; `index.html` loads them in dependency order.

```
index.html        app shell (loads the scripts below in order)
style.css         all styling
app.js            wiring: load, create, context, keyboard, toasts

core/
  filesystem.js   File System Access API abstraction (all I/O goes through here)
  parser.js       work-item parse / validate / serialize / surgical status patch
  allocation.js   per-clone ID blocks, registry, cross-file validation, renumber plans
  model.js        repository loader + board model, epic membership through parent

state/
  store.js        observable state (filters, selection, dirty flags, mutations)

ui/
  board.js        Kanban board + drag/drop
  editor.js       split metadata/markdown editor (explicit save, focus-stable)
  sidebar.js      search, epics focus list, filters, context list, new-item entry
  dom.js          DOM helpers + safe Markdown renderer

utils/
  yaml.js         order-preserving YAML parser/serializer (purpose-built subset)
  ids.js          ID format / next-id rules

test/             node --test suite (not loaded by the browser)
  load.js         evaluates the scripts above in Node against a stub window
  helpers.js      fixture discovery + the "content-equal" comparison
  *.test.js       yaml, ids, parser, allocation, usage, model, store, transcript
                  and tools tests; roundtrip runs the fixture corpus; theme checks
                  the style.css palettes' contrast
  fixtures/items/ complete work-item files that must round-trip unchanged
  fixtures/reformat/, fixtures/lossy/   reformatted-but-equal and guard-flagged files
  fixtures/transcripts/   synthetic Claude Code session + subagent transcripts for record-usage

tools/            node CLIs (zero dependencies; reuse test/load.js)
  lib.js          Node filesystem adapter + repository loader for the tools
  validate-workspec.js   the board's checks from the command line; non-zero exit on errors
  renumber.js     move one item to a new ID and rewrite every reference
  record-usage.js append AI-usage runs to an item, by hand or from a Claude Code transcript
  usage-report.js repository totals (grouped) or one item's spent / budget / remaining
  transcript.js   Claude Code transcript reader for record-usage (the one Claude-specific file)

.githooks/        pre-commit: validate the staged .workspec (git config core.hooksPath .githooks)
.github/workflows/validate-workspec.yml   tests + validator on push and PR merge result

.workspec/        this project's backlog (config, templates, context, items)
.workspec-demo/   sample repository for manual testing
```

## Data-handling guarantees

- YAML field order and unknown fields/namespaces are preserved on save.
- Only the file you edited is rewritten — no batch normalization.
- Drag/drop performs a surgical single-line edit of `status:`.
- Front matter the serializer would not reproduce is never re-serialized: it is
  edited as raw YAML and saved verbatim (see "Notes & limits").
- IDs are immutable, zero-padded to six digits, formatted `TYPE-000123`.
- A new ID is never one that another working copy could also generate when
  `id_allocation.strategy: block` is on; the app refuses rather than guesses.
- Status always matches a configured workflow column.

## Notes & limits

The bundled YAML engine implements the subset WorkSpec uses (scalars, quoted
strings, block/flow sequences and mappings, nested mappings, literal block
scalars). It is **lossless or loud**: a line it cannot place — indented deeper
than its mapping, not a `key: value` pair, a duplicate key, a `{...}` that is
not a mapping — is an error that names the file line (`YAML parse error: line
4: unexpected indentation: "oops: 1"`), never silently skipped. Such an item
shows its error on the card and is never re-serialized from the form.

Comments inside front matter, standalone or trailing (`priority: high #
urgent`), are not part of any value and are not preserved across a *metadata*
re-serialize; a drag/drop status change preserves the file byte-for-byte
except the one line (a trailing comment on that line is kept).

**Round-trip guard.** On load every item is checked: would writing its front
matter back through the serializer change what it says? The check compares
structure, not text, so the serializer's own layout is fine — indentation,
quote style, flow versus block collections, comments. It flags content that
would change: anchors, aliases and tags (`&a`, `*a`, `!!str`), which this
engine reads as plain text; folded `>` blocks; integers written another way
(`007`); unclosed brackets (`[WIP] title`); nested sequences. A flagged item
carries a warning naming the first differing field, opens in the editor as
**Raw YAML only**, and is saved verbatim — the text you see, with the file's
BOM, fences and line endings kept — never re-serialized. Drag/drop still works
when the file has a top-level `status:` line. An item that fails to parse, or
still has Git conflict markers, is handled the same way. Fix the YAML in the
raw view and, once it round-trips, the form view comes back.

## License

Released under the [MIT License](LICENSE.md) — free for anyone, including
commercial use, to use, modify, and distribute.
