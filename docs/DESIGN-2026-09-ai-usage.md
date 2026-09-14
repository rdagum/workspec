# WorkSpec — AI Usage and Budgets: Design

**Written:** 2026-09-09
**Status:** accepted design; normative text in `SPEC.md` §18.2, agent rules in `SKILL.md` "AI Usage and Budgets", implementation tracked by STORY-001001 … STORY-001004
**Scope:** how a WorkSpec repository records what AI agents consume per work item, how implementations derive cost and budget state from those records, and how agents behave when a budget runs out.

---

## Summary

WorkSpec is AI-first: items in this repository are assigned to `Fable`, `Opus` and `Sonnet`, each owns an ID block, and a daily routine takes an item from `Ready` to a pull request unattended. Nothing records what that costs. A run writes back `status`, `updated`, `context` and `affected_paths`; the tokens, the model and the money evaporate with the session.

Git cannot reconstruct any of it. Git records *who changed what*; it does not record *what it cost to produce the change*. That makes AI usage **data, not history**, and the place for data about a work item is the work item.

The design has three layers:

1. **Record.** Each agent session appends one *run* — tokens by kind, model, handle, date — to the item's front matter under the reserved `agent:` namespace. Runs are facts and are append-only.
2. **Derive.** Implementations compute cost, totals, roll-ups and budget state from the runs and an optional pricing table in `config/ai.yaml`. Nothing derived is ever written back.
3. **Enforce.** Budgets are optional. Tooling *warns* when an item is over budget; agents *stop* before starting an item whose budget is spent. CI does not fail on budget: that is a working rule for agents, not a property of the repository.

Everything below fits the existing invariants: one item = one file, unknown fields survive, only the edited file is rewritten, line-level edits where the project already uses them, no dependency, no build step, and the browser app, the CLI tools and the tests share one code path.

---

## 1. The problem, precisely

- **Cost is invisible.** A routine run on this repository orchestrates with one model and delegates implementation to another. Nobody can say afterwards what an item cost, which model did the work, or whether a small bug is quietly consuming more than a large feature.
- **Cost is not recoverable later.** Claude Code writes per-message usage into session transcripts under `~/.claude/projects/`, but those files are pruned after a retention period and live on one machine. If a run does not record its usage while the transcript exists, the number is gone.
- **Budgets have no home.** There is no place to say "this item is worth at most ten dollars of agent time", so there is nothing an unattended run can check before it starts, and nothing that makes an item's cost visible on the board.
- **Constraints.** `SPEC.md` G1/G4/G6 (repository-native, portable, tool-independent, no particular AI model); §15 "avoid unnecessary formatting changes"; G5 minimize merge conflicts; `SKILL.md` and `CLAUDE.md` forbid changelog or history metadata inside items; `PROMPT.md` §15 forbids git integration in the app. `SPEC.md` §1.2 lists time tracking and velocity as non-goals — this design records the resource consumption of automated agents, not human time, and says so in the spec.

---

## 2. Options considered

| Option | Survives Git? | Conflict-safe? | Spec-compatible? | Drawbacks |
|---|---|---|---|---|
| **Runs in the item's `agent:` namespace** | **Yes** | **Yes** (append at one point; keep both on conflict) | **Yes** (§18 reserved namespace) | Front matter grows with runs; a line-level append is required to avoid rewriting the file. |
| One repository ledger (`usage/ledger.yaml`) | Yes | **No** — every branch appends to the same file | Yes | The central-counter mistake `docs/REVIEW-2026-09.md` §3.2 already rejected: every parallel run conflicts on the ledger. |
| One ledger file per item (`usage/<ID>.yaml`) | Yes | Yes | Yes | Doubles the file count, new load and validation paths, breaks "one item = one file"; the archive and renumber tools must learn a second file. |
| Commit trailers (`AI-Cost:`) or git notes | Partly | Yes | No (the board cannot read them; PROMPT §15) | Lost on squash; not portable with the `.workspec` directory (G4); notes are not pushed by default. |
| Cost-only recording (`cost_usd` per item) | Yes | Yes | Yes | Subscription users have no marginal cost and would record zero; tokens are the leading indicator and the price list changes. |
| Stored totals on the item | Yes | No (two branches both update the total) | Yes | Derived data drifts from its inputs; the model can compute totals in one pass. |
| External tool only (no spec change) | — | — | Yes | Nothing on the board, nothing for an agent to check, and it dies with the transcript. |

---

## 3. Recommendation: record, derive, enforce

### 3.1 Layer 1 — Record: `agent.runs` in the item

```yaml
agent:
  budget_usd: 10                  # optional; else config/ai.yaml defaults.budget_usd[TYPE]; null = no budget
  runs:                           # append-only facts; never edited or removed
    - date: 2026-09-09
      handle: Fable               # users.yaml handle; a human running an agent by hand records their own
      model: claude-fable-5-1
      input_tokens: 2
      output_tokens: 8000
      cache_read_tokens: 900000
      cache_write_tokens: 40000   # 5-minute cache writes
      cache_write_1h_tokens: 12000  # optional; 1-hour cache writes are priced differently
      cost_usd: 1.12              # optional: as reported by the tool; otherwise derived
      purpose: implement          # optional: plan | implement | review | feedback | triage
      ref: https://github.com/rdagum/workspec/pull/12   # optional: PR, commit sha, plan path
      session: c08bb153-da05-4380-a295-7b0fd56f92c5      # optional: the tool's session id
      source: claude-code         # optional: manual | the tool that produced the numbers
      estimated: true             # optional: the numbers are approximate or were trimmed
```

Rules:

- **Required per run:** `date` (`YYYY-MM-DD`), `handle`, `model`. Everything else is optional; a hand-recorded run may know only `cost_usd`.
- **Token fields** absent mean 0; present must be non-negative integers. The names mirror the provider's usage object (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`) so a transcript maps one-to-one and a run is readable without a legend. `cache_write_1h_tokens` exists because one-hour cache writes are priced on a different multiplier from five-minute ones and transcripts distinguish them.
- **`cost_usd` and `budget_usd`** are non-negative decimals. The YAML engine keeps decimals as strings (`utils/yaml.js` `parseScalar`), which is exactly right: `1.12` round-trips as written. When a tool writes a cost it writes at most four decimals with trailing zeros trimmed.
- **`session`** is the producing tool's session identifier. It makes imports idempotent: a second import of the same session is refused, and the validator warns on duplicates.
- **`estimated`** marks numbers that were approximated by hand or trimmed by a filter (`--since`, `--branch`).
- **Only `budget_usd` and `runs` are defined** under `agent:`. Every other key there is preserved and ignored, as §18 already requires; the fixture `test/fixtures/items/nested-namespaces.md` stores `agent.status`, `agent.model` and `agent.history` and stays valid.
- **Unknown keys inside a run** are preserved and ignored, the same rule as everywhere else.
- **No `duration_s`.** Wall clock is not resource consumption (a run idles while a subagent works), and a per-run duration would drift into the §1.2 "time tracking" non-goal.
- **Appending a run does not bump `updated`.** A run is a fact insert, not a state change, and two branches that each bump `updated` conflict on that line.
- **Runs are never edited or removed.** A mistaken run is corrected in a dedicated commit whose message says why; that is the only time a run changes. This is the one per-run record an item may hold; `SKILL.md` "Git Philosophy" carries the carve-out.

**Why the item, not a ledger.** The unit that consumes budget is the item; the unit that merges is the file; the unit an agent reads before starting is the item. Putting the runs anywhere else means a second file to load, validate, archive and renumber, and (for a shared ledger) a conflict on every parallel run.

### 3.2 Configuration

`.workspec/config/ai.yaml` — optional, committed:

```yaml
# Prices are list-price equivalents per million tokens.
# Filled YYYY-MM-DD from the published price list; re-check when models change.
pricing:
  claude-fable-5-1: { input: …, output: …, cache_read: …, cache_write: …, cache_write_1h: … }
  claude-opus-5:    { input: …, output: …, cache_read: …, cache_write: …, cache_write_1h: … }
  claude-sonnet-5:  { input: …, output: …, cache_read: …, cache_write: …, cache_write_1h: … }
defaults:
  budget_usd: { STORY: 10, BUG: 5, TASK: 3, SPIKE: 5 }   # EPIC absent: an epic rolls up its children
policy:
  require_usage: true        # agent-assigned item without a `runs` key -> warning …
  require_usage_from: Review # … once it reaches this workflow column or a later one (default: the last column)
```

- No `currency` key: the `_usd` suffix on the field names is the unit. A second currency would be a new key pair, not a switch.
- Prices are never hard-coded in code or in this document; they are filled at adoption from the live price list and dated in a comment.
- `require_usage` is satisfied by the *presence* of `agent.runs`, even empty. `runs: []` is the explicit way to say "this agent-assigned item was finished by hand".

`.workspec/config/users.yaml` gains an optional `kind` (and `model`) per entry:

```yaml
users:
  - name: Rodolfo Dagum
    handle: rdagum
  - name: Fable Agent
    handle: Fable
    kind: agent
    model: claude-fable-5-1
```

`kind: agent` is what `require_usage` and the roll-ups use to tell agents from humans; without it the model would have to duplicate the routine's shell heuristic ("assignee names a model").

### 3.3 Layer 2 — Derive

**Cost of a run.** `cost_usd` if present; else `Σ tokens × pricing[model][kind] ÷ 1 000 000`; else `null` ("unpriced"). A derived cost is a **list-price equivalent**. Subscription users are not billed per token; the number is still the right signal for size and trend, and it is what every usage tool reports.

**Item usage.** Runs count, tokens by kind, cost (`null` if any run is unpriced — a partial sum would be misread), resolved budget, remaining.

**Budget resolution.** `agent.budget_usd` → `defaults.budget_usd[TYPE]` (type upper-cased) → none. `null` at either level means "no budget".

**Epic roll-up.** Descendants through `parent`, cycle-guarded (nothing validates parent cycles today). An epic's roll-up is informational unless the epic has its own `budget_usd`, in which case the roll-up is what the budget is compared against.

**Repository roll-ups.** By status, handle, model, type, label and period (from run dates). Archived items are not loaded by `loadRepository` today, so archived spend is not in the roll-ups; `usage-report --include-archive` is a follow-up tied to STORY-000012.

**Validation** — a new pure module `core/usage.js` exposes `validateUsage(model)`, called from `core/model.js` immediately after `validateRepository(model)`; issues use the existing `{ file, message, code }` shape and land on the record and in `model.loadErrors` / `model.warnings`, so `tools/validate-workspec.js` prints them with no change.

| Check | Severity | `code` |
|---|---|---|
| `agent` not a mapping; `runs` not a list; a run not a mapping; a run missing `date`, `handle` or `model`; malformed date; negative or non-numeric token, cost or budget | error | `invalid-usage` |
| model absent from `pricing` (only when `pricing` has at least one entry) | warning | `unpriced-model` |
| item cost exceeds its resolved budget | warning | `over-budget` |
| `handle` not in `users.yaml` | warning | `unknown-handle` |
| `policy.require_usage`, assignee is a `kind: agent` user, status at or after `require_usage_from`, no `runs` key | warning | `missing-usage` |
| two runs with identical `source`, `session` and `model` | warning | `duplicate-run` |
| run `date` before the item's `created` | warning | `early-run` |

Two facts the implementation must respect. Nothing populates per-record warnings today (`validateRepository` pushes strings to `model.warnings`), so these are the first, and the card badge and the editor's validation strip show only errors — the board renders budget state inside its own AI-usage section (§5). And decimals parse as strings, so `core/usage.js` needs a `toNumber` normaliser in the style of `toInt` in `core/allocation.js`; derived values are never written.

CI runs the validator without `--strict`, so `over-budget` and `missing-usage` never fail a pull request. That is deliberate: the hard stop is an agent rule (§3.4), not a repository invariant.

### 3.4 Layer 3 — Enforce: the agent protocol

An agent cannot read its own usage while it runs; the numbers exist only in the transcript on disk, and they are complete only when the session ends. The protocol therefore has a gate before the run and a record after it:

1. **Pre-run gate.** Before starting an item, derive spent versus budget (`node tools/usage-report.js ID --json` and read `remaining`). If the budget is spent, do not start. An unattended run opens a draft pull request titled `[over budget] …`, leaves the item where it is, and reports; the routine's item selector treats "over budget" as a skip reason like "blocked".
2. **Post-run record.** After the work and before the pull request is merged, append one run per model from the session transcript (`tools/record-usage.js ID --from-transcript=…`), or by hand with `estimated: true` when no transcript is available. A session that touched several items apportions by branch. Triage that belongs to no item goes on the parent epic with `purpose: triage`.
3. **Never edit or delete a past run.** Two branches that both append to one item conflict at the same insertion point; the resolution is to keep both. Order is irrelevant and validation does not require it.
4. **Size before you spend.** Prefer the cheapest model that can do the job. An item whose expected spend exceeds its type default is split before it starts, not after.

---

## 4. Tooling

All tools are Node, zero dependencies, and load the unchanged browser modules through `test/load.js` with the filesystem adapter in `tools/lib.js`, so they can never disagree with the board about what a file means. Arguments use the `--key=value` form the existing tools use (`parseArgs` in `tools/lib.js` accepts nothing else).

### 4.1 `tools/record-usage.js` — append one run

```
node tools/record-usage.js STORY-001001 --handle=Fable --model=claude-fable-5-1 \
  --input=2 --output=8000 --cache-read=900000 --cache-write=40000 [--cache-write-1h=12000] \
  [--cost=1.12] [--purpose=implement] [--ref=URL] [--session=ID] [--date=YYYY-MM-DD] \
  [--source=manual] [--estimated] [--dry-run] [--force]
```

**The append is a line-level edit, not a re-serialize.** Running `parseItem → serializeItem` over a real backlog item changes lines it did not mean to touch: a quoted title loses its quotes, null keys gain a trailing space, front-matter comments vanish and a flow sequence becomes block form. `SPEC.md` §15 forbids that, and every such line is a merge conflict waiting for the next branch. The project already solves this shape of problem with line-level edits (`appendBlockEntry`, `setLocalKeys`, `patchScalarLine`), so `core/usage.js` gets a pure `appendRunText(fileText, run)`:

- locate the front matter with the same fence logic as `closingFence` in `core/allocation.js`, preserving the file's line ending;
- if a top-level `agent:` mapping holds `runs:`, insert the serialized run after the last line of that sequence;
- if `agent:` exists without `runs:`, add `runs:` as the last key of that mapping;
- if there is no `agent:`, insert `agent:` / `  runs:` / the run immediately before the closing fence;
- return `null` when the front matter cannot be located; the tool then falls back to a full re-serialize and says so on stderr.

Every other line of the file is byte-identical afterwards. `updated` is not touched. A run whose `source`, `session` and `model` already exist on the item is refused unless `--force`.

### 4.2 The Claude Code transcript adapter

```
node tools/record-usage.js STORY-001001 --from-transcript=<session .jsonl | session id> \
  [--branch=workspec/story-001001-…] [--item-from-branch] [--since=ISO] [--until=ISO] [--no-subagents]
```

Tool-specific by design; `SPEC.md` stays neutral. Facts verified on this machine on 2026-09-09, under `~/.claude/projects/<project>/`:

- Assistant rows carry `message.usage.{input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens}`, `message.usage.cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`, `message.model`, `gitBranch` and `cwd`.
- **One API response is logged as several rows** (one per content block) that repeat the same `message.id` and the same usage block — 62 assistant rows but 14 distinct ids in one session. Summing rows over-reports several-fold; the adapter sums **once per distinct `message.id`**.
- **Subagent transcripts are separate files** at `<session-id>/subagents/agent-*.jsonl` beside the parent `<session-id>.jsonl`, each with its own model. In this repository the routine orchestrates with one model and implements with another, so reading only the parent file would lose most of the spend. The adapter walks `subagents/` unless `--no-subagents`.
- Rows with `model: "<synthetic>"` carry no real usage and are skipped.
- `input_tokens` is tiny under prompt caching (single digits per row); displays lead with cost, not input tokens, or readers conclude nothing was used.
- Routine runs with the Worktree toggle write to a different project directory (`…-workspec--claude-worktrees-<name>`). Transcripts are pruned after the tool's retention period, so backfilling has a deadline.
- Rows carry no cost; cost is derived (§3.3).

The adapter appends one run per model with `source: claude-code`, `session` set to the session id, and `estimated: true` when `--since`, `--until` or `--branch` trimmed the rows. `--item-from-branch` derives the item ID from a `workspec/<id>-…` branch name in the rows.

### 4.3 `tools/usage-report.js` — the roll-ups

```
node tools/usage-report.js [PATH] [--by=status|assignee|model|type|label|epic] [--since=DATE] [--json]
node tools/usage-report.js STORY-001001 [--json] [--strict]      # one item: spent, budget, remaining
```

`--json` is stable enough for a shell script to read `remaining` (the pre-run gate). `--strict` exits 1 when the item is over budget. Exit codes follow `validate-workspec.js`: 0 ok, 1 refused or over budget under `--strict`, 2 could not load.

`tools/validate-workspec.js` needs no change; `collectProblems` in `tools/lib.js` already flattens record and model issues.

---

## 5. Reference implementation UI

All arithmetic goes through `core/usage.js`; the views only format.

- **Card** (`ui/board.js`, the `.card-meta` badge row): when the item has at least one run, a cost chip — `$1.12`, or `unpriced` when the cost is `null` — with the `--danger` variant when spent exceeds the resolved budget. Cards without runs are unchanged. `board.yaml` `settings.card_fields` may list `cost`.
- **Column header**: the cost subtotal of the visible cards beside the count.
- **Editor** (`ui/editor.js`): the `agent` key stops rendering as a read-only YAML textarea and becomes an **AI usage** section; any other key under `agent:` keeps today's textarea and its "edit in Raw YAML" note. Raw YAML remains the escape hatch.
- **Sidebar** (`ui/sidebar.js`, under the "N of M shown" count): an **AI usage** section for the filtered items — total cost and tokens, by column and by handle, with a period selector (all / 7 days / 30 days / this month) driven by run dates.
- **Known interaction:** the editor deep-clones `meta` when it binds an item, so a run appended by the CLI while that item is open is overwritten by the next save. That is the change-on-disk problem STORY-000011 owns.

Reference layout for the editor section (the routine's design gate needs one):

```
AI usage                                              ⚠ over budget by $1.40
Budget  [ 10      ] USD   (default for STORY: 10)
Spent   $11.40 of $10.00   ████████████████████░  114 %
Runs
  date        handle  model             in      out     cache r   cache w   cost      ref
  2026-09-09  Fable   claude-fable-5-1  2       8,000   900,000   52,000    $1.12     PR #12
  2026-09-10  Opus    claude-opus-5     14      31,000  2.1M      88,000    $10.28 ~  PR #12
                                                                   ~ estimated
Add run
  date [2026-09-10]  handle [rdagum ▾]  model [claude-sonnet-5]
  input [    ] output [    ] cache read [    ] cache write [    ] cache write 1h [    ]
  cost [    ] purpose [review ▾] ref [                ]          [ Add ]
```

---

## 6. Compatibility and merge behaviour

- `spec_version` in items stays `1.0`. An implementation that ignores `agent:` remains compliant, exactly as with §18.1; a repository without `config/ai.yaml` or without any `agent:` block loads and validates exactly as before.
- Two branches appending runs to the same item conflict at one insertion point. Keep both. The existing conflict-marker check in `core/parser.js` refuses a half-merged file.
- `tools/renumber.js` and the archive flow need no change: runs travel inside the item.
- Round-trip: a fixture `test/fixtures/items/agent-usage.md` with two runs (one with a decimal-string `cost_usd`) must round-trip content-equal, like every other fixture.

---

## 7. Alternatives rejected

- **A shared ledger file.** Every run on every branch appends to one file: the central-counter mistake, one level up.
- **Per-item ledger files.** Doubles the file count and every tool has to learn a second file; the benefit (a smaller front matter) is cosmetic.
- **Commit trailers or git notes.** The board cannot read them (PROMPT §15), they are lost on squash, and notes are not part of the `.workspec` directory (G4).
- **Cost only.** Subscription users have no marginal cost and would record zero; tokens are the fact, price is a parameter.
- **Stored totals.** Derived data drifts; the model computes totals in one pass.
- **Synthetic run ids.** The tool's `session` id is enough for idempotency; inventing identity adds noise to every run.
- **A per-run duration.** Not resource consumption, and adjacent to the time-tracking non-goal.

---

## 8. Open questions

1. **Post-run recording mechanism.** A `SessionEnd` hook (receives the transcript path, but runs after the pull request is opened and must commit to the branch) versus "the next run records the previous one" (simple, but a day late). STORY-001004 decides; either satisfies the protocol.
2. **Archived items** in roll-ups (`--include-archive`), together with STORY-000012.
3. **A second currency.** Not needed today; if it arrives it is a new key pair with its own pricing table, not a switch.

---

## 9. Sequencing

| Item | What lands | Depends on |
|---|---|---|
| STORY-001001 | `core/usage.js` (schema, `toNumber`, cost, roll-ups, `appendRunText`, `validateUsage`), `config/ai.yaml` loading, fixture, tests | — |
| STORY-001002 | `tools/record-usage.js` (manual + transcript adapter), `tools/usage-report.js`, README commands | STORY-001001 |
| STORY-001003 | Card chip, column subtotal, editor section, sidebar totals, demo repository data | STORY-001001 |
| STORY-001004 | This repository's `ai.yaml`, `users.yaml` kinds, backfill from the transcripts still on disk, the routine's gate and record steps | STORY-001002 |

Each step leaves the app shippable; none requires a build step or a dependency.
