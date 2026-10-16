# STORY-001003 — AI usage in the board

Chip and demo data already landed; this plan covers the rest.

- [x] `core/usage.js`: `USAGE_PERIODS`, `periodRange(period, today)` (pure, local dates) — tests in `test/usage-selectors.test.js`
- [x] `state/store.js`: `usagePeriod` state, `setUsagePeriod`, `usageTotals` (summarize over filtered items), `columnUsage` — store-level tests
- [x] `ui/board.js`: column header cost subtotal, same `card_fields` switch as the chip
- [x] `ui/editor.js`: "AI usage" section for `agent` (budget, spent bar, warnings, runs table capped at 20, add-run form); other keys kept
- [x] `ui/sidebar.js`: "AI usage" section with period selector, by column, by handle
- [x] `style.css`, `README.md` ("What you can do")
- [x] `node --test`, validator on `.workspec` and `.workspec-demo`

Decisions: the sidebar totals sum the filtered items directly, so no epic roll-up (and no second parent walk) is needed. Column subtotals ignore the period selector. Items without `agent` get the section too, so a first run can be added from the form.
