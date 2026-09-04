# Architecture

WorkSpec Board is a zero-backend, build-free web app: plain HTML, CSS and
classic `<script>` files that share a global `window.WS` namespace and are
loaded in dependency order by `index.html`. It reads and writes a `.workspec/`
directory through the browser File System Access API (Chromium only).

## Layers (dependency flows downward only)

| Layer   | Files                                   | Responsibility |
|---------|-----------------------------------------|----------------|
| utils   | `utils/yaml.js`, `utils/ids.js`         | Order-preserving YAML subset engine; ID format and next-id rules |
| core    | `core/filesystem.js`, `core/parser.js`, `core/allocation.js`, `core/model.js` | File access seam; parse/validate/serialize items; per-clone ID blocks, cross-file validation and renumber plans (pure); repository loader and board model |
| state   | `state/store.js`                        | Observable state bag, derived selectors, mutations that write files |
| ui      | `ui/board.js`, `ui/editor.js`, `ui/sidebar.js`, `ui/dom.js` | Views rendered against the store; DOM helpers and restricted Markdown renderer |
| app     | `app.js`                                | Wiring, repository lifecycle, dialogs, overlay/toast, theme, keyboard |

## Tests (outside the layers, never loaded by the browser)

`test/` holds a `node --test` suite with no dependencies and no build step.
`test/load.js` evaluates the unchanged browser scripts against a stub `window`
and returns the `WS` namespace; it is the loader any Node tool (for example a
future `tools/validate-workspec.js`) should reuse. `test/fixtures/items/` is a
corpus of complete work-item files that must round-trip content-equal through
`parseItem` / `serializeItem`; a defect fix in `utils/` or `core/` adds a
fixture there. Run with `node --test`.

## Command-line tools (Node, zero dependencies, outside the layers)

`tools/validate-workspec.js` and `tools/renumber.js` load the unchanged
browser modules through `test/load.js` and drive `loadRepository` with the
Node filesystem adapter in `tools/lib.js`, so they can never disagree with the
board about what a file means. The validator runs from `.githooks/pre-commit`
(staged tree) and from `.github/workflows/validate-workspec.yml` (pull-request
merge result). Keep every check in `core/`; the tools only print and exit.

## Invariants to preserve

- Every read/write goes through `WorkspecFS`.
- Only the edited file is rewritten; drag/drop patches the single `status:` line.
- YAML field order and unknown fields survive a save.
- A new ID is never one another working copy could also generate: under
  `id_allocation.strategy: block` allocation happens only inside this clone's
  registered block, and never falls back to sequential.
- One bad file never stops the board from loading.
- No network requests, no external scripts, no build step.

## Reference documents

- `SPEC.md` — the WorkSpec specification the app implements.
- `PROMPT.md` — requirements for this reference implementation.
- `docs/REVIEW-2026-09.md` — architecture and code review (2026-09-04); work items A1–A8 and F1–F5 derive from it.
- `.workspec-demo/` — a sample repository used for manual testing; not the project backlog.
