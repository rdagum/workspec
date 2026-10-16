// test/usage-selectors.test.js — periodRange (core/usage.js) and the store's
// AI usage selectors (state/store.js), driven against a hand-built model.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadWS, PURE_MODULES } = require('./load.js');

const WS = loadWS([...PURE_MODULES, 'state/store.js']);
const { Store, periodRange } = WS;

const today = new Date(2026, 9, 15); // 2026-10-15, local time

describe('periodRange', () => {
  it('is unbounded for all and unknown keys', () => {
    assert.deepEqual(periodRange('all', today), { since: null, until: null });
    assert.deepEqual(periodRange('x', today), { since: null, until: null });
  });

  it('spans 7 and 30 days ending today, inclusive', () => {
    assert.deepEqual(periodRange('7d', today), { since: '2026-10-09', until: '2026-10-15' });
    assert.deepEqual(periodRange('30d', today), { since: '2026-09-16', until: '2026-10-15' });
  });

  it('starts the month on the 1st', () => {
    assert.deepEqual(periodRange('month', today), { since: '2026-10-01', until: '2026-10-15' });
  });
});

function record(id, meta) {
  const [type] = id.split('-');
  return {
    path: `items/${id}.md`,
    fileName: `${id}.md`,
    meta: { id, type, title: id, status: 'Backlog', ...meta },
    errors: [],
    warnings: [],
  };
}

const run = (date, handle, cost) => ({ date, handle, model: 'm', cost_usd: cost });

function storeWith(records) {
  const store = new Store();
  const items = new Map(records.map((r) => [r.path, r]));
  store.state.model = {
    workflow: ['Backlog', 'Done'],
    items,
    itemsById: new Map(),
    board: { settings: {} },
    ai: WS.parseAiConfig(null),
  };
  return store;
}

const RECORDS = [
  record('STORY-000001', { agent: { runs: [run('2026-10-14', 'alice', 2), run('2026-08-01', 'bjorn', 5)] } }),
  record('STORY-000002', { status: 'Done', agent: { runs: [run('2026-10-10', 'alice', 1)] } }),
  record('TASK-000001', {}),
];

describe('store: AI usage selectors', () => {
  it('totals all runs of the filtered items by default', () => {
    const t = storeWith(RECORDS).usageTotals(today);
    assert.equal(t.cost, 8);
    assert.equal(t.byStatus.Done.cost, 1);
    assert.equal(t.byHandle.alice.cost, 3);
  });

  it('limits runs by the period, using run dates', () => {
    const store = storeWith(RECORDS);
    store.setUsagePeriod('7d');
    assert.equal(store.usageTotals(today).cost, 3); // 10-14 and 10-10; 08-01 is out
    store.setUsagePeriod('month');
    assert.equal(store.usageTotals(today).cost, 3);
  });

  it('follows the filters', () => {
    const store = storeWith(RECORDS);
    store.setFilter('status', 'Done');
    assert.equal(store.usageTotals(today).cost, 1);
  });

  it('falls back to all time for an unknown period', () => {
    const store = storeWith(RECORDS);
    store.setUsagePeriod('7d');
    store.setUsagePeriod('bogus');
    assert.equal(store.state.usagePeriod, 'all');
  });

  it('columnUsage sums the cards of one column', () => {
    const store = storeWith(RECORDS);
    assert.equal(store.columnUsage([RECORDS[0]]).cost, 7);
    assert.equal(store.columnUsage([RECORDS[2]]).runs, 0);
  });
});
