// test/usage.test.js — core/usage.js: coercion, ai.yaml normalisation, run
// pricing, per-item usage and budget state, formatting, and loadRepository's
// handling of config/ai.yaml and users.yaml `kind` (SPEC.md §18.2).

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadWS } = require('./load.js');

const WS = loadWS();
const {
  toNumber,
  parseAiConfig,
  runCost,
  resolveBudget,
  itemUsage,
  formatUsd,
  formatTokens,
  usageSummaryLines,
  summarize,
  rollup,
  appendRunText,
  usageIssues,
  validateUsage,
  parseItem,
  loadRepository,
} = WS;

const AI = parseAiConfig({
  pricing: {
    'model-a': { input: 10, output: 50, cache_read: 1, cache_write: '12.5' },
    'model-b': { input: 1, output: 5 },
  },
  defaults: { budget_usd: { story: 10, BUG: '5', EPIC: null } },
  policy: { require_usage: true, require_usage_from: 'Review' },
});

function record(meta) {
  return { path: 'items/X.md', meta, errors: [], warnings: [] };
}

describe('usage: toNumber', () => {
  it('accepts integers, decimal strings and negative numbers', () => {
    assert.equal(toNumber(3), 3);
    assert.equal(toNumber('1.12'), 1.12);
    assert.equal(toNumber(' 7 '), 7);
    assert.equal(toNumber('-2.5'), -2.5);
  });
  it('rejects garbage, empty, booleans, NaN and objects', () => {
    for (const v of ['abc', '', '1e3', true, NaN, Infinity, null, undefined, {}, []]) {
      assert.equal(toNumber(v), null, `toNumber(${JSON.stringify(v)})`);
    }
  });
});

describe('usage: parseAiConfig', () => {
  it('normalises rates, decimal strings, missing cache rates and the 1h fallback', () => {
    assert.equal(AI.errors.length, 0);
    assert.deepEqual(AI.pricing['model-a'], { input: 10, output: 50, cache_read: 1, cache_write: 12.5, cache_write_1h: 12.5 });
    assert.deepEqual(AI.pricing['model-b'], { input: 1, output: 5, cache_read: 0, cache_write: 0, cache_write_1h: 0 });
  });
  it('upper-cases budget types and keeps null as "no budget"', () => {
    assert.deepEqual(AI.defaults.budgetUsd, { STORY: 10, BUG: 5, EPIC: null });
    assert.equal(AI.policy.requireUsage, true);
    assert.equal(AI.policy.requireUsageFrom, 'Review');
  });
  it('reports and skips a model without input/output or with a bad rate', () => {
    const ai = parseAiConfig({ pricing: { half: { input: 1 }, neg: { input: -1, output: 2 }, str: 'nope' } });
    assert.equal(Object.keys(ai.pricing).length, 0);
    assert.equal(ai.errors.length, 3);
  });
  it('yields the empty shape for a missing file and an error for a non-mapping', () => {
    const empty = parseAiConfig(null);
    assert.deepEqual(empty.pricing, {});
    assert.deepEqual(empty.defaults.budgetUsd, {});
    assert.equal(empty.policy.requireUsage, false);
    assert.equal(parseAiConfig('x').errors.length, 1);
  });
});

describe('usage: runCost', () => {
  it('prices tokens from the table, per million', () => {
    const run = { model: 'model-a', input_tokens: 1000000, output_tokens: 100000, cache_read_tokens: 2000000, cache_write_tokens: 400000 };
    // 10 + 5 + 2 + 5
    assert.equal(runCost(run, AI), 22);
  });
  it('prefers a recorded cost_usd, including a decimal string', () => {
    assert.equal(runCost({ model: 'model-a', output_tokens: 1000000, cost_usd: '1.12' }, AI), 1.12);
  });
  it('is null when the model is unpriced or absent', () => {
    assert.equal(runCost({ model: 'unknown', output_tokens: 10 }, AI), null);
    assert.equal(runCost({ output_tokens: 10 }, AI), null);
    assert.equal(runCost({ model: 'model-a', output_tokens: 10 }, parseAiConfig(null)), null);
  });
});

describe('usage: resolveBudget', () => {
  it('takes the item budget first, then the type default, then none', () => {
    assert.equal(resolveBudget({ type: 'STORY', agent: { budget_usd: '7.5' } }, AI), 7.5);
    assert.equal(resolveBudget({ type: 'story' }, AI), 10);
    assert.equal(resolveBudget({ type: 'EPIC' }, AI), null);
    assert.equal(resolveBudget({ type: 'TASK' }, AI), null);
    assert.equal(resolveBudget({ type: 'STORY', agent: { budget_usd: 'lots' } }, AI), null);
  });
});

describe('usage: itemUsage', () => {
  const model = { ai: AI };

  it('is null for an item without agent.runs, and zero runs for runs: []', () => {
    assert.equal(itemUsage(record({ type: 'STORY' }), model), null);
    assert.equal(itemUsage(record({ type: 'STORY', agent: { status: 'idle' } }), model), null);
    assert.equal(itemUsage(record({ type: 'STORY', agent: { runs: 'no' } }), model), null);
    const u = itemUsage(record({ type: 'STORY', agent: { runs: [] } }), model);
    assert.equal(u.runs, 0);
    assert.equal(u.cost, 0);
    assert.equal(u.priced, true);
  });

  it('sums tokens by kind, prices every run and compares to the budget', () => {
    const u = itemUsage(
      record({
        type: 'STORY',
        agent: {
          budget_usd: 5,
          runs: [
            { date: '2026-09-10', handle: 'Fable', model: 'model-a', input_tokens: 100000, output_tokens: 20000, cache_read_tokens: '1000000' },
            { date: '2026-09-11', handle: 'Opus', model: 'model-b', output_tokens: 1000000 },
            'not a mapping',
          ],
        },
      }),
      model
    );
    assert.equal(u.runs, 2);
    assert.deepEqual(u.tokens, { input: 100000, output: 1020000, cache_read: 1000000, cache_write: 0, cache_write_1h: 0 });
    assert.equal(u.totalTokens, 2120000);
    // model-a: 1 + 1 + 1 = 3; model-b: 5
    assert.equal(u.cost, 8);
    assert.equal(u.priced, true);
    assert.equal(u.budget, 5);
    assert.equal(u.remaining, -3);
    assert.equal(u.overBudget, true);
    assert.deepEqual(u.models, ['model-a', 'model-b']);
    assert.deepEqual(u.handles, ['Fable', 'Opus']);
  });

  it('reports an unpriced item as cost null rather than a partial sum', () => {
    const u = itemUsage(
      record({
        type: 'BUG',
        agent: { runs: [{ model: 'model-a', output_tokens: 1000000 }, { model: 'mystery', output_tokens: 5 }] },
      }),
      model
    );
    assert.equal(u.cost, null);
    assert.equal(u.priced, false);
    assert.equal(u.budget, 5);
    assert.equal(u.remaining, null);
    assert.equal(u.overBudget, false);
  });

  it('uses a recorded cost_usd for a run on an unknown model', () => {
    const u = itemUsage(record({ type: 'TASK', agent: { runs: [{ model: 'mystery', cost_usd: '0.42' }] } }), model);
    assert.equal(u.cost, 0.42);
    assert.equal(u.priced, true);
    assert.equal(u.budget, null);
  });

  it('treats negative or non-numeric token fields as zero', () => {
    const u = itemUsage(record({ type: 'TASK', agent: { runs: [{ model: 'model-b', output_tokens: -5, input_tokens: 'x' }] } }), model);
    assert.equal(u.totalTokens, 0);
    assert.equal(u.cost, 0);
  });

  it('works with no ai config at all', () => {
    const u = itemUsage(record({ type: 'STORY', agent: { runs: [{ model: 'model-a', output_tokens: 10 }] } }), {});
    assert.equal(u.cost, null);
    assert.equal(u.budget, null);
  });
});

describe('usage: formatting', () => {
  it('formats dollars and token counts for a chip', () => {
    assert.equal(formatUsd(1.125), '$1.13');
    assert.equal(formatUsd(0), '$0.00');
    assert.equal(formatUsd(0.001), '<$0.01');
    assert.equal(formatUsd(null), '—');
    assert.equal(formatTokens(123), '123');
    assert.equal(formatTokens(900000), '900k');
    assert.equal(formatTokens(1200000), '1.2M');
    assert.equal(formatTokens(2000000), '2M');
  });
  it('summarises usage one fact per line', () => {
    const u = itemUsage(
      record({ type: 'STORY', agent: { budget_usd: 5, runs: [{ handle: 'Fable', model: 'model-b', output_tokens: 1200000 }] } }),
      { ai: AI }
    );
    const lines = usageSummaryLines(u);
    assert.equal(lines[0], 'AI usage: 1 run');
    assert.equal(lines[1], 'Cost: $6.00 (list-price equivalent)');
    assert.equal(lines[2], 'Budget: $5.00 — over by $1.00');
    assert.equal(lines[3], 'Tokens: out 1.2M');
    assert.equal(lines[4], 'Models: model-b');
    assert.equal(lines[5], 'By: Fable');
  });
});

// --- Aggregation ----------------------------------------------------------------

function item(id, extra = {}) {
  return { path: `items/${id}.md`, fileName: `${id}.md`, meta: { id, type: id.split('-')[0], status: 'Backlog', ...extra }, errors: [], warnings: [] };
}

function modelOf(records, rest = {}) {
  return { ai: AI, items: new Map(records.map((r) => [r.path, r])), workflow: ['Backlog', 'Review', 'Done'], users: [], ...rest };
}

const runB = (date, output, extra = {}) => ({ date, handle: 'Fable', model: 'model-b', output_tokens: output, ...extra });

describe('usage: summarize', () => {
  const records = [
    item('STORY-000001', { status: 'Done', agent: { runs: [runB('2026-09-01', 1000000), runB('2026-09-20', 2000000, { handle: 'Opus' })] } }),
    item('STORY-000002', { status: 'Review', agent: { runs: [{ date: '2026-09-15', handle: 'Fable', model: 'model-a', cost_usd: '0.5' }] } }),
    item('STORY-000003', { status: 'Review' }),
  ];
  const model = modelOf(records);

  it('totals runs, tokens and cost over every item, with buckets by status, handle and model', () => {
    const s = summarize(model);
    assert.equal(s.items, 2);
    assert.equal(s.runs, 3);
    assert.equal(s.tokens.output, 3000000);
    assert.equal(s.totalTokens, 3000000);
    assert.equal(s.cost, 15.5);
    assert.equal(s.priced, true);
    assert.equal(s.byStatus.Done.cost, 15);
    assert.equal(s.byStatus.Done.items, 1);
    assert.equal(s.byStatus.Review.cost, 0.5);
    assert.equal(s.byHandle.Fable.runs, 2);
    assert.equal(s.byHandle.Opus.cost, 10);
    assert.equal(s.byModel['model-a'].cost, 0.5);
  });

  it('takes an explicit record list and a date window', () => {
    assert.equal(summarize(model, [records[1]]).cost, 0.5);
    const s = summarize(model, null, { since: '2026-09-10', until: '2026-09-19' });
    assert.equal(s.runs, 1);
    assert.equal(s.cost, 0.5);
    assert.equal(summarize(model, null, { since: '2026-09-02' }).runs, 2);
  });

  it('is unpriced (cost null) when any run is, keeping the priced part in knownCost', () => {
    const extra = item('BUG-000001', { agent: { runs: [{ date: '2026-09-02', handle: 'x', model: 'mystery', output_tokens: 1 }] } });
    const s = summarize(modelOf([...records, extra]));
    assert.equal(s.cost, null);
    assert.equal(s.priced, false);
    assert.equal(s.unpricedRuns, 1);
    assert.equal(s.knownCost, 15.5);
    assert.equal(s.byModel.mystery.cost, null);
    assert.equal(s.byModel['model-b'].cost, 15);
  });

  it('is all zeros for a repository without runs', () => {
    const s = summarize(modelOf([item('STORY-000009')]));
    assert.equal(s.items, 0);
    assert.equal(s.runs, 0);
    assert.equal(s.cost, 0);
    assert.deepEqual(s.byStatus, {});
  });
});

describe('usage: rollup', () => {
  it('adds the item and every descendant through parent, against the item budget', () => {
    const records = [
      item('EPIC-000001', { agent: { budget_usd: 10, runs: [runB('2026-09-01', 1000000, { purpose: 'triage' })] } }),
      item('STORY-000001', { parent: 'EPIC-000001', agent: { runs: [runB('2026-09-02', 1000000)] } }),
      item('TASK-000001', { parent: 'STORY-000001', agent: { runs: [runB('2026-09-03', 1000000)] } }),
      item('STORY-000002', { parent: 'EPIC-000001' }),
      item('STORY-000003', { agent: { runs: [runB('2026-09-03', 9000000)] } }),
    ];
    const r = rollup(modelOf(records), 'EPIC-000001');
    assert.equal(r.id, 'EPIC-000001');
    assert.equal(r.members, 4);
    assert.equal(r.items, 3);
    assert.equal(r.runs, 3);
    assert.equal(r.cost, 15);
    assert.equal(r.budget, 10);
    assert.equal(r.remaining, -5);
    assert.equal(r.overBudget, true);
    assert.equal(rollup(modelOf(records), 'STORY-000001').cost, 10);
  });

  it('uses the type default budget and is null for an unknown ID', () => {
    const records = [item('STORY-000001', { agent: { runs: [runB('2026-09-02', 1000000)] } })];
    const r = rollup(modelOf(records), 'STORY-000001');
    assert.equal(r.budget, 10);
    assert.equal(r.remaining, 5);
    assert.equal(r.overBudget, false);
    assert.equal(rollup(modelOf(records), 'EPIC-000404'), null);
  });

  it('terminates on a parent cycle and counts each item once', () => {
    const records = [
      item('STORY-000001', { parent: 'STORY-000002', agent: { runs: [runB('2026-09-01', 1000000)] } }),
      item('STORY-000002', { parent: 'STORY-000003', agent: { runs: [runB('2026-09-01', 1000000)] } }),
      item('STORY-000003', { parent: 'STORY-000001', agent: { runs: [runB('2026-09-01', 1000000)] } }),
      item('STORY-000004', { parent: 'STORY-000004', agent: { runs: [runB('2026-09-01', 1000000)] } }),
    ];
    const r = rollup(modelOf(records), 'STORY-000002');
    assert.equal(r.members, 3);
    assert.equal(r.runs, 3);
    assert.equal(r.cost, 15);
    const self = rollup(modelOf(records), 'STORY-000004');
    assert.equal(self.members, 1);
    assert.equal(self.cost, 5);
  });
});

// --- appendRunText --------------------------------------------------------------

const RUN = { date: '2026-10-15', handle: 'Fable', model: 'model-a', output_tokens: 1200, cost_usd: '0.42', source: 'manual' };
const RUN_LINES = (pad) =>
  ['- date: 2026-10-15', '  handle: Fable', '  model: model-a', '  output_tokens: 1200', '  cost_usd: 0.42', '  source: manual'].map(
    (l) => pad + l
  );

/** Assert `after` is `before` with exactly `inserted` spliced in at line `at` (lines split on \n, \r kept). */
function assertInserted(before, after, at, inserted) {
  const expected = before.split('\n');
  expected.splice(at, 0, ...inserted);
  assert.equal(after, expected.join('\n'));
}

function runsAfterAppend(text) {
  const rec = parseItem('items/STORY-000001.md', text);
  assert.deepEqual(rec.errors, []);
  return rec.meta.agent.runs;
}

const HEAD = '---\nid: STORY-000001\ntype: STORY\ntitle: One\nstatus: Backlog\ncreated: 2026-09-01\nupdated: 2026-09-01\nspec_version: 1.0\n';

describe('usage: appendRunText', () => {
  it('appends after the existing runs and leaves every other line alone', () => {
    const before =
      HEAD +
      'agent:\n  budget_usd: 7.5\n  runs:\n    - date: 2026-09-10\n      handle: Fable\n      model: model-a\n      notes: |\n        multi\n\n        line\n  status: idle\n---\n\n# Summary\n';
    const after = appendRunText(before, RUN);
    assertInserted(before, after, 18, RUN_LINES('    '));
    const runs = runsAfterAppend(after);
    assert.equal(runs.length, 2);
    assert.equal(runs[1].cost_usd, '0.42');
    assert.equal(runs[0].notes, 'multi\n\nline\n');
  });

  it('follows the existing item indent', () => {
    const before = HEAD + 'agent:\n    runs:\n        - date: 2026-09-10\n          handle: Fable\n          model: model-a\n---\nBody\n';
    const after = appendRunText(before, RUN);
    assertInserted(before, after, 13, RUN_LINES('        '));
    assert.equal(runsAfterAppend(after).length, 2);
  });

  it('refuses the compact sequence form, which utils/yaml.js does not read as a list', () => {
    const before = HEAD + 'agent:\n  runs:\n  - date: 2026-09-10\n    handle: Fable\n    model: model-a\n---\nBody\n';
    assert.equal(appendRunText(before, RUN), null);
  });

  it('creates runs at the end of an agent mapping that has none', () => {
    const before = HEAD + 'agent:\n  budget_usd: 5\n  status: idle\n\nlabels: []\n---\nBody\n';
    const after = appendRunText(before, RUN);
    // After the mapping's last line, not after the blank line that follows it.
    assertInserted(before, after, 11, ['  runs:', ...RUN_LINES('    ')]);
    const rec = parseItem('items/STORY-000001.md', after);
    assert.equal(rec.meta.agent.status, 'idle');
    assert.equal(rec.meta.agent.runs.length, 1);
    assert.deepEqual(rec.meta.labels, []);
  });

  it('creates agent and runs before the closing fence when there is no agent', () => {
    const before = HEAD + 'labels:\n  - a\n---\n\n# Summary\n';
    const after = appendRunText(before, RUN);
    assertInserted(before, after, 10, ['agent:', '  runs:', ...RUN_LINES('    ')]);
    assert.deepEqual(runsAfterAppend(after)[0], { ...RUN, output_tokens: 1200 });
  });

  it('opens empty placeholders: agent: {}, runs: [], ~ and a bare agent:', () => {
    const a = appendRunText(HEAD + 'agent: {}\n---\n', RUN);
    assert.match(a, /\nagent:\n {2}runs:\n {4}- date: 2026-10-15\n/);
    assert.equal(runsAfterAppend(a).length, 1);
    const tilde = appendRunText(HEAD + 'agent: ~\n---\n', RUN);
    assert.equal(runsAfterAppend(tilde).length, 1);
    const b = appendRunText(HEAD + 'agent:\n  runs: []\n---\n', RUN);
    assert.match(b, /\nagent:\n {2}runs:\n {4}- date: 2026-10-15\n/);
    assert.equal(runsAfterAppend(b).length, 1);
    const c = appendRunText(HEAD + 'agent:\n---\n', RUN);
    assert.match(c, /\nagent:\n {2}runs:\n {4}- date/);
    assert.equal(runsAfterAppend(c).length, 1);
  });

  it('keeps CRLF line endings and a BOM', () => {
    const before = ('﻿' + HEAD + 'agent:\n  runs:\n    - date: 2026-09-10\n      handle: Fable\n      model: model-a\n---\r\nBody\r\n').replace(/\r?\n/g, '\r\n');
    const after = appendRunText(before, RUN);
    assertInserted(before, after, 13, RUN_LINES('    ').map((l) => l + '\r'));
    assert.ok(!/[^\r]\n/.test(after), 'every line ends in CRLF');
    assert.equal(runsAfterAppend(after).length, 2);
  });

  it('keeps front-matter comments, including ones between and after runs', () => {
    const before =
      HEAD +
      '# usage below\nagent:\n  # recorded by tools\n  runs:\n    # first session\n    - date: 2026-09-10\n      handle: Fable\n      model: model-a\n    # trailing note\n\n# about labels\nlabels: []\n---\nBody\n';
    const after = appendRunText(before, RUN);
    // Comment lines are skipped when finding the end of the runs, so the new
    // run follows the last run line and every comment stays where it was.
    assertInserted(before, after, 16, RUN_LINES('    '));
    const rec = parseItem('items/STORY-000001.md', after);
    assert.equal(rec.meta.agent.runs.length, 2);
    assert.equal(rec.meta.agent.runs[0].handle, 'Fable');
  });

  it('returns null without front matter, or when agent/runs hold a value it cannot extend', () => {
    assert.equal(appendRunText('# Just a body\n', RUN), null);
    assert.equal(appendRunText('---\nid: X\nno closing fence\n', RUN), null);
    assert.equal(appendRunText(null, RUN), null);
    assert.equal(appendRunText(HEAD + '---\n', 'not a run'), null);
    assert.equal(appendRunText(HEAD + 'agent: busy\n---\n', RUN), null);
    // utils/yaml.js reads a trailing comment as part of the value, so this agent is not empty.
    assert.equal(appendRunText(HEAD + 'agent: # usage\n  status: idle\n---\n', RUN), null);
    assert.equal(appendRunText(HEAD + 'agent:\n  runs: [{ date: 2026-09-10 }]\n---\n', RUN), null);
  });
});

// --- Validation -------------------------------------------------------------------

const USERS = [{ handle: 'Fable', name: 'Fable', kind: 'agent', model: 'model-a' }, { handle: 'rdagum', name: 'R' }];

function issuesOf(meta, rest = {}) {
  const rec = item(meta.id || 'STORY-000001', { created: '2026-09-01', ...meta });
  return usageIssues(rec, modelOf([rec], { users: USERS, ...rest }));
}

const codes = (issues) => issues.map((i) => `${i.level}:${i.code}`);
const okRun = (extra = {}) => ({ date: '2026-09-10', handle: 'Fable', model: 'model-a', output_tokens: 10, ...extra });

describe('usage: usageIssues', () => {
  it('is silent for a well-formed item and for one without agent', () => {
    assert.deepEqual(issuesOf({ agent: { budget_usd: '7.5', runs: [okRun({ cost_usd: '0.1' })], status: { any: 'thing' } } }), []);
    assert.deepEqual(issuesOf({}), []);
    assert.deepEqual(issuesOf({ agent: null }), []);
    assert.deepEqual(issuesOf({ agent: { runs: [] } }), []);
  });

  it('invalid-usage: agent that is not a mapping, runs that is not a list', () => {
    assert.deepEqual(codes(issuesOf({ agent: 'busy' })), ['error:invalid-usage']);
    assert.deepEqual(codes(issuesOf({ agent: ['a'] })), ['error:invalid-usage']);
    assert.deepEqual(codes(issuesOf({ agent: { runs: 'none' } })), ['error:invalid-usage']);
    assert.deepEqual(codes(issuesOf({ agent: { runs: null } })), ['error:invalid-usage']);
    assert.deepEqual(codes(issuesOf({ agent: { runs: { date: '2026-09-10' } } })), ['error:invalid-usage']);
  });

  it('invalid-usage: a run that is not a mapping or lacks date, handle or model', () => {
    assert.deepEqual(codes(issuesOf({ agent: { runs: ['run'] } })), ['error:invalid-usage']);
    const missing = issuesOf({ agent: { runs: [{ output_tokens: 1 }] } });
    assert.deepEqual(codes(missing), ['error:invalid-usage']);
    assert.match(missing[0].message, /agent\.runs\[0\] is missing date, handle, model/);
    assert.deepEqual(codes(issuesOf({ agent: { runs: [okRun({ handle: '' })] } })), ['error:invalid-usage']);
  });

  it('invalid-usage: a malformed date', () => {
    const i = issuesOf({ agent: { runs: [okRun({ date: '10/09/2026' })] } });
    assert.deepEqual(codes(i), ['error:invalid-usage']);
    assert.match(i[0].message, /date must be a YYYY-MM-DD date/);
  });

  it('invalid-usage: negative or non-numeric tokens, cost and budget', () => {
    assert.deepEqual(codes(issuesOf({ agent: { runs: [okRun({ output_tokens: -1 })] } })), ['error:invalid-usage']);
    assert.deepEqual(codes(issuesOf({ agent: { runs: [okRun({ cache_write_1h_tokens: 'lots' })] } })), ['error:invalid-usage']);
    assert.deepEqual(codes(issuesOf({ agent: { runs: [okRun({ cost_usd: '-0.5' })] } })), ['error:invalid-usage']);
    assert.deepEqual(codes(issuesOf({ agent: { runs: [okRun({ cost_usd: 'free' })] } })), ['error:invalid-usage']);
    assert.deepEqual(codes(issuesOf({ agent: { budget_usd: 'ten', runs: [] } })), ['error:invalid-usage']);
    assert.deepEqual(codes(issuesOf({ agent: { budget_usd: -3 } })), ['error:invalid-usage']);
  });

  it('unpriced-model: once per model absent from a non-empty pricing table', () => {
    const i = issuesOf({ agent: { runs: [okRun({ model: 'mystery' }), okRun({ model: 'mystery', date: '2026-09-11' })] } });
    assert.deepEqual(codes(i), ['warning:unpriced-model']);
    assert.match(i[0].message, /"mystery"/);
    // An empty pricing table prices nothing, so nothing is singled out.
    assert.deepEqual(issuesOf({ agent: { runs: [okRun({ model: 'mystery' })] } }, { ai: parseAiConfig(null) }), []);
  });

  it('over-budget: cost above the resolved budget', () => {
    const i = issuesOf({ agent: { budget_usd: 1, runs: [okRun({ cost_usd: '1.5' })] } });
    assert.deepEqual(codes(i), ['warning:over-budget']);
    assert.match(i[0].message, /\$1\.50 of \$1\.00/);
    // Type default: STORY 10.
    assert.deepEqual(codes(issuesOf({ agent: { runs: [okRun({ model: 'model-b', output_tokens: 3000000 })] } })), ['warning:over-budget']);
    assert.deepEqual(issuesOf({ agent: { runs: [okRun({ model: 'model-b', output_tokens: 1000000 })] } }), []);
  });

  it('unknown-handle: a run handle not in users.yaml, only when there is a roster', () => {
    const i = issuesOf({ agent: { runs: [okRun({ handle: 'Ghost' })] } });
    assert.deepEqual(codes(i), ['warning:unknown-handle']);
    assert.match(i[0].message, /"Ghost"/);
    assert.deepEqual(issuesOf({ agent: { runs: [okRun({ handle: 'Ghost' })] } }, { users: [] }), []);
  });

  it('duplicate-run: two runs with the same source, session and model', () => {
    const run = okRun({ source: 'claude-code', session: 's-1' });
    const i = issuesOf({ agent: { runs: [run, { ...run, date: '2026-09-11' }] } });
    assert.deepEqual(codes(i), ['warning:duplicate-run']);
    assert.match(i[0].message, /agent\.runs\[1\] repeats agent\.runs\[0\]/);
    // A different model in the same session (a subagent) is a separate run.
    assert.deepEqual(issuesOf({ agent: { runs: [run, { ...run, model: 'model-b' }] } }), []);
    // Runs without a session are never duplicates of each other.
    assert.deepEqual(issuesOf({ agent: { runs: [okRun({ source: 'manual' }), okRun({ source: 'manual' })] } }), []);
  });

  it('early-run: a run dated before the item was created', () => {
    const i = issuesOf({ agent: { runs: [okRun({ date: '2026-08-31' })] } });
    assert.deepEqual(codes(i), ['warning:early-run']);
    assert.deepEqual(issuesOf({ agent: { runs: [okRun({ date: '2026-09-01' })] } }), []);
  });

  describe('missing-usage', () => {
    const policy = (from) => parseAiConfig({ pricing: { 'model-a': { input: 1, output: 1 } }, policy: { require_usage: true, require_usage_from: from } });

    it('warns for an agent-assigned item at or after require_usage_from without a runs key', () => {
      const ai = policy('Review');
      assert.deepEqual(codes(issuesOf({ assignee: 'Fable', status: 'Review' }, { ai })), ['warning:missing-usage']);
      assert.deepEqual(codes(issuesOf({ assignee: 'Fable', status: 'Done', agent: { status: 'idle' } }, { ai })), ['warning:missing-usage']);
    });

    it('is satisfied by runs: [] and ignores earlier columns, people and unknown assignees', () => {
      const ai = policy('Review');
      assert.deepEqual(issuesOf({ assignee: 'Fable', status: 'Review', agent: { runs: [] } }, { ai }), []);
      assert.deepEqual(issuesOf({ assignee: 'Fable', status: 'Backlog' }, { ai }), []);
      assert.deepEqual(issuesOf({ assignee: 'rdagum', status: 'Done' }, { ai }), []);
      assert.deepEqual(issuesOf({ assignee: 'Ghost', status: 'Done' }, { ai }), []);
    });

    it('defaults to the last column and is off without require_usage', () => {
      const ai = policy(null);
      assert.deepEqual(issuesOf({ assignee: 'Fable', status: 'Review' }, { ai }), []);
      assert.deepEqual(codes(issuesOf({ assignee: 'Fable', status: 'Done' }, { ai })), ['warning:missing-usage']);
      const off = parseAiConfig({ pricing: { 'model-a': { input: 1, output: 1 } } });
      assert.deepEqual(issuesOf({ assignee: 'Fable', status: 'Done' }, { ai: off }), []);
    });
  });
});

describe('usage: validateUsage', () => {
  it('puts errors on the record and in loadErrors, warnings on the record, with codes in the result', () => {
    const bad = item('STORY-000001', { created: '2026-09-01', agent: { runs: [{ date: 'soon' }] } });
    const late = item('STORY-000002', { created: '2026-09-15', agent: { runs: [okRun()] } });
    const model = { ...modelOf([bad, late], { users: USERS }), loadErrors: [], warnings: [] };
    const out = validateUsage(model);
    assert.deepEqual(out.errors.map((e) => [e.file, e.code]), [
      ['items/STORY-000001.md', 'invalid-usage'],
      ['items/STORY-000001.md', 'invalid-usage'],
    ]);
    assert.deepEqual(out.warnings.map((w) => [w.file, w.code]), [['items/STORY-000002.md', 'early-run']]);
    assert.equal(bad.errors.length, 2);
    assert.deepEqual(model.loadErrors, out.errors);
    assert.deepEqual(late.warnings, [out.warnings[0].message]);
    assert.deepEqual(late.errors, []);
    assert.deepEqual(model.warnings, []);
  });

  it('notes a require_usage_from that is not a workflow column', () => {
    const ai = parseAiConfig({ policy: { require_usage: true, require_usage_from: 'Shipped' } });
    const model = { ...modelOf([], { ai }), loadErrors: [], warnings: [] };
    validateUsage(model);
    assert.equal(model.warnings.length, 1);
    assert.match(model.warnings[0], /require_usage_from "Shipped" is not a workflow column; using the last column \(Done\)/);
  });
});

// --- loadRepository -----------------------------------------------------------

class MemFS {
  constructor(files) {
    this.name = 'repo';
    this.files = new Map(Object.entries(files));
  }
  async exists(p) {
    return this.files.has(p);
  }
  async readFile(p) {
    if (!this.files.has(p)) throw new Error(`ENOENT ${p}`);
    return this.files.get(p);
  }
  async writeFile(p, text) {
    this.files.set(p, text);
  }
  async deleteFile(p) {
    this.files.delete(p);
  }
  async listFiles(dir, { ext = null } = {}) {
    return [...this.files.keys()]
      .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
      .filter((p) => !ext || p.toLowerCase().endsWith(ext))
      .sort()
      .map((p) => ({ name: p.split('/').pop(), path: p }));
  }
}

const ITEM =
  '---\nid: STORY-000001\ntype: STORY\ntitle: One\nstatus: Backlog\ncreated: 2026-09-01\nupdated: 2026-09-01\nspec_version: 1.0\n' +
  'agent:\n  runs:\n    - date: 2026-09-10\n      handle: Fable\n      model: model-a\n      output_tokens: 100000\n---\n\n# Summary\n';

const base = {
  'config/workflow.yaml': 'columns:\n  - Backlog\n  - Done\n',
  'config/board.yaml': 'name: Test\nspec_version: 1.0\n',
  'items/STORY-000001.md': ITEM,
};

describe('usage: loadRepository', () => {
  it('has the empty ai shape and no messages without config/ai.yaml', async () => {
    const model = await loadRepository(new MemFS(base));
    assert.deepEqual(model.ai.pricing, {});
    assert.equal(model.loadErrors.length, 0);
    const u = itemUsage(model.items.get('items/STORY-000001.md'), model);
    assert.equal(u.runs, 1);
    assert.equal(u.cost, null);
  });

  it('loads pricing, defaults and policy from config/ai.yaml, flow mappings included', async () => {
    const files = {
      ...base,
      'config/ai.yaml':
        '# rates\npricing:\n  model-a: { input: 10, output: 50, cache_read: 1, cache_write: 12.5 }\ndefaults:\n  budget_usd: { STORY: 4 }\npolicy:\n  require_usage: true\n  require_usage_from: Done\n',
    };
    const model = await loadRepository(new MemFS(files));
    assert.equal(model.loadErrors.length, 0);
    assert.equal(model.ai.pricing['model-a'].cache_write, 12.5);
    assert.equal(model.ai.policy.requireUsageFrom, 'Done');
    const u = itemUsage(model.items.get('items/STORY-000001.md'), model);
    assert.equal(u.cost, 5);
    assert.equal(u.budget, 4);
    assert.equal(u.overBudget, true);
  });

  it('reports a malformed ai.yaml against the file and keeps loading', async () => {
    const files = { ...base, 'config/ai.yaml': 'pricing:\n  model-a: { input: -1, output: 2 }\n' };
    const model = await loadRepository(new MemFS(files));
    assert.equal(model.items.size, 1);
    assert.ok(model.loadErrors.some((e) => e.file === 'config/ai.yaml' && /model-a/.test(e.message)));
    assert.deepEqual(model.ai.pricing, {});
  });

  it('runs validateUsage: errors in loadErrors, warnings on the record, both printed by the validator', async () => {
    const { collectProblems } = require('../tools/lib.js');
    const files = {
      ...base,
      'config/ai.yaml': 'pricing:\n  model-z: { input: 1, output: 1 }\n',
      'items/STORY-000002.md': ITEM.replace(/000001/g, '000002').replace('date: 2026-09-10', 'date: 10 Sept'),
    };
    const model = await loadRepository(new MemFS(files));
    const good = model.items.get('items/STORY-000001.md');
    const bad = model.items.get('items/STORY-000002.md');
    assert.equal(good.errors.length, 0);
    assert.equal(good.warnings.length, 1);
    assert.match(good.warnings[0], /model-a/);
    assert.equal(bad.errors.length, 1);
    assert.deepEqual(model.loadErrors, [{ file: 'items/STORY-000002.md', message: bad.errors[0], code: 'invalid-usage' }]);
    assert.deepEqual(model.warnings, []);
    const problems = collectProblems(model);
    assert.deepEqual(
      problems.map((p) => [p.level, p.file]),
      [
        ['error', 'items/STORY-000002.md'],
        ['warning', 'items/STORY-000001.md'],
        ['warning', 'items/STORY-000002.md'],
      ]
    );
  });

  it('adds no messages for a repository whose items carry no agent block', async () => {
    const files = { ...base, 'items/STORY-000001.md': ITEM.replace(/agent:[\s\S]*?---/, '---') };
    const model = await loadRepository(new MemFS(files));
    assert.equal(model.items.get('items/STORY-000001.md').meta.agent, undefined);
    assert.deepEqual(model.loadErrors, []);
    assert.deepEqual(model.items.get('items/STORY-000001.md').warnings, []);
  });

  it('keeps kind and model on users.yaml entries', async () => {
    const files = {
      ...base,
      'config/users.yaml': 'users:\n  - name: Rodolfo\n    handle: rdagum\n  - name: Fable Agent\n    handle: Fable\n    kind: agent\n    model: model-a\n',
    };
    const model = await loadRepository(new MemFS(files));
    assert.deepEqual(model.users, [
      { handle: 'rdagum', name: 'Rodolfo' },
      { handle: 'Fable', name: 'Fable Agent', kind: 'agent', model: 'model-a' },
    ]);
  });
});
