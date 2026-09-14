// test/store.test.js — state/store.js filters and facets (PROMPT.md §4.6),
// driven against a hand-built model so no filesystem is involved.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadWS, PURE_MODULES } = require('./load.js');

const WS = loadWS([...PURE_MODULES, 'state/store.js']);
const { Store } = WS;

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

function storeWith(records) {
  const store = new Store();
  const items = new Map(records.map((r) => [r.path, r]));
  store.state.model = { workflow: ['Backlog', 'Done'], items, itemsById: new Map(), board: { settings: {} } };
  return store;
}

const RECORDS = [
  record('STORY-000001', { priority: 'low', assignee: 'alice' }),
  record('STORY-000002', { priority: 'critical', assignee: 'bjorn' }),
  record('BUG-000001', { priority: 'high', labels: ['urgent'] }),
  record('TASK-000001', { priority: 'medium' }),
  record('TASK-000002', { priority: 'someday' }),
  record('SPIKE-000001', {}),
];

describe('store: priority filter', () => {
  it('starts empty and is part of the filter set', () => {
    const store = storeWith(RECORDS);
    assert.equal(store.state.filters.priority, '');
    assert.equal(store.filteredItems().length, RECORDS.length);
  });

  it('keeps only items whose priority matches exactly', () => {
    const store = storeWith(RECORDS);
    store.setFilter('priority', 'high');
    assert.deepEqual(
      store.filteredItems().map((r) => r.meta.id),
      ['BUG-000001']
    );
    store.setFilter('priority', 'nope');
    assert.equal(store.filteredItems().length, 0);
  });

  it('combines with the other filters', () => {
    const store = storeWith(RECORDS);
    store.setFilter('type', 'STORY');
    store.setFilter('priority', 'critical');
    assert.deepEqual(store.filteredItems().map((r) => r.meta.id), ['STORY-000002']);
    store.setFilter('assignee', 'alice');
    assert.equal(store.filteredItems().length, 0);
  });

  it('is reset by clearFilters', () => {
    const store = storeWith(RECORDS);
    store.setFilter('priority', 'low');
    store.clearFilters();
    assert.equal(store.state.filters.priority, '');
    assert.equal(store.filteredItems().length, RECORDS.length);
  });

  it('lists facet values most urgent first, then unranked values alphabetically', () => {
    const store = storeWith(RECORDS);
    assert.deepEqual(store.facets().priority, ['critical', 'high', 'medium', 'low', 'someday']);
  });

  it('emits to subscribers when the filter changes', () => {
    const store = storeWith(RECORDS);
    let calls = 0;
    store.subscribe(() => calls++);
    store.setFilter('priority', 'medium');
    assert.equal(calls, 1);
  });
});
