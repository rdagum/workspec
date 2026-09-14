// core/usage.js
// AI usage and budgets (SPEC.md §18.2; design: docs/DESIGN-2026-09-ai-usage.md).
//
// Reads `agent.runs` and `agent.budget_usd` from an item, prices runs from the
// optional config/ai.yaml, and derives an item's cost and budget state. Pure —
// no DOM, no I/O — so the board, the CLI tools and the tests share one
// implementation. Nothing derived here is ever written back to a file.
//
// Landed with the card chip (STORY-001003); STORY-001001 adds validateUsage,
// appendRunText and the epic/repository roll-ups on top of these primitives.

(function (WS) {
'use strict';

const AI_CONFIG_PATH = 'config/ai.yaml';

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
  formatUsd,
  formatTokens,
  usageSummaryLines,
});
})(window.WS = window.WS || {});
