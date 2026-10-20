#!/usr/bin/env node
// tools/usage-report.js
//
// Report AI usage (SPEC.md §18.2, README "Tracking AI usage") from the same
// derived values the board shows: repository totals, optionally grouped, or
// one item's spent, budget and remaining — the pre-run budget gate. All
// arithmetic is core/usage.js; this file only parses arguments and prints.
//
//   node tools/usage-report.js [PATH] [--by=DIM] [--since=DATE] [--until=DATE] [--json] [--strict]
//   node tools/usage-report.js ID [PATH] [--json] [--strict]
//
//   PATH      a .workspec directory, or a repository that contains one
//             (default: nearest .workspec at or above the current directory)
//   ID        report one item; an EPIC reports its roll-up (itself and every
//             item that reaches it through parent) against its own budget
//   --by      group the repository totals by status, assignee, model, type,
//             label (an item counts under each of its labels) or epic
//   --since / --until  only runs dated in that range (YYYY-MM-DD, inclusive)
//   --json    one JSON object instead of text (shapes below)
//   --strict  exit 1 when the item, or with no ID any item, is over budget
//
// --json, repository:
//   { "scope": "repository", "since": DATE|null, "until": DATE|null,
//     "totals": TOTALS, "by": DIM|null, "groups": [ { "key", ...TOTALS } ],
//     "overBudget": [ID] }
//   TOTALS = { "items", "runs", "tokens": { "input", "output", "cache_read",
//     "cache_write", "cache_write_1h" }, "totalTokens", "cost", "knownCost",
//     "priced", "unpricedRuns" }
//   `cost` is null when any run is unpriced (`knownCost` is the priced part);
//   `key` "" means none (no assignee, no label, no epic). `groups` is [] without --by.
// --json, item:
//   { "scope": "item"|"rollup", "id", "title", "status", "assignee", "runs",
//     "members" (rollup only), "tokens": {...}, "totalTokens", "spent",
//     "budget", "remaining", "overBudget", "priced", "models", "handles" }
//   `spent` and `remaining` are null when unpriced, `budget` and `remaining`
//   when there is no budget. An item without runs has spent 0. Amounts are
//   rounded to at most four decimals.
//
// Exit codes: 0 ok, 1 refused (unknown ID) or over budget under --strict,
// 2 usage error or could not load.

'use strict';

const fs = require('node:fs');
const { resolveWorkspecDir, loadWorkspec, parseArgs } = require('./lib.js');

const ID_RE = /^[A-Za-z]+-\d{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_LABELS = { input: 'in', output: 'out', cache_read: 'cache read', cache_write: 'cache write', cache_write_1h: 'cache write 1h' };

function usage() {
  return [
    'Usage: node tools/usage-report.js [PATH] [--by=DIM] [--since=DATE] [--until=DATE] [--json] [--strict]',
    '       node tools/usage-report.js ID [PATH] [--json] [--strict]',
    '',
    '  PATH      a .workspec directory or a repository that contains one',
    '            (default: nearest .workspec at or above the current directory)',
    '  ID        one item: spent, budget, remaining (an EPIC: its roll-up)',
    '  --by      group by status, assignee, model, type, label or epic',
    '  --since / --until  only runs dated in that range (YYYY-MM-DD, inclusive)',
    '  --json    print one JSON object',
    '  --strict  exit 1 when over budget (the item, or any item)',
    '',
    'Exit codes: 0 ok, 1 unknown ID or over budget under --strict, 2 usage error or could not load.',
  ].join('\n');
}

class UsageError extends Error {}

function parse(argv) {
  const args = parseArgs(argv, ['by', 'since', 'until', 'json', 'strict', 'help']);
  const o = args.options;
  if (o.help) return { help: true };
  for (const name of ['by', 'since', 'until']) {
    if (o[name] !== undefined && (typeof o[name] !== 'string' || o[name] === '')) throw new UsageError(`--${name} needs a value (--${name}=VALUE).`);
  }
  for (const name of ['json', 'strict']) if (typeof o[name] === 'string') throw new UsageError(`--${name} takes no value.`);
  for (const name of ['since', 'until']) {
    if (o[name] !== undefined && !DATE_RE.test(o[name])) throw new UsageError(`--${name} must be a YYYY-MM-DD date, got "${o[name]}".`);
  }
  const pos = args._;
  let id = null;
  let dir;
  if (pos.length && ID_RE.test(pos[0]) && !fs.existsSync(pos[0])) {
    id = pos[0].toUpperCase();
    if (pos.length > 2) throw new UsageError('Expected ID and at most one PATH.');
    dir = pos[1];
  } else {
    if (pos.length > 1) throw new UsageError('Expected at most one PATH argument.');
    dir = pos[0];
  }
  if (id && o.by !== undefined) throw new UsageError('--by applies to the repository report, not to one item.');
  if (id && (o.since !== undefined || o.until !== undefined)) {
    throw new UsageError('--since and --until apply to the repository report; an item\'s budget covers all of its runs.');
  }
  return { id, dir, by: o.by || null, since: o.since || null, until: o.until || null, json: !!o.json, strict: !!o.strict };
}

// --- Formatting ------------------------------------------------------------------

/** 'in 35 · out 370 · …' over the non-zero kinds, or 'none recorded'. */
function tokenLine(WS, tokens) {
  const parts = WS.TOKEN_KINDS.filter(([k]) => tokens[k] > 0).map(([k]) => `${TOKEN_LABELS[k]} ${WS.formatTokens(tokens[k])}`);
  return parts.length ? parts.join(' · ') : 'none recorded';
}

/** A totals bucket's cost: the amount, or the known part of an unpriced one. */
function costText(WS, t) {
  if (t.priced) return WS.formatUsd(t.cost);
  return `unpriced (${WS.formatUsd(t.knownCost)} known, ${t.unpricedRuns} unpriced run${t.unpricedRuns === 1 ? '' : 's'})`;
}

/** Signed dollars: '-$1.20' rather than formatUsd's '$-1.20'. */
function signedUsd(WS, n) {
  return n < 0 ? `-${WS.formatUsd(-n)}` : WS.formatUsd(n);
}

function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  // Group names left-aligned, numbers right-aligned.
  return rows.map((r) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ').trimEnd());
}

/** TOTALS for --json: amounts rounded, nothing else. */
function totalsJson(WS, t) {
  return {
    items: t.items,
    runs: t.runs,
    tokens: { ...t.tokens },
    totalTokens: t.totalTokens,
    cost: WS.roundUsd(t.cost),
    knownCost: WS.roundUsd(t.knownCost),
    priced: t.priced,
    unpricedRuns: t.unpricedRuns,
  };
}

// --- Reports -----------------------------------------------------------------------

function repositoryReport(WS, model, opts) {
  const totals = WS.summarize(model, null, { since: opts.since, until: opts.until });
  const groups = opts.by ? WS.summarizeBy(model, opts.by, { since: opts.since, until: opts.until }) : [];
  const over = [];
  for (const record of model.items.values()) {
    const u = WS.itemUsage(record, model);
    if (u && u.overBudget) over.push({ id: String(record.meta.id), cost: u.cost, budget: u.budget });
  }
  over.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (opts.json) {
    const out = {
      scope: 'repository',
      since: opts.since,
      until: opts.until,
      totals: totalsJson(WS, totals),
      by: opts.by,
      groups: groups.map((g) => ({ key: g.key, ...totalsJson(WS, g) })),
      overBudget: over.map((o) => o.id),
    };
    console.log(JSON.stringify(out, null, 2));
  } else {
    const period = opts.since || opts.until ? `, runs dated ${opts.since || '…'} to ${opts.until || '…'}` : '';
    console.log(`AI usage: ${totals.items} item(s) with runs, ${totals.runs} run(s)${period}`);
    console.log(`Cost:    ${costText(WS, totals)}${totals.priced ? ' (list-price equivalent)' : ''}`);
    console.log(`Tokens:  ${tokenLine(WS, totals.tokens)}`);
    if (over.length) console.log(`Over budget: ${over.map((o) => o.id).join(', ')}`);
    if (opts.by) {
      const none = opts.by === 'assignee' ? '(unassigned)' : '(none)';
      const rows = [[opts.by, 'items', 'runs', 'tokens', 'cost']];
      for (const g of groups) {
        const cost = g.priced ? WS.formatUsd(g.cost) : `${WS.formatUsd(g.knownCost)}+ unpriced`;
        rows.push([g.key === '' ? none : g.key, String(g.items), String(g.runs), WS.formatTokens(g.totalTokens), cost]);
      }
      console.log('');
      for (const line of table(rows)) console.log(line);
    }
  }
  if (opts.strict && over.length) {
    for (const o of over) console.error(`over budget  ${o.id}: spent ${WS.formatUsd(o.cost)} of ${WS.formatUsd(o.budget)}`);
    return 1;
  }
  return 0;
}

function itemReport(WS, model, record, opts) {
  const meta = record.meta;
  const id = String(meta.id);
  const epic = WS.isEpic(record);
  const str = (v) => (v == null || v === '' ? null : String(v));
  let u;
  if (epic) {
    const r = WS.rollup(model, id);
    u = {
      runs: r.runs,
      members: r.members,
      tokens: r.tokens,
      totalTokens: r.totalTokens,
      cost: r.cost,
      priced: r.priced,
      budget: r.budget,
      remaining: r.remaining,
      overBudget: r.overBudget,
      models: Object.keys(r.byModel).filter((k) => k !== ''),
      handles: Object.keys(r.byHandle).filter((k) => k !== ''),
    };
  } else {
    u = WS.itemSpend(record, model);
  }

  if (opts.json) {
    const out = { scope: epic ? 'rollup' : 'item', id, title: str(meta.title), status: str(meta.status), assignee: str(meta.assignee), runs: u.runs };
    if (epic) out.members = u.members;
    Object.assign(out, {
      tokens: { ...u.tokens },
      totalTokens: u.totalTokens,
      spent: WS.roundUsd(u.cost),
      budget: u.budget,
      remaining: WS.roundUsd(u.remaining),
      overBudget: u.overBudget,
      priced: u.priced,
      models: u.models,
      handles: u.handles,
    });
    console.log(JSON.stringify(out, null, 2));
  } else {
    const lines = [];
    lines.push(['spent', u.priced ? `${WS.formatUsd(u.cost)} (list-price equivalent)` : 'unpriced (no pricing for one or more models)']);
    lines.push(['budget', u.budget != null ? WS.formatUsd(u.budget) : 'none']);
    let remaining = '—';
    if (u.remaining != null) remaining = signedUsd(WS, u.remaining) + (u.overBudget ? ' (over budget)' : '');
    lines.push(['remaining', remaining]);
    lines.push(['runs', `${u.runs}${u.models.length ? ` (${u.models.join(', ')})` : ''}`]);
    if (epic) lines.push(['members', `${u.members} item(s) in the roll-up`]);
    lines.push(['tokens', tokenLine(WS, u.tokens)]);
    console.log(`${id} — ${str(meta.title) || '(untitled)'} (${str(meta.status) || 'no status'})${epic ? ', roll-up' : ''}`);
    const width = Math.max(...lines.map(([k]) => k.length));
    for (const [k, v] of lines) console.log(`  ${k.padEnd(width)}  ${v}`);
  }
  if (opts.strict && u.overBudget) {
    console.error(`over budget  ${id}: spent ${WS.formatUsd(u.cost)} of ${WS.formatUsd(u.budget)}`);
    return 1;
  }
  return 0;
}

async function main(argv) {
  let opts;
  try {
    opts = parse(argv);
  } catch (err) {
    console.error(`${err.message}\n\n${usage()}`);
    return 2;
  }
  if (opts.help) {
    console.log(usage());
    return 0;
  }

  let WS;
  let model;
  try {
    ({ WS, model } = await loadWorkspec(resolveWorkspecDir(opts.dir)));
  } catch (err) {
    console.error(`error  ${err.message}`);
    return 2;
  }
  if (opts.by && !WS.SUMMARY_DIMENSIONS.includes(opts.by)) {
    console.error(`--by must be one of ${WS.SUMMARY_DIMENSIONS.join(', ')}, got "${opts.by}".\n\n${usage()}`);
    return 2;
  }

  if (!opts.id) return repositoryReport(WS, model, opts);
  const record = [...model.items.values()].find((r) => r.meta && r.meta.id != null && String(r.meta.id) === opts.id);
  if (!record) {
    console.error(`refused  ${opts.id} was not found`);
    return 1;
  }
  return itemReport(WS, model, record, opts);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(2);
  }
);
