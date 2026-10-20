# STORY-001002 — AI usage: record-usage and usage-report command-line tools

Source: `.workspec/items/STORY-001002.md`, `SPEC.md` §18.2, `SKILL.md` "AI Usage and Budgets", README "Tracking AI usage".
Depends on STORY-001001 (Done): `core/usage.js` already has `appendRunText`, `itemUsage`, `summarize`, `rollup`.
Gates (this repo, per CLAUDE.md): `node --test`, `node tools/validate-workspec.js .workspec`. The
`workspec-project-gates` skill in this checkout describes a different project (Matchday: docker, Robot, Alembic), so it is
not used. No new runtime dependency; the tools are plain Node scripts like `tools/renumber.js`.

Design in one paragraph: both tools load the repository through `loadWorkspec` (the board's own loader), so they can never
disagree with the board about what an item means. `record-usage.js` builds one or more run mappings — from flags, or from
a Claude Code transcript — and appends each with `appendRunText`, so every other line of the file stays byte-identical and
`updated` is never touched. All WorkSpec arithmetic (cost, budget, roll-ups, grouping, rounding) stays in `core/usage.js`;
the tools parse arguments, read files and print. The Claude Code transcript format is the one thing that is not
WorkSpec's, so it lives in a single Node-only module, `tools/transcript.js`, with every field name in one table and a row
that lacks `message.usage` treated as a skip rather than a crash.

- [x] 1. Core: group-by and per-item helpers in `core/usage.js`. `summarizeBy(model, by, { records, since, until })` for
  `status | assignee | model | type | label | epic` (a label puts an item in every group it names; epic is the nearest
  epic, an epic's own runs sit under itself, `''` is "none"), built on the existing totals buckets and a shared date-range
  predicate that `summarize` now also uses. `itemSpend(record, model)` returns `itemUsage` or, for an item with no
  `agent.runs`, the all-zero state with the budget resolved (the pre-run gate needs "$0 spent of $10", not null).
  `roundUsd(n)` rounds to at most four decimals. Tests in `test/usage.test.js`.
- [x] 2. Transcript adapter `tools/transcript.js`: locate a session from a `.jsonl` path or a session id (search
  `$CLAUDE_CONFIG_DIR|~/.claude/projects/*` for every directory whose name starts with the repository's encoded path,
  case-insensitively, because routine runs write to `…--claude-worktrees-<name>`), list `<session>/subagents/agent-*.jsonl`,
  and `aggregateTranscript(files, { since, until, branch })` → per model, one count per distinct `message.id` (largest value
  per token kind if a repeated row differs), `<synthetic>` and usage-less rows skipped, cache writes split into 5m / 1h from
  `usage.cache_creation`, rows trimmed by a filter counted, item ID derived from `workspec/<id>-…` branch names. Fixture
  corpus `test/fixtures/transcripts/` (synthetic): repeated rows per `message.id`, a `<synthetic>` row, a row without usage,
  a malformed line, two branches, a `subagents/` directory with its own model.
- [x] 3. `tools/record-usage.js`: manual mode (`--handle --model` plus optional tokens, `--cost`, `--purpose`, `--ref`,
  `--session`, `--date`, `--source`, `--estimated`) and `--from-transcript` mode (`--no-subagents`, `--since`, `--until`,
  `--branch`, `--item-from-branch`, `--handle` override); `--dry-run` prints the lines exactly as they would be inserted;
  the append goes through `appendRunText`, falling back to a full re-serialize (said on stderr) only when the line-level
  edit is impossible and the record is not lossy; an unknown ID and a duplicate `source`+`session`+`model` exit 1 (the latter
  unless `--force`) before anything is written. Exit codes as in `validate-workspec.js`.
- [x] 4. `tools/usage-report.js`: repository mode (totals + optional `--by`, `--since`, `--until`, `--json`, `--strict` →
  exit 1 when any item is over budget) and item mode (`ID [PATH]`: spent, budget, remaining, over-budget; an EPIC reports
  its roll-up); `--json` shape documented in the header comment and covered by a test.
- [x] 5. Tests in `test/tools.test.js`: both tools as child processes against throwaway repositories — byte-identical manual
  append on a CRLF file with comments and a trailing `agent:` neighbour, creation of `agent`/`runs` on an item without them,
  `updated` unchanged, unknown ID, duplicate refusal and `--force`, the transcript fixture (dedup, synthetic skip,
  subagents, `--no-subagents`, `--branch` → `estimated`, `--item-from-branch`, session-id lookup through
  `CLAUDE_CONFIG_DIR`), flow-style fallback with its stderr note, and the report's text and `--json` shapes with `--strict`.
- [ ] 6. Docs: README "Tracking AI usage" (real commands, one real sample report, replace the "ship with STORY-001002" note),
  README project layout, CLAUDE.md Commands block and module list, `.workspec/context/architecture.md` tools paragraph.
  Full gates; dogfood both tools on this item.

Out of scope, noted for the PR: archived items are not loaded, so they are in no report (same limit as the board); a
`--key value` (space) syntax is not supported because `tools/lib.js` `parseArgs` is `--key=value` only.
