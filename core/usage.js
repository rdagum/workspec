// core/usage.js
// AI usage and budgets (SPEC.md §18.2, README "Tracking AI usage").
//
// Reads `agent.runs` and `agent.budget_usd` from an item, prices runs from the
// optional config/ai.yaml, and derives an item's cost and budget state. Pure —
// no DOM, no I/O — so the board, the CLI tools and the tests share one
// implementation. Nothing derived here is ever written back to a file.
//
// Layers, top to bottom: configuration (parseAiConfig), per-run and per-item
// derivation (runCost, itemUsage), aggregation (summarize, rollup), the
// line-level append every writer of runs uses (appendRunText) and the
// repository checks with their README codes (usageIssues, validateUsage).

(function (WS) {
'use strict';

const { stringifyYaml } = WS;

const AI_CONFIG_PATH = 'config/ai.yaml';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Token kinds and the run field that carries each. The field names mirror the
 * provider's usage object so a transcript maps one-to-one.
 */
const TOKEN_KINDS = [
  ['input', 'input_tokens'],
  ['output', 'output_tokens'],
  ['cache_read', 'cache_read_tokens'],
  ['cache_write', 'cache_write_tokens'],
  ['cache_write_1h', 'cache_write_1h_tokens'],
];

const TOKEN_LABELS = {
  input: 'in',
  output: 'out',
  cache_read: 'cache read',
  cache_write: 'cache write',
  cache_write_1h: 'cache write 1h',
};

/**
 * Coerce a YAML scalar to a finite number, or null. Decimals reach us as
 * strings ('1.12') because utils/yaml.js only turns integers into numbers.
 */
function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return parseFloat(v);
  return null;
}

function isMapping(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// --- Configuration ---------------------------------------------------------

/**
 * Normalise config/ai.yaml into { pricing, defaults, policy, errors }:
 *   pricing:  { [model]: { input, output, cache_read, cache_write, cache_write_1h } }
 *             in USD per million tokens (list-price equivalents)
 *   defaults: { budgetUsd: { [TYPE]: number | null } }
 *   policy:   { requireUsage: boolean, requireUsageFrom: string | null }
 * Bad entries are reported in `errors` and skipped. `parseAiConfig(null)` is
 * the shape of a repository with no ai.yaml at all.
 */
function parseAiConfig(data) {
  const ai = {
    pricing: {},
    defaults: { budgetUsd: {} },
    policy: { requireUsage: false, requireUsageFrom: null },
    errors: [],
  };
  if (data == null) return ai;
  if (!isMapping(data)) {
    ai.errors.push('ai.yaml must be a mapping.');
    return ai;
  }

  if (data.pricing != null) {
    if (!isMapping(data.pricing)) {
      ai.errors.push('pricing must be a mapping of model to rates.');
    } else {
      for (const [model, rates] of Object.entries(data.pricing)) {
        if (!isMapping(rates)) {
          ai.errors.push(`pricing.${model} must be a mapping of token kind to rate.`);
          continue;
        }
        const entry = {};
        let ok = true;
        for (const [kind] of TOKEN_KINDS) {
          if (rates[kind] == null) continue;
          const n = toNumber(rates[kind]);
          if (n == null || n < 0) {
            ai.errors.push(`pricing.${model}.${kind} must be a non-negative number.`);
            ok = false;
          } else {
            entry[kind] = n;
          }
        }
        // A rate that failed above is already reported; do not report it twice.
        if (ok && (entry.input == null || entry.output == null)) {
          ai.errors.push(`pricing.${model} needs at least input and output rates.`);
          ok = false;
        }
        if (!ok) continue;
        if (entry.cache_read == null) entry.cache_read = 0;
        if (entry.cache_write == null) entry.cache_write = 0;
        // One-hour cache writes cost more than five-minute ones; when a table
        // does not distinguish them, the five-minute rate is the closer guess.
        if (entry.cache_write_1h == null) entry.cache_write_1h = entry.cache_write;
        ai.pricing[String(model)] = entry;
      }
    }
  }

  if (isMapping(data.defaults) && data.defaults.budget_usd != null) {
    const b = data.defaults.budget_usd;
    if (!isMapping(b)) {
      ai.errors.push('defaults.budget_usd must be a mapping of item type to amount.');
    } else {
      for (const [type, v] of Object.entries(b)) {
        if (v == null) {
          ai.defaults.budgetUsd[String(type).toUpperCase()] = null;
          continue;
        }
        const n = toNumber(v);
        if (n == null || n < 0) ai.errors.push(`defaults.budget_usd.${type} must be a non-negative number or empty.`);
        else ai.defaults.budgetUsd[String(type).toUpperCase()] = n;
      }
    }
  }

  if (isMapping(data.policy)) {
    ai.policy.requireUsage = data.policy.require_usage === true || String(data.policy.require_usage) === 'true';
    if (data.policy.require_usage_from != null) ai.policy.requireUsageFrom = String(data.policy.require_usage_from);
  }
  return ai;
}

// --- Runs --------------------------------------------------------------------

/**
 * The item's runs, or null when the item does not take part in usage tracking
 * (no `agent.runs` sequence). Entries that are not mappings are ignored here;
 * validateUsage (STORY-001001) is where they become errors.
 */
function runsOf(meta) {
  const agent = meta && meta.agent;
  if (!isMapping(agent) || !Array.isArray(agent.runs)) return null;
  return agent.runs.filter(isMapping);
}

/** Tokens by kind for one run; absent, negative or non-numeric fields count as zero. */
function runTokens(run) {
  const tokens = {};
  for (const [kind, field] of TOKEN_KINDS) {
    const n = toNumber(run[field]);
    tokens[kind] = n != null && n >= 0 ? n : 0;
  }
  return tokens;
}

/**
 * Cost of one run in USD: `cost_usd` when recorded, otherwise the run's tokens
 * priced by `pricing[model]`, otherwise null ("unpriced").
 */
function runCost(run, ai) {
  const recorded = toNumber(run.cost_usd);
  if (recorded != null && recorded >= 0) return recorded;
  const pricing = ai && ai.pricing;
  const rates = pricing && run.model != null ? pricing[String(run.model)] : null;
  if (!rates) return null;
  const tokens = runTokens(run);
  let cost = 0;
  for (const [kind] of TOKEN_KINDS) cost += (tokens[kind] * (rates[kind] || 0)) / 1e6;
  return cost;
}

/** The item's budget: `agent.budget_usd`, else the type default from ai.yaml, else null. */
function resolveBudget(meta, ai) {
  const agent = meta && meta.agent;
  if (isMapping(agent) && agent.budget_usd != null) {
    const b = toNumber(agent.budget_usd);
    return b != null && b >= 0 ? b : null;
  }
  const type = String((meta && meta.type) || '').toUpperCase();
  const defaults = ai && ai.defaults && ai.defaults.budgetUsd;
  return defaults && defaults[type] != null ? defaults[type] : null;
}

/**
 * Derived usage for one item, or null when it has no `agent.runs`:
 *   { runs, tokens: {kind: n}, totalTokens, cost, priced, budget, remaining,
 *     overBudget, models: [], handles: [] }
 * `cost` is null (and `priced` false) when any run is unpriced — a partial sum
 * would be misread as the whole.
 */
function itemUsage(record, model) {
  const meta = record && record.meta;
  const ai = model && model.ai;
  const runs = runsOf(meta);
  if (!runs) return null;

  const tokens = {};
  for (const [kind] of TOKEN_KINDS) tokens[kind] = 0;
  let cost = 0;
  let priced = true;
  const models = new Set();
  const handles = new Set();

  for (const run of runs) {
    const t = runTokens(run);
    for (const kind of Object.keys(t)) tokens[kind] += t[kind];
    const c = runCost(run, ai);
    if (c == null) priced = false;
    else cost += c;
    if (run.model != null && run.model !== '') models.add(String(run.model));
    if (run.handle != null && run.handle !== '') handles.add(String(run.handle));
  }

  const totalTokens = Object.values(tokens).reduce((a, b) => a + b, 0);
  const budget = resolveBudget(meta, ai);
  const spent = priced ? cost : null;
  const remaining = budget != null && spent != null ? budget - spent : null;
  return {
    runs: runs.length,
    tokens,
    totalTokens,
    cost: spent,
    priced,
    budget,
    remaining,
    overBudget: budget != null && spent != null && spent > budget,
    models: [...models],
    handles: [...handles],
  };
}

// --- Aggregation ---------------------------------------------------------------

/** An empty bucket of totals; `cost` is a running sum until finishTotals. */
function emptyTotals() {
  const tokens = {};
  for (const [kind] of TOKEN_KINDS) tokens[kind] = 0;
  return { items: 0, runs: 0, tokens, totalTokens: 0, cost: 0, knownCost: 0, priced: true, unpricedRuns: 0 };
}

function addRun(totals, run, cost) {
  totals.runs++;
  const t = runTokens(run);
  for (const kind of Object.keys(t)) {
    totals.tokens[kind] += t[kind];
    totals.totalTokens += t[kind];
  }
  if (cost == null) {
    totals.priced = false;
    totals.unpricedRuns++;
  } else {
    totals.knownCost += cost;
  }
}

/** `cost` becomes null when any run was unpriced, like itemUsage; `knownCost` keeps the priced part. */
function finishTotals(totals) {
  totals.cost = totals.priced ? totals.knownCost : null;
  return totals;
}

function bucket(map, key) {
  const k = key == null || key === '' ? '' : String(key);
  if (!map[k]) map[k] = emptyTotals();
  return map[k];
}

/**
 * Totals over `records` (default: every item in the model):
 *   { items, runs, tokens: {kind: n}, totalTokens, cost, knownCost, priced,
 *     unpricedRuns, byStatus: {status: totals}, byHandle: {handle: totals},
 *     byModel: {model: totals} }
 * `items` counts records that carry `agent.runs`. `cost` is null when any run
 * is unpriced (`knownCost` is the priced part, for "at least" displays).
 * `since` / `until` (YYYY-MM-DD, inclusive) restrict the runs by their date;
 * with either set, a run without a valid date is left out.
 */
function summarize(model, records, { since = null, until = null } = {}) {
  const ai = model && model.ai;
  const list = records ? [...records] : model && model.items ? [...model.items.values()] : [];
  const totals = emptyTotals();
  const byStatus = {};
  const byHandle = {};
  const byModel = {};
  for (const record of list) {
    const runs = runsOf(record && record.meta);
    if (!runs) continue;
    totals.items++;
    const status = bucket(byStatus, record.meta.status);
    status.items++;
    for (const run of runs) {
      if (since != null || until != null) {
        const date = run.date == null ? '' : String(run.date);
        if (!DATE_RE.test(date)) continue;
        if (since != null && date < since) continue;
        if (until != null && date > until) continue;
      }
      const cost = runCost(run, ai);
      addRun(totals, run, cost);
      addRun(status, run, cost);
      addRun(bucket(byHandle, run.handle), run, cost);
      addRun(bucket(byModel, run.model), run, cost);
    }
  }
  for (const map of [byStatus, byHandle, byModel]) for (const t of Object.values(map)) finishTotals(t);
  return Object.assign(finishTotals(totals), { byStatus, byHandle, byModel });
}

/**
 * Roll-up of item `id` (typically an epic): its own runs plus those of every
 * item that reaches it through `parent`, compared with its own resolved
 * budget. Returns null for an unknown ID; otherwise the summarize() shape plus
 * { id, members, budget, remaining, overBudget }, where `members` counts the
 * records in the subtree (the item included). A parent cycle cannot loop: each
 * record is visited once.
 */
function rollup(model, id) {
  const all = model && model.items ? [...model.items.values()] : [];
  const key = String(id);
  const root = all.find((r) => r.meta && r.meta.id != null && String(r.meta.id) === key);
  if (!root) return null;

  const children = new Map();
  for (const record of all) {
    const parent = record.meta && record.meta.parent;
    if (parent == null || parent === '') continue;
    const p = String(parent);
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(record);
  }

  const visited = new Set([root]);
  const queue = [root];
  for (let i = 0; i < queue.length; i++) {
    const ownId = queue[i].meta && queue[i].meta.id;
    for (const child of children.get(String(ownId)) || []) {
      if (visited.has(child)) continue;
      visited.add(child);
      queue.push(child);
    }
  }

  const totals = summarize(model, queue);
  const budget = resolveBudget(root.meta, model.ai);
  const remaining = budget != null && totals.cost != null ? budget - totals.cost : null;
  return Object.assign(totals, {
    id: key,
    members: queue.length,
    budget,
    remaining,
    overBudget: budget != null && totals.cost != null && totals.cost > budget,
  });
}

/** Periods the board's usage view offers, in display order. */
const USAGE_PERIODS = [
  ['all', 'All time'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['month', 'This month'],
];

function isoDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The `{ since, until }` range (YYYY-MM-DD, inclusive, local time) that
 * summarize() takes for a period key: 'all' is unbounded, '7d' / '30d' end
 * today and span that many days, 'month' starts on the 1st. An unknown key
 * counts as 'all'.
 */
function periodRange(period, today = new Date()) {
  const day = (offset) => isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset));
  if (period === '7d') return { since: day(6), until: day(0) };
  if (period === '30d') return { since: day(29), until: day(0) };
  if (period === 'month') return { since: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), until: day(0) };
  return { since: null, until: null };
}

// --- Formatting --------------------------------------------------------------

/** '$1.12'; amounts under a cent show as '<$0.01' rather than '$0.00'. */
function formatUsd(n) {
  if (n == null) return '—';
  if (n > 0 && n < 0.005) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

/** '1.2M', '900k', '123'. */
function formatTokens(n) {
  if (n == null) return '—';
  const trim = (s) => s.replace(/\.0$/, '');
  if (n >= 1e6) return `${trim((n / 1e6).toFixed(1))}M`;
  if (n >= 1e3) return `${trim((n / 1e3).toFixed(1))}k`;
  return String(n);
}

/** One-line-per-fact summary of an item's usage, for tooltips and text output. */
function usageSummaryLines(usage) {
  if (!usage) return [];
  const lines = [`AI usage: ${usage.runs} run${usage.runs === 1 ? '' : 's'}`];
  if (usage.priced) lines.push(`Cost: ${formatUsd(usage.cost)} (list-price equivalent)`);
  else lines.push('Cost: unpriced (no pricing for one or more models)');
  if (usage.budget != null) {
    if (usage.overBudget) lines.push(`Budget: ${formatUsd(usage.budget)} — over by ${formatUsd(usage.cost - usage.budget)}`);
    else if (usage.remaining != null) lines.push(`Budget: ${formatUsd(usage.budget)} — ${formatUsd(usage.remaining)} remaining`);
    else lines.push(`Budget: ${formatUsd(usage.budget)}`);
  }
  const parts = TOKEN_KINDS.filter(([kind]) => usage.tokens[kind] > 0).map(
    ([kind]) => `${TOKEN_LABELS[kind]} ${formatTokens(usage.tokens[kind])}`
  );
  lines.push(`Tokens: ${parts.length ? parts.join(' · ') : 'none recorded'}`);
  if (usage.models.length) lines.push(`Models: ${usage.models.join(', ')}`);
  if (usage.handles.length) lines.push(`By: ${usage.handles.join(', ')}`);
  return lines;
}

// --- Appending a run -----------------------------------------------------------

/** Index of the closing front-matter fence in `lines` (which keep their `\r`), or -1. */
function closingFence(lines) {
  if (!lines.length || !/^﻿?---[ \t]*\r?$/.test(lines[0])) return -1;
  for (let i = 1; i < lines.length; i++) if (/^---[ \t]*\r?$/.test(lines[i])) return i;
  return -1;
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function isBlankOrComment(line) {
  const t = line.trim();
  return t === '' || t.startsWith('#');
}

// Values that let a key take block content under it. A trailing
// `# comment` after a value is not one of them: utils/yaml.js reads it as part
// of the scalar, so `agent: # note` already holds a (string) value.
const EMPTY_VALUES = ['', '~', 'null'];

/**
 * Append `run` to the item text as a line-level edit (SPEC.md §18.2, §15):
 * every existing line stays byte-identical and the new lines use the file's
 * line ending. The run goes after the last existing run; under an `agent`
 * mapping without `runs`, a `runs:` key is added at the end of the mapping;
 * without `agent`, `agent:` and `runs:` are added just before the closing
 * fence. An empty placeholder value (`agent: {}`, `runs: []`, `~`, `null`) is
 * the one existing line that changes, to the bare `key:` that can hold the
 * block. Returns null when the front matter cannot be located, or when
 * `agent` / `runs` hold a value a line-level edit cannot extend (a scalar, or
 * a non-empty flow collection).
 */
function appendRunText(fileText, run) {
  if (fileText == null || !isMapping(run)) return null;
  const lines = String(fileText).split('\n');
  const end = closingFence(lines);
  if (end === -1) return null;
  const cr = lines[0].endsWith('\r') ? '\r' : '';
  const bare = (l) => (l.endsWith('\r') ? l.slice(0, -1) : l);
  const block = (indent) =>
    stringifyYaml([run])
      .split('\n')
      .map((l) => (l === '' ? cr : ' '.repeat(indent) + l + cr));
  // Make line i a bare `key:` that can take block content: true when it
  // already is or was an empty placeholder (then rewritten), false when it
  // holds a real value.
  const opened = (i, emptyFlow) => {
    const m = bare(lines[i]).match(/^(\s*[A-Za-z_][\w-]*\s*:)(.*)$/);
    const value = m[2].trim();
    if (value === '') return true;
    if (!EMPTY_VALUES.includes(value) && value !== emptyFlow) return false;
    lines[i] = m[1] + cr;
    return true;
  };

  const agentIdx = lines.findIndex((l, i) => i > 0 && i < end && /^agent\s*:/.test(l));
  if (agentIdx === -1) {
    lines.splice(end, 0, 'agent:' + cr, '  runs:' + cr, ...block(4));
    return lines.join('\n');
  }
  if (!opened(agentIdx, '{}')) return null;

  // Extent of the agent mapping: indented lines up to the next top-level key.
  // Blank lines and comments are skipped so the insertion lands after the
  // last line that belongs to the mapping, not after trailing spacing.
  let lastContent = agentIdx;
  let childIndent = null;
  for (let j = agentIdx + 1; j < end; j++) {
    const l = bare(lines[j]);
    if (isBlankOrComment(l)) continue;
    if (!/^\s/.test(l)) break;
    if (childIndent === null) childIndent = indentOf(l);
    lastContent = j;
  }
  if (childIndent === null) childIndent = 2;
  const pad = ' '.repeat(childIndent);

  let runsIdx = -1;
  for (let j = agentIdx + 1; j <= lastContent; j++) {
    const l = bare(lines[j]);
    if (indentOf(l) === childIndent && /^\s*runs\s*:/.test(l)) {
      runsIdx = j;
      break;
    }
  }
  if (runsIdx === -1) {
    lines.splice(lastContent + 1, 0, `${pad}runs:` + cr, ...block(childIndent + 2));
    return lines.join('\n');
  }
  if (!opened(runsIdx, '[]')) return null;

  // Extent of the runs sequence: the lines indented deeper than `runs:`. The
  // first dash fixes the item indent. Dashes at the key's own indent (YAML's
  // compact form) are not read as a sequence by utils/yaml.js, so such a
  // file is refused rather than extended; the validator reports its runs.
  let lastRun = runsIdx;
  let dashIndent = null;
  for (let j = runsIdx + 1; j <= lastContent; j++) {
    const l = bare(lines[j]);
    if (isBlankOrComment(l)) continue;
    const ind = indentOf(l);
    const isDash = /^-(\s|$)/.test(l.slice(ind));
    if (ind === childIndent && isDash) return null;
    if (ind <= childIndent) break;
    if (dashIndent === null && isDash) dashIndent = ind;
    lastRun = j;
  }
  if (dashIndent === null) dashIndent = childIndent + 2;
  lines.splice(lastRun + 1, 0, ...block(dashIndent));
  return lines.join('\n');
}

// --- Validation ------------------------------------------------------------------

const RUN_NUMBER_FIELDS = [...TOKEN_KINDS.map(([, field]) => field), 'cost_usd'];

/** A YAML value that is present for validation purposes. */
function present(v) {
  return v != null && v !== '';
}

/**
 * The AI-usage problems of one item, as [{ level, code, message }] with the
 * codes of README "Tracking AI usage":
 *   errors    invalid-usage
 *   warnings  unpriced-model, over-budget, unknown-handle, missing-usage,
 *             duplicate-run, early-run
 * `model` supplies ai (pricing, defaults, policy), users and workflow. Every
 * key under `agent` other than budget_usd and runs is ignored. `agent:` left
 * empty is treated as absent; `runs:` left empty is not a list and is an error
 * (write `runs: []` to say "no runs").
 */
function usageIssues(record, model) {
  const issues = [];
  const meta = record && record.meta;
  const ai = (model && model.ai) || parseAiConfig(null);
  if (!isMapping(meta)) return issues;
  if (!('agent' in meta) && !ai.policy.requireUsage) return issues;
  const error = (message) => issues.push({ level: 'error', code: 'invalid-usage', message });
  const warn = (code, message) => issues.push({ level: 'warning', code, message });
  const agent = meta.agent;

  if (agent != null && !isMapping(agent)) {
    error('agent must be a mapping (SPEC.md §18.2).');
    return issues;
  }

  // Policy: an agent-assigned item that has reached the configured column must say what it cost.
  if (ai.policy.requireUsage && !(isMapping(agent) && 'runs' in agent)) {
    const workflow = (model && model.workflow) || [];
    const assignee = meta.assignee == null ? '' : String(meta.assignee);
    const user = ((model && model.users) || []).find((u) => u.handle === assignee);
    const statusIdx = workflow.indexOf(meta.status);
    const fromIdx = requireUsageIndex(model);
    if (user && user.kind === 'agent' && statusIdx !== -1 && fromIdx !== -1 && statusIdx >= fromIdx) {
      warn(
        'missing-usage',
        `${assignee} is an agent and the item is ${meta.status}, but it has no agent.runs; record the runs, or write runs: [] if it was finished by hand.`
      );
    }
  }
  if (!isMapping(agent)) return issues;

  if (present(agent.budget_usd)) {
    const b = toNumber(agent.budget_usd);
    if (b == null || b < 0) error(`agent.budget_usd must be a non-negative number, got "${agent.budget_usd}".`);
  }
  if (!('runs' in agent)) return issues;
  if (!Array.isArray(agent.runs)) {
    error('agent.runs must be a list of runs (use runs: [] for none).');
    return issues;
  }

  const handles = new Set(((model && model.users) || []).map((u) => u.handle));
  const pricing = ai.pricing || {};
  const priced = Object.keys(pricing).length > 0;
  const created = typeof meta.created === 'string' && DATE_RE.test(meta.created) ? meta.created : null;
  const unpricedModels = new Set();
  const unknownHandles = new Set();
  const sessions = new Map();

  agent.runs.forEach((run, i) => {
    const where = `agent.runs[${i}]`;
    if (!isMapping(run)) {
      error(`${where} must be a mapping with date, handle and model.`);
      return;
    }
    const missing = ['date', 'handle', 'model'].filter((k) => !present(run[k]));
    if (missing.length) error(`${where} is missing ${missing.join(', ')}.`);
    if (present(run.date) && !DATE_RE.test(String(run.date))) {
      error(`${where}.date must be a YYYY-MM-DD date, got "${run.date}".`);
    }
    for (const field of RUN_NUMBER_FIELDS) {
      if (!present(run[field])) continue;
      const n = toNumber(run[field]);
      if (n == null || n < 0) error(`${where}.${field} must be a non-negative number, got "${run[field]}".`);
    }

    const runModel = present(run.model) ? String(run.model) : null;
    if (priced && runModel && !pricing[runModel] && !unpricedModels.has(runModel)) {
      unpricedModels.add(runModel);
      warn('unpriced-model', `Model "${runModel}" has no pricing in ${AI_CONFIG_PATH}; runs on it without cost_usd are unpriced.`);
    }
    const handle = present(run.handle) ? String(run.handle) : null;
    if (handle && handles.size && !handles.has(handle) && !unknownHandles.has(handle)) {
      unknownHandles.add(handle);
      warn('unknown-handle', `${where}.handle "${handle}" is not in config/users.yaml.`);
    }
    if (present(run.session)) {
      const key = [run.source, run.session, run.model].map((v) => (v == null ? '' : String(v))).join('\u0000');
      if (sessions.has(key)) {
        warn(
          'duplicate-run',
          `${where} repeats agent.runs[${sessions.get(key)}] (same source, session and model); one session was recorded twice.`
        );
      } else {
        sessions.set(key, i);
      }
    }
    if (created && present(run.date) && DATE_RE.test(String(run.date)) && String(run.date) < created) {
      warn('early-run', `${where} is dated ${run.date}, before the item was created on ${created}.`);
    }
  });

  const usage = itemUsage(record, model);
  if (usage && usage.overBudget) {
    warn('over-budget', `Over budget: spent ${formatUsd(usage.cost)} of ${formatUsd(usage.budget)} (list-price equivalent).`);
  }
  return issues;
}

/** Workflow index from which policy.require_usage applies: require_usage_from, else the last column. */
function requireUsageIndex(model) {
  const workflow = (model && model.workflow) || [];
  const from = model && model.ai && model.ai.policy.requireUsageFrom;
  const idx = from != null ? workflow.indexOf(from) : -1;
  return idx !== -1 ? idx : workflow.length - 1;
}

/**
 * Run usageIssues over every item, the way validateRepository runs the ID
 * checks: errors go onto `record.errors` and `model.loadErrors`
 * ({ file, message, code }), warnings onto `record.warnings`, where the
 * validator prints them with the item's path. Per-item warnings are not copied
 * into `model.warnings`: that list holds file-less repository notices, and a
 * second copy there would print every warning twice. The one repository-level
 * notice — a require_usage_from that names no workflow column — does go there.
 * Returns { errors, warnings }, both as [{ file, message, code }].
 */
function validateUsage(model) {
  const errors = [];
  const warnings = [];
  const ai = model.ai || parseAiConfig(null);
  const from = ai.policy.requireUsageFrom;
  if (ai.policy.requireUsage && from != null && !(model.workflow || []).includes(from)) {
    const last = (model.workflow || [])[(model.workflow || []).length - 1];
    model.warnings.push(
      `${AI_CONFIG_PATH}: policy.require_usage_from "${from}" is not a workflow column; using the last column${last ? ` (${last})` : ''}.`
    );
  }
  for (const record of model.items.values()) {
    for (const issue of usageIssues(record, model)) {
      const entry = { file: record.path, message: issue.message, code: issue.code };
      if (issue.level === 'error') {
        record.errors.push(issue.message);
        errors.push(entry);
      } else {
        record.warnings.push(issue.message);
        warnings.push(entry);
      }
    }
  }
  model.loadErrors.push(...errors);
  return { errors, warnings };
}

Object.assign(WS, {
  AI_CONFIG_PATH,
  TOKEN_KINDS,
  toNumber,
  parseAiConfig,
  runsOf,
  runTokens,
  runCost,
  resolveBudget,
  itemUsage,
  summarize,
  rollup,
  USAGE_PERIODS,
  periodRange,
  formatUsd,
  formatTokens,
  usageSummaryLines,
  appendRunText,
  usageIssues,
  validateUsage,
});
})(window.WS = window.WS || {});
