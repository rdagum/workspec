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
