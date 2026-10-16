# STORY-001001 — AI usage: validation, append, roll-up (remaining work)

The derive layer (`toNumber`, `parseAiConfig`, `itemUsage`, `ai.yaml` loading, fixture) already landed. Remaining per the item's decision note:

- [ ] `rollup(model, id)` in `core/usage.js`: item usage plus descendants via `parent`, visited set tolerates cycles. Tests incl. a parent cycle.
- [ ] `summarize(model)` in `core/usage.js`: repository-wide totals (runs, tokens, cost, unpriced flag). Tests.
- [ ] `appendRunText(fileText, run)`: line-level edit (cases: existing runs, agent without runs, no agent, CRLF, front-matter comments, no front matter -> null). Tests.
- [ ] `validateUsage(model)`: errors `invalid-usage`; warnings `unpriced-model`, `over-budget`, `unknown-handle`, `missing-usage`, `duplicate-run`, `early-run`; hooked in `core/model.js` after `validateRepository`, landing on records, `model.loadErrors`, `model.warnings`. Tests for every code; check `tools/lib.js` prints them and the board error badge ignores per-record warnings.
- [ ] Docs: `.workspec/context/architecture.md` and the CLAUDE.md module table list `core/usage.js`.
- [ ] Gates: `node --test`, `node tools/validate-workspec.js .workspec`.
