# STORY-000002 — Single source of truth for the open record

Source: `.workspec/items/STORY-000002.md`, `docs/REVIEW-2026-09.md` §1.2 A2 and §4 findings 2, 3, 16.
Gates (this repo, per CLAUDE.md): `node --test`, `node tools/validate-workspec.js .workspec`. The
`workspec-project-gates` skill in this checkout describes a different project (Matchday), so it is not used.
Every step ships its own tests where the code is loadable in Node (`state/`); `ui/` and `app.js` need a DOM and are
covered by the manual scenario in the last step. No new dependencies; the browser code path stays plain scripts.

Design in one paragraph: `record.version` is a counter owned by the store. `saveItem`, `moveItem`, `addItem` and a
model reload (`set({ model })`) advance it. The editor remembers the version it bound to; when the record it has open
shows a different version it either rebinds (clean working copy) or merges only the keys the external change touched
(dirty working copy), keeping every key the user also edited, and shows an inline notice. `save()` reports success; every
place that would drop the buffer asks `leave()` first, which falls back to a Save / Discard / Cancel dialog.

- [x] 1. Store: `record.version`. A private `_bump(record)` advances it in `saveItem` (form and lossy-verbatim paths), `moveItem` and `addItem` (starts at 1). `set({ model })` stamps a replaced model's records with `previous version at the same path + 1` (1 for new paths), so a reload is visible to an editor that kept a path open. A failed write bumps nothing. Tests in `test/record-version.test.js`.
- [x] 2. Store: remove the dead `state.dirty` flag and every `dirty:` patch (`open`, `close`, `saveItem`, `_saveVerbatim`, `addItem`); update the header comment. The editor's `_dirty` becomes the only dirty flag. Test asserts the key is gone.
- [x] 3. Store: export `mergeWorkingCopy(base, working, incoming)`, a pure three-way merge over top-level keys (plus the body) returning `{ meta, applied, kept }`: keys the external change touched and the user did not are taken from `incoming`; keys both touched keep the user's value and are listed in `kept`; inputs are never mutated. Tests in `test/record-version.test.js`.
- [x] 4. Editor: `_bind` keys on `path + version`. Clean working copy rebinds; dirty working copy merges via `mergeWorkingCopy` (raw-YAML buffer regenerated, or patched line by line while it holds invalid YAML), records the base it merged against, and sets an inline notice rendered in the validation strip. `sync()` re-renders when the open record's version moved, and ignores the bump caused by the editor's own save. `reset()` also forgets the version.
- [x] 5. Editor: `save()` resolves `true` (saved, or nothing to save) / `false` (write failed, or raw YAML invalid) and remembers why. New `leave()` loops save → on failure asks the injected `confirmLeave` for `save | discard | cancel` (default `cancel`, never a silent discard); `_closeGuard` (✕, Escape, backdrop) and `_focusEpic` use it.
- [x] 6. App: `app.js` subscribes `editor.sync()` when the editor key has not changed; `flushOpenEditor()` returns a boolean and `openItem`, `onOpenContext`, `createItem` and `refreshRepository` stop (buffer kept) on `false`; a `promptUnsaved` dialog (Save / Discard / Cancel) is layered over whatever overlay is open and restores it afterwards; Escape or a backdrop click on it counts as Cancel.
- [ ] 7. Docs: README editor bullet (what an open card does when it is dragged, what happens when a save fails), CLAUDE.md store description (no dirty flag, versions). Full gates, then the manual scenario from the item against a real browser profile: open a card, drag it to another column, edit the title, save, reload from disk — status and title both correct.
- [x] 8. Follow-up requested after the PR was opened: the **Save** button also closes the editor (`_saveAndClose`: save, then `store.close()` only if the save succeeded; a failed save stays open and does not raise the leave prompt). Ctrl+S still saves and keeps the editor open. README and the editor header comment updated; the browser scenarios that clicked Save now expect the editor to close.

Out of scope, noted for the PR: opening another repository (`openRepository` / `openRecent` → `loadInto`) also drops an unsaved buffer. It is not one of the four call sites in the item, so it is reported rather than changed. The optional Revert button from the item's Implementation Notes is not built: Discard in the new dialog covers leaving, and a header button is a UI addition the acceptance criteria do not ask for.
