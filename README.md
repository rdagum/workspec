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

> Optional: a `run.sh` is included if you'd rather serve over
> `http://127.0.0.1:8000` (some Chrome versions are stricter about write
> permission on `file://`). It's only a static file host and runs none of the
> app logic.

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
  zero-padded `TYPE-000000` id is generated automatically.
- **Search & filter** — by id/title text, and by type, status, assignee, label.
- **Context** — read-only viewer for `context/*.md`.
- **Validation** — required fields, ID format and status-vs-workflow are checked;
  bad files surface errors but never stop the rest of the board from loading.

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

.workspec/        this project's backlog (config, templates, context, items)
.workspec-demo/   sample repository for manual testing
```

## Data-handling guarantees

- YAML field order and unknown fields/namespaces are preserved on save.
- Only the file you edited is rewritten — no batch normalization.
- Drag/drop performs a surgical single-line edit of `status:`.
- IDs are immutable, zero-padded to six digits, formatted `TYPE-000123`.
- Status always matches a configured workflow column.

## Notes & limits

The bundled YAML engine implements the subset WorkSpec uses (scalars, quoted
strings, block/flow sequences, nested mappings, block scalars). Standalone YAML
comments inside front matter are not preserved across a *metadata* re-serialize;
a drag/drop status change preserves the file byte-for-byte except the one line.

## License

Released under the [MIT License](LICENSE.md) — free for anyone, including
commercial use, to use, modify, and distribute.
