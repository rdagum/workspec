# Architecture

WorkSpec Board is a zero-backend, build-free web app: plain HTML, CSS and
classic `<script>` files that share a global `window.WS` namespace and are
loaded in dependency order by `index.html`. It reads and writes a `.workspec/`
directory through the browser File System Access API (Chromium only).

## Layers (dependency flows downward only)

| Layer   | Files                                   | Responsibility |
|---------|-----------------------------------------|----------------|
| utils   | `utils/yaml.js`, `utils/ids.js`         | Order-preserving YAML subset engine; ID format and next-id rules |
| core    | `core/filesystem.js`, `core/parser.js`, `core/model.js` | File access seam; parse/validate/serialize items; repository loader and board model |
| state   | `state/store.js`                        | Observable state bag, derived selectors, mutations that write files |
| ui      | `ui/board.js`, `ui/editor.js`, `ui/sidebar.js`, `ui/dom.js` | Views rendered against the store; DOM helpers and restricted Markdown renderer |
| app     | `app.js`                                | Wiring, repository lifecycle, dialogs, overlay/toast, theme, keyboard |

## Invariants to preserve

- Every read/write goes through `WorkspecFS`.
- Only the edited file is rewritten; drag/drop patches the single `status:` line.
- YAML field order and unknown fields survive a save.
- One bad file never stops the board from loading.
- No network requests, no external scripts, no build step.

## Reference documents

- `SPEC.md` — the WorkSpec specification the app implements.
- `PROMPT.md` — requirements for this reference implementation.
- `docs/REVIEW-2026-09.md` — architecture and code review (2026-09-04); work items A1–A8 and F1–F5 derive from it.
- `.workspec-demo/` — a sample repository used for manual testing; not the project backlog.
