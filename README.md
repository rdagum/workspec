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

WorkSpec does not duplicate these capabilities.

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
`core/allocation.js`, `core/model.js`, `state/store.js`) and the command-line
tools are covered by Node's built-in test runner. There is nothing to install:
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
defect, add a fixture that reproduces it. Fixtures are byte-exact inputs, so
`.gitattributes` disables line-ending conversion for them.

## What you can do

- **Board** — Kanban columns from `config/workflow.yaml`; cards show id, title,
  type, priority, assignee and labels.
- **Drag & drop** — move a card to another column. Only the `status:` line in
  that one file is rewritten — nothing else is touched.
- **Editor** — click a card for a split view: structured metadata form (with a
  raw-YAML toggle) on the left, Markdown editor/preview on the right. An unsaved
  indicator shows pending changes; save with the **Save** button or **Ctrl+S**
  (pending edits are also flushed automatically when you switch items or close).
  Only the single file is written; field order and unknown fields are preserved.
- **Create** — make a new item from a template in `templates/`; the next
  zero-padded `TYPE-000000` id is generated automatically, from this clone's
  own ID block when the repository allocates in blocks (see below).
- **Search & filter** — by id/title text, and by type, status, assignee, label.
- **Context** — read-only viewer for `context/*.md`.
- **Validation** — required fields, ID format, filename-equals-ID, duplicate
  IDs across files and status-vs-workflow are checked; bad files surface
  errors but never stop the rest of the board from loading.

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
  model.js        repository loader + board model

state/
  store.js        observable state (filters, selection, dirty flags, mutations)

ui/
  board.js        Kanban board + drag/drop
  editor.js       split metadata/markdown editor (explicit save, focus-stable)
  sidebar.js      search, filters, context list, new-item entry
  dom.js          DOM helpers + safe Markdown renderer

utils/
  yaml.js         order-preserving YAML parser/serializer (purpose-built subset)
  ids.js          ID format / next-id rules

test/             node --test suite (not loaded by the browser)
  load.js         evaluates the scripts above in Node against a stub window
  helpers.js      fixture discovery + the "content-equal" comparison
  *.test.js       yaml, ids, parser, allocation, model, store and tools tests;
                  roundtrip runs the fixture corpus
  fixtures/items/ complete work-item files that must round-trip unchanged

tools/            node CLIs (zero dependencies; reuse test/load.js)
  lib.js          Node filesystem adapter + repository loader for the tools
  validate-workspec.js   the board's checks from the command line; non-zero exit on errors
  renumber.js     move one item to a new ID and rewrite every reference

.githooks/        pre-commit: validate the staged .workspec (git config core.hooksPath .githooks)
.github/workflows/validate-workspec.yml   tests + validator on push and PR merge result

.workspec/        this project's backlog (config, templates, context, items)
.workspec-demo/   sample repository for manual testing
```

## Data-handling guarantees

- YAML field order and unknown fields/namespaces are preserved on save.
- Only the file you edited is rewritten — no batch normalization.
- Drag/drop performs a surgical single-line edit of `status:`.
- IDs are immutable, zero-padded to six digits, formatted `TYPE-000123`.
- A new ID is never one that another working copy could also generate when
  `id_allocation.strategy: block` is on; the app refuses rather than guesses.
- Status always matches a configured workflow column.

## Notes & limits

The bundled YAML engine implements the subset WorkSpec uses (scalars, quoted
strings, block/flow sequences, nested mappings, block scalars). Standalone YAML
comments inside front matter are not preserved across a *metadata* re-serialize;
a drag/drop status change preserves the file byte-for-byte except the one line.

## License

Released under the [MIT License](LICENSE.md) — free for anyone, including
commercial use, to use, modify, and distribute.
