# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Two things at once:

1. **A specification.** `SPEC.md` defines WorkSpec — a Git-native format for storing work items as Markdown files with YAML front matter under `.workspec/`. `SKILL.md` tells AI agents how to operate on such repositories. `PROMPT.md` is the original brief for the reference implementation and still functions as its requirements document (its section numbers are cited throughout the source comments).
2. **The reference implementation of that specification** — a zero-backend browser board (`index.html` + vanilla JS) plus Node CLI tools and a test suite.

The repository also *uses* WorkSpec on itself: `.workspec/` is this project's own backlog, and `.workspec-demo/` is a sample repository for manual testing. `docs/REVIEW-2026-09.md` is the architecture review that the backlog items derive from; its section numbers (A1–A8, F1–F5, §3) are referenced by item bodies and code comments.

Precedence when documents disagree: `SPEC.md` > `SKILL.md`. `README.md` is the user-facing manual and is unusually complete — read it before writing any user-facing docs, and update it when behaviour changes.

## Commands

There is **no `package.json`, no build step, and no dependencies**. Stock Node LTS (22+) is the only requirement.

```bash
node --test                          # whole suite (discovers test/*.test.js)
node --test test/yaml.test.js        # one file
node --test --test-name-pattern="flow mappings"   # one suite/test by name

node tools/validate-workspec.js              # validate nearest .workspec at/above cwd
node tools/validate-workspec.js .workspec    # explicit target; exit 1 on errors, 2 if unloadable
node tools/validate-workspec.js --strict     # warnings fail too

node tools/renumber.js STORY-000014 STORY-002001 --dry-run  # show the plan
node tools/renumber.js STORY-000014 STORY-002001 --body     # apply, incl. Markdown mentions

git config core.hooksPath .githooks   # once per clone: pre-commit validates the *staged* .workspec
```

Running the app: double-click `index.html` in Chrome or Edge (the File System Access API is required; other browsers are unsupported). `./run.sh [port]` optionally serves it over `http://127.0.0.1` for Chrome versions that are stricter about write permission on `file://`; it is a static file host and runs none of the app logic.

CI (`.github/workflows/validate-workspec.yml`) runs `node --test` and the validator on push and on the pull-request *merge result* — so two branches that are each valid alone still fail when their IDs collide.

## Architecture: one code path, three runtimes

The single most important structural fact is that the browser app, the Node CLI tools, and the test suite all execute **the same source files**, unmodified.

- Every app module is a classic script of the form `(function (WS) { ... })(window.WS = window.WS || {});`, attaching its public API to a shared `window.WS` namespace. Not ES modules, not a bundler — that is what lets `index.html` run straight from `file://`.
- `index.html` loads the scripts in dependency order. **That `<script>` list is the dependency graph**; adding a module means inserting it at the right position there.
- `test/load.js` evaluates those same files in Node through `vm`, handing each one a stub `window`. `loadWS(['utils/yaml.js', ...])` returns a freshly populated `WS` namespace per call. `PURE_MODULES` names the modules with no DOM/File-System-Access dependency; if you add a pure module, add it there too.
- `tools/lib.js` supplies `NodeWorkspecFS`, a Node filesystem adapter implementing the *same interface* as `core/filesystem.js` (`exists`/`readFile`/`writeFile`/`deleteFile`/`listFiles`). `WS.loadRepository(fs)` therefore runs identically in both. This is why the validator can never disagree with the board about what a file means.

Consequence: never add a runtime dependency, an ES-module `import`, a network request, or a framework. Keep DOM access out of `core/`, `state/`, and `utils/` so those modules stay loadable in Node.

### Module responsibilities

```
utils/yaml.js     order-preserving YAML parser/serializer (purpose-built subset), plus
                  splitDocument/joinDocument and patchScalarLine (single-line surgical edit)
utils/ids.js      ID format, next-id, block arithmetic (blockRange/blockOf/maxBlock)
core/parser.js    parseItem / validateItem / serializeItem / changeStatus; also detects
                  unresolved Git conflict markers
core/allocation.js  ID blocks: registry parsing, allocateId, claim/lowestFreeBlock,
                  cross-file validateRepository, and renumberPlan/rewriteReferences
core/model.js     loadRepository(fs) -> the whole in-memory model; buildColumns, sortItems
core/filesystem.js  browser File System Access backend (all app I/O goes through it)
core/recent.js    IndexedDB-backed list of previously opened repositories
state/store.js    observable store: filters, selection, dirty flag, and every mutation
                  (saveItem, moveItem, addItem, deleteItem, claimIdBlock)
ui/*.js           board (drag/drop), editor (split metadata/Markdown), sidebar, dom helpers
app.js            wiring only: render loop, dialogs, keyboard, toasts, theme, recent repos
```

`ui/dom.js` contains a hand-rolled Markdown renderer that escapes first and applies inline rules to the already-safe text, and refuses `javascript:` links. There is deliberately no Markdown library — keep it that way.

## Data-handling contract

These are the guarantees the whole design exists to provide. Violating one is a defect, not a style choice.

- **Field order and unknown fields survive a save.** `meta` is an insertion-ordered object; `serializeItem` emits whatever order it holds. `CANONICAL_ORDER` in `core/parser.js` applies only to brand-new items.
- **Only the edited file is rewritten.** No batch normalization, ever.
- **Drag/drop is a surgical single-line patch** of `status:` via `patchScalarLine`, leaving the file byte-identical otherwise.
- **Parsing never throws.** Errors land on `record.errors` so one bad file cannot stop the board from loading the rest (`PROMPT.md` §11).
- **The filename equals the ID** (`SPEC.md` §7.2) — a mismatch is an error, not a warning.
- **`status` must match a configured workflow column.**
- Known limit: standalone `#` comments inside front matter are not preserved across a metadata re-serialize. `test/helpers.js` `normalizeDocument` encodes exactly which differences are tolerated; everything else must match byte for byte.

## Tests

`test/fixtures/items/` is a corpus of complete work-item files covering every scalar form, block scalars, nested namespaces, comments, CRLF, and a BOM. Each must parse without errors and round-trip `parseItem` → `serializeItem` content-equal to its source (`test/roundtrip.test.js`).

**When you fix a data-handling defect, add a fixture that reproduces it.** Fixtures are byte-exact inputs; `.gitattributes` disables line-ending conversion and BOM stripping for them, so do not reformat them.

## ID allocation (this repo uses blocks)

`.workspec/config/board.yaml` sets `id_allocation.strategy: block` with `block_size: 1000`, so "next ID = max + 1" is wrong here. Block *N* covers `TYPE-N001 … TYPE-(N+1)000`; block 0 holds the pre-adoption items and is never claimed.

- Claimed blocks live in the committed `.workspec/config/id-blocks.yaml`; this clone's block number lives in the git-ignored `.workspec/config/user.local.yaml` (`handle` + `id_block`).
- **Allocate only inside your own block.** If no block is configured, stop and ask — do not fall back to a sequential ID; that is precisely the collision the scheme prevents. If the block is exhausted, claim the lowest free block and commit the registry.
- **IDs are immutable.** The one sanctioned exception is a duplicate ID that reached a merge: renumber only the side that has *not* reached `main`, using `tools/renumber.js` (never by hand, so the filename, the `id:` line, and every `parent`/`depends_on`/`blocks`/`related` reference change together), and commit that renumber on its own.

Background: `SPEC.md` §18.1 (normative), `docs/REVIEW-2026-09.md` §3 (design rationale), `README.md` "Avoiding ID collisions between working copies" (user-facing).

## Working the backlog

Items live in `.workspec/items/TYPE-NNNNNN.md`. Locate work by ID, not by title. Read the entire item — the YAML carries the structured requirements, the Markdown carries the reasoning — then load anything listed under `context:` before planning. Check `depends_on` / `blocks` / `parent` before implementing and say so if a dependency blocks the work.

When work starts, update `status`, `updated`, and `assignee` if appropriate; when it finishes, `status` and `updated`. Never touch `id`, `created`, or `type`. Do not add changelog or history metadata to items — Git already records that. The one exception is `agent.runs` (`SPEC.md` §18.2, `docs/DESIGN-2026-09-ai-usage.md`): AI usage is data Git does not record, so a run is appended there and never edited.

Before considering an item done: acceptance criteria and definition of done satisfied, `node --test` green, `node tools/validate-workspec.js .workspec` clean, and no unrelated files touched. `SKILL.md` has the full checklist.
