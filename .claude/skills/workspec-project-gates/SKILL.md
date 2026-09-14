---
name: workspec-project-gates
description: How this project provisions an isolated worktree and verifies a change — there is nothing to install, the gates are Node's test runner and the WorkSpec validator, and the UI layer has no automated coverage. Invoked by the daily-workspec and address-pr-feedback routines; also use when the user asks "how do I run the tests", "what are the quality gates", or is about to create a new work item.
allowed-tools: Bash, Read, Glob, Grep
---

# WorkSpec: Worktree Provisioning and Quality Gates

This is the project-specific half of the WorkSpec routines. The generic process
lives in the personal `daily-workspec` and `address-pr-feedback` skills; every
command below is this repository's own.

The shape of this project matters for everything here: it is a **zero-dependency
static browser app**. No `package.json`, no build step, no backend, no API and no
database (`PROMPT.md` §3.1). `index.html` loads classic scripts directly, and
`test/load.js` evaluates those same files against a stub `window`, so the code is
tested exactly as shipped.

## Provisioning a worktree

**There is nothing to install.** A stock Node LTS (22 or newer) is the only
requirement; this machine has v24.13.0. Do not run a package manager, create a
virtualenv, or look for a lockfile — there are none.

**No `.worktreeinclude` is needed, and the repository deliberately has none.**
The only gitignored files are `.workspec/config/user.local.yaml` and its
`.workspec-demo` twin, and neither is required by any gate. The one situation
that needs `user.local.yaml` is creating a new work item — see **ID allocation**
below, which tells you to stop rather than work around its absence.

Confirm the toolchain and move on:

```bash
node --version    # must be v22 or newer
```

## Starting services

**None.** The routine never starts a server for this project.

`./run.sh` exists but is optional and irrelevant to the gates: it is a bare
static file host (`python3 -m http.server`) that serves the app over
`http://127.0.0.1:9000` instead of `file://`, because some Chrome versions treat
that as a friendlier secure context for the File System Access API. It runs none
of the application logic. Use it only for the manual browser verification
described below, and stop it with Ctrl+C when done.

Nothing to record a pid for, and nothing to shut down at the end of a run.

## The gates

These are exactly what CI runs (`.github/workflows/validate-workspec.yml`), which
makes them the authoritative set. Run both from the worktree root:

```bash
node --test
node tools/validate-workspec.js .workspec
```

For reference, a clean tree currently reports `258 tests, 0 fail` and
`OK: 14 item(s), 0 error(s), 0 warning(s)`.

`node --test` discovers `test/*.test.js`. To run one file while iterating:
`node --test test/yaml.test.js`.

The validator takes a `.workspec` directory or a repository containing one, and
supports `--strict` (warnings become errors) and `--quiet`. Its exit codes are
meaningful and must be honoured: **0** clean, **1** problems found, **2** could
not load the repository. A `2` is not a test failure — it means the repository
did not parse at all, and should be reported as such rather than retried.

CI runs the validator against the pull request's **merge** commit, so two
branches that each created the same ID both pass locally and fail together on
merge. That is the safety net for the ID rule below, not a substitute for it.

When you fix a data-handling defect, add a fixture to `test/fixtures/items/`
reproducing it. Fixtures are byte-exact inputs — every one must parse without
errors and round-trip through `parseItem` → `serializeItem` content-equal to the
source — and `.gitattributes` disables line-ending conversion for them, so never
"normalise" a fixture's line endings or BOM.

## Gates that cannot run here

**The UI layer has no automated coverage at all.** `test/load.js` evaluates only
modules with no DOM or File System Access dependency. The tests load
`utils/yaml.js`, `utils/ids.js`, `core/parser.js`, `core/allocation.js`,
`core/model.js`, `core/recent.js` and `state/store.js`, plus the `tools/`
scripts. That leaves entirely untested:

- `ui/board.js`, `ui/dom.js`, `ui/editor.js`, `ui/recent.js`, `ui/sidebar.js`
- `core/filesystem.js`

`test/syntax.test.js` compiles every script `index.html` lists, so a change to
one of those files that does not *parse* now fails `node --test`; a change that
parses but misbehaves still **passes every gate above while being completely
unverified**. Do not report such a change as tested. Verify it by hand — run
`./run.sh`, open `http://127.0.0.1:9000` in a Chromium browser (Chrome or Edge;
the File System Access API is required), click **Open .workspec folder**, and
exercise the affected behaviour — or, if the run is unattended, say plainly in
the pull request which UI behaviour needs the user's eyes and why no gate covers
it.

`.workspec-demo/` is a sample repository that ships for trying the board out;
prefer it over the real `.workspec/` when manually exercising anything that
writes.

## Creating new WorkSpec items

This repository allocates IDs **in blocks**, not sequentially
(`.workspec/config/board.yaml`: `id_allocation.strategy: block`,
`block_size: 1000`). Block N covers `TYPE-N001 … TYPE-(N+1)000` for every type,
and block 0 holds the items that predate the scheme.

The reason is that the next ID is otherwise `max + 1` over *your* checkout, so
two working copies that each create an item before syncing mint the same ID —
an add/add conflict, or a silently dropped item when someone resolves it by
taking one side. As `README.md` puts it, an AI agent is just another allocator: a
routine's worktree is a working copy and needs its own block.

The two halves live in different places, and that is what makes a worktree work:

- `.workspec/config/id-blocks.yaml` is **committed**, so a worktree has it. It
  names one block per owner, including one per agent handle.
- `.workspec/config/user.local.yaml` is **gitignored**, so a worktree does *not*
  have it — and `allocationState()` reads `model.local.id_block` from exactly
  that file (`core/allocation.js:173`). Without it `allocateId()` throws
  `no-block` and refuses to mint an id.

So the run writes its own, deriving the block from the registry by the item's
assignee. **Before minting any new item id:**

```bash
node .claude/skills/workspec-project-gates/scripts/ensure-id-block.js <assignee>
```

It prints the block number and writes a two-line `user.local.yaml` naming that
handle and block. Because the file is gitignored it is never committed, and
because the block comes from the assignee each agent allocates in its own range
— no shared block, no collision between a run and the user working in the main
checkout.

The script **refuses to run in the main checkout**, where that file holds the
user's own identity and board settings and overwriting it would discard them. It
also **exits 1 when the handle owns no block**, printing who does. When that
happens, do not invent a block or an id: describe the intended item in the pull
request body and let the user claim one. A colliding id is far more expensive to
unpick than a deferred item.

A block claim is only real once `id-blocks.yaml` is **committed** — that commit
is what makes it visible to worktrees, to CI and to every other clone. An
uncommitted claim looks exactly like no claim at all from inside a worktree.

`tools/renumber.js` is the sanctioned repair when a collision does happen, and
only on the side that has not reached main: ids already on main are immutable
and the branch adapts.

## Release bookkeeping

**None.** There is no version to bump: no `package.json`, no manifest, and no
version constant in the application code. The `spec_version: 1.0` in item
frontmatter is the WorkSpec format version, not this app's, and must not be
touched as part of ordinary work.

## Stopping what you started

Nothing to stop. If you ran `./run.sh` for a manual check, end it with Ctrl+C;
otherwise a run leaves no processes behind.
