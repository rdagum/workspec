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
click **Open .workspec folder**, select the `.workspec` directory (a demo one
ships in this repo), and grant read/write when prompted.

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

.workspec/        demo repository (config, templates, context, items)
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
