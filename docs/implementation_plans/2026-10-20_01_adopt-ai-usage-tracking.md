# STORY-001004 — Adopt AI usage tracking in this repository and the daily routine

Source: `.workspec/items/STORY-001004.md`, `SPEC.md` §18.2, `SKILL.md` "AI Usage and Budgets", README "Tracking AI usage".
Depends on STORY-001002 (in Review, merged into `main`): `tools/record-usage.js` and `tools/usage-report.js` exist.
Gates (this repo, per CLAUDE.md and CI): `node --test`, `node tools/validate-workspec.js .workspec`, plus
`bash .claude/skills/workspec-daily-work/scripts/test_select_item.sh` for the selector change.

## Where things stand on 2026-10-20

Part of the story has already landed outside a run, so the plan covers only what is left:

- `.workspec/config/ai.yaml` is committed with pricing dated 2026-10-15 and per-type budgets. Re-checked today against
  the `claude-api` skill's price list (cached 2026-10-06): every rate for `claude-fable-5-1`, `claude-fable-5`,
  `claude-opus-5-5`, `claude-opus-5`, `claude-sonnet-5-5` and `claude-sonnet-5` matches, including Fable 5.1's $0.25 and
  Fable 5's $1 cache read and Opus 5.5's $5 / $8 cache writes. The prices are left alone. Only `policy` is still
  `require_usage: false`.
- The routine skill is no longer personal: it lives in this repository as `.claude/skills/workspec-daily-work/`, with a
  post-run recording step (`scripts/record_usage.py`, Step 6) that runs inside the session. So the change the item body
  says "the user applies" can be made here.
- The 2026-09-04 transcripts are gone: the oldest one under `~/.claude/projects/c--Users-rdagum-Code-workspec/` starts
  2026-09-29.
- `.claude/skills/workspec-project-gates/SKILL.md` was replaced by another project's ("Matchday") text in 2012a11
  "Update workspec skills". It has to describe this repository again before it can document the usage steps.

## Decisions

- **Backfill** (user's choice): `agent.runs: []` plus a one-sentence note in the body of STORY-000003, BUG-000001 and
  STORY-000009, not estimated runs. No invented numbers, and `runs: []` is what `SPEC.md` §18.2 calls "finished without
  recorded usage". `updated` is not bumped, as for any run append.
- **Over-budget Done items** (user's choice): STORY-000001 ($19.87 of $10) and STORY-000002 ($11.14 of $10) keep their
  warnings. They are real overruns, which is what the warning exists for. The definition-of-done bullet is met for the
  configuration warnings (unpriced model, missing usage) and deliberately not for these two.
- **Open question 1, how the post-run record happens:** neither a `SessionEnd` hook nor "the next run records the
  previous one". The routine records from its own transcript inside the session, as the last commit after the PR URL is
  known, so the run record rides on the item's branch and is reviewed with it. A run cannot see its own final totals,
  but the transcript on disk already holds every completed turn, and the turns that follow are only a push and a status
  commit. A hook would have to commit to a branch after the PR is open; a day-late record would land on whatever branch
  the next run is on. The design document the item refers to is not in this repository, so the decision is written down
  here and in the gates skill.
- **Which recorder:** when the repository ships `tools/record-usage.js` (this one does), the routine uses it, because it
  splits cache writes into the 5-minute and 1-hour kinds and refuses a duplicate session. Everywhere else it keeps
  `record_usage.py`, which books every cache write at the 5-minute rate. That under-costing goes in a new Backlog bug,
  not this story.
- **Model names:** `users.yaml` names the models the agents run today (`claude-fable-5-1`, `claude-opus-5-5`,
  `claude-sonnet-5-5`), not the `claude-opus-5` / `claude-sonnet-5` written when the item was groomed. The recorded
  runs on STORY-000001/000002 confirm it.

## Steps

- [ ] 1. Configuration: `ai.yaml` `policy: { require_usage: true, require_usage_from: Review }`; `users.yaml` gives
  Fable, Opus and Sonnet `kind: agent` and their `model`. Check: the validator reports no `missing-usage` warning, since
  every agent-assigned item in Review or Done carries runs.
- [ ] 2. Backfill: `agent:` / `runs: []` before `spec_version` in STORY-000003, BUG-000001 and STORY-000009, and a note
  in each body. Check: `usage-report.js` reports each item with `runs: 0`, and the round-trip tests still pass.
- [ ] 3. Gates skill: restore the WorkSpec text from 2012a11^ in its own commit, then add an "AI usage" section: the
  pre-run budget check (`node tools/usage-report.js <ID> --json`, stop when `remaining <= 0`) and the post-run record
  (`node tools/record-usage.js <ID> --from-transcript=<session> --ref=<PR>`, subagents included by default), with the
  open-question decision above. Refresh the "currently reports" counts.
- [ ] 4. Selector budget gate: `select_item.sh` skips a candidate whose `tools/usage-report.js <ID> --json` reports
  `remaining` at or below zero, reason `over budget ($spent of $budget)`, reading the `.workspec` of
  `origin/<integration>` (exported to a temp directory) the same way the selector reads statuses. Without
  `tools/usage-report.js` or `node`, the gate is skipped. Tests in `test_select_item.sh`: over budget is skipped, under
  budget is picked, no tool means no gate.
- [ ] 5. Routine text (`workspec-daily-work/SKILL.md`): the selector bullet and report line for "over budget"; a hard rule
  never to start an item whose budget is spent, with the `[over budget]` draft PR for an item named directly rather than
  picked by the selector; Step 6 records with `tools/record-usage.js` when the repository ships it and
  `record_usage.py` otherwise; "When the run cannot finish" records usage too, before the draft PR.
- [ ] 6. Backlog: file a bug in the Opus block for `record_usage.py`'s cache-write pricing.
- [ ] 7. This run's own record via `tools/record-usage.js` on STORY-001004. That covers the definition-of-done check that
  a routine run's branch carries its run and `usage-report.js` shows it.
