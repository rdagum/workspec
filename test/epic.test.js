// test/epic.test.js — epic membership (core/model.js) and the epic focus
// filter, list and outside-blocker selector in state/store.js
// (docs/DESIGN-2026-09-epic-focus.md), driven against hand-built models.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadWS, PURE_MODULES } = require('./load.js');

const WS = loadWS([...PURE_MODULES, 'state/store.js']);
const { Store, NO_EPIC, isEpic, indexById, parentChain, epicIndex, epicProgress } = WS;

function record(id, meta = {}) {
  const [type] = id.split('-');
  return {
    path: `items/${id}.md`,
    fileName: `${id}.md`,
    meta: { id, type, title: id, status: 'Backlog', ...meta },
    errors: [],
    warnings: [],
  };
}

function modelOf(records) {
  return {
    workflow: ['Backlog', 'In Progress', 'Done'],
    items: new Map(records.map((r) => [r.path, r])),
    itemsById: new Map(),
    board: { settings: {} },
  };
}

function storeWith(records) {
  const store = new Store();
  store.state.model = modelOf(records);
  return store;
}

const ids = (records) => records.map((r) => r.meta.id).sort();

// EPIC-1 ← STORY-1 ← TASK-1 (grandchild), EPIC-1 ← TASK-2 (direct),
// EPIC-1 ← EPIC-3 (nested) ← STORY-3, EPIC-2 ← STORY-2 (done),
// BUG-1 (no parent), TASK-3 → missing parent.
function corpus() {
  return [
    record('EPIC-000001'),
    record('EPIC-000002', { status: 'Done' }),
    record('EPIC-000003', { parent: 'EPIC-000001' }),
    record('STORY-000001', { parent: 'EPIC-000001', status: 'Done' }),
    record('TASK-000001', { parent: 'STORY-000001' }),
    record('TASK-000002', { parent: 'EPIC-000001', depends_on: ['BUG-000001', 'STORY-000002', 'TASK-000001', 'NOPE-000001'] }),
    record('STORY-000003', { parent: 'EPIC-000003' }),
    record('STORY-000002', { parent: 'EPIC-000002', status: 'Done' }),
    record('BUG-000001'),
    record('TASK-000003', { parent: 'STORY-000099' }),
  ];
}

describe('model: parentChain', () => {
  const recs = corpus();
  const byId = indexById(recs);
  const get = (id) => byId.get(id);

  it('returns the chain nearest first, through intermediate stories', () => {
    assert.deepEqual(parentChain(get('TASK-000001'), byId), ['STORY-000001', 'EPIC-000001']);
    assert.deepEqual(parentChain(get('STORY-000003'), byId), ['EPIC-000003', 'EPIC-000001']);
  });

  it('is empty for an item with no parent', () => {
    assert.deepEqual(parentChain(get('BUG-000001'), byId), []);
  });

  it('stops at a missing parent without throwing', () => {
    assert.deepEqual(parentChain(get('TASK-000003'), byId), []);
    const orphanChild = record('TASK-000009', { parent: 'TASK-000003' });
    assert.deepEqual(parentChain(orphanChild, byId), ['TASK-000003']);
  });

  it('stops at a two-item cycle and at a self-parent', () => {
    const a = record('STORY-000010', { parent: 'STORY-000011' });
    const b = record('STORY-000011', { parent: 'STORY-000010' });
    const self = record('STORY-000012', { parent: 'STORY-000012' });
    const cyc = indexById([a, b, self]);
    assert.deepEqual(parentChain(a, cyc), ['STORY-000011']);
    assert.deepEqual(parentChain(b, cyc), ['STORY-000010']);
    assert.deepEqual(parentChain(self, cyc), []);
  });
});

describe('model: epicIndex and epicProgress', () => {
  const model = modelOf(corpus());
  const index = epicIndex(model);

  it('lists only items whose type is exactly EPIC', () => {
    assert.deepEqual(ids(index.epics), ['EPIC-000001', 'EPIC-000002', 'EPIC-000003']);
    assert.equal(isEpic(record('STORY-000001')), false);
    assert.equal(isEpic({ meta: { type: 'Epic' } }), false);
  });

  it('collects direct children, grandchildren and nested epics, excluding the epic itself', () => {
    assert.deepEqual(ids(index.members.get('EPIC-000001')), [
      'EPIC-000003', 'STORY-000001', 'STORY-000003', 'TASK-000001', 'TASK-000002',
    ]);
    assert.deepEqual(ids(index.members.get('EPIC-000003')), ['STORY-000003']);
  });

  it('puts non-EPIC items that reach no epic in noEpic', () => {
    assert.deepEqual(ids(index.noEpic), ['BUG-000001', 'TASK-000003']);
  });

  it('survives a cycle between an epic and a story', () => {
    const recs = [record('EPIC-000001', { parent: 'STORY-000001' }), record('STORY-000001', { parent: 'EPIC-000001' })];
    const cyc = epicIndex(modelOf(recs));
    assert.deepEqual(ids(cyc.members.get('EPIC-000001')), ['STORY-000001']);
  });

  it('counts done as members in the last workflow column', () => {
    assert.deepEqual(epicProgress(index, 'EPIC-000001', model), { done: 1, total: 5 });
    assert.deepEqual(epicProgress(index, 'EPIC-000002', model), { done: 1, total: 1 });
    assert.deepEqual(epicProgress(index, 'EPIC-404', model), { done: 0, total: 0 });
  });
});

describe('store: epic filter', () => {
  it('starts off and is part of the filter set', () => {
    const store = storeWith(corpus());
    assert.equal(store.state.filters.epic, '');
    assert.equal(store.filteredItems().length, corpus().length);
  });

  it('shows the epic itself plus every member', () => {
    const store = storeWith(corpus());
    store.toggleEpicFocus('EPIC-000001');
    assert.deepEqual(ids(store.filteredItems()), [
      'EPIC-000001', 'EPIC-000003', 'STORY-000001', 'STORY-000003', 'TASK-000001', 'TASK-000002',
    ]);
  });

  it('shows the items that reach no epic for NO_EPIC', () => {
    const store = storeWith(corpus());
    store.toggleEpicFocus(NO_EPIC);
    assert.deepEqual(ids(store.filteredItems()), ['BUG-000001', 'TASK-000003']);
  });

  it('combines with the other filters', () => {
    const store = storeWith(corpus());
    store.toggleEpicFocus('EPIC-000001');
    store.setFilter('type', 'TASK');
    assert.deepEqual(ids(store.filteredItems()), ['TASK-000001', 'TASK-000002']);
    store.setFilter('status', 'Done');
    assert.equal(store.filteredItems().length, 0);
  });

  it('toggles off when the focused epic is selected again, and clearFilters resets it', () => {
    const store = storeWith(corpus());
    store.toggleEpicFocus('EPIC-000002');
    store.toggleEpicFocus('EPIC-000002');
    assert.equal(store.state.filters.epic, '');
    store.toggleEpicFocus('EPIC-000002');
    store.clearFilters();
    assert.equal(store.state.filters.epic, '');
  });

  it('clears the focus when the epic stops being an EPIC or disappears', () => {
    const store = storeWith(corpus());
    store.toggleEpicFocus('EPIC-000001');
    const epic = store.model.items.get('items/EPIC-000001.md');
    epic.meta = { ...epic.meta, type: 'STORY' }; // what saveItem does before set()
    store.set({ message: 'Saved' });
    assert.equal(store.state.filters.epic, '');

    store.toggleEpicFocus('EPIC-000002');
    store.model.items.delete('items/EPIC-000002.md'); // what deleteItem does before set()
    store.set({ message: 'Deleted' });
    assert.equal(store.state.filters.epic, '');

    store.toggleEpicFocus(NO_EPIC);
    store.set({ model: modelOf([record('BUG-000001')]) });
    assert.equal(store.state.filters.epic, NO_EPIC, 'NO_EPIC is never stale');
  });

  it('ignores a focus on an unknown ID rather than emptying the board', () => {
    const store = storeWith(corpus());
    store.state.filters.epic = 'EPIC-404';
    assert.equal(store.filteredItems().length, corpus().length);
    assert.equal(store.focusedEpicId(), null);
  });
});

describe('store: epicList', () => {
  it('lists open epics with progress over all items, hiding done ones by default', () => {
    const store = storeWith(corpus());
    store.setFilter('type', 'BUG'); // other filters do not change progress
    const list = store.epicList();
    assert.equal(list.hasEpics, true);
    assert.deepEqual(list.entries.map((e) => [e.id, e.done, e.total]), [
      ['EPIC-000001', 1, 5],
      ['EPIC-000003', 0, 1],
    ]);
    assert.equal(list.hiddenDone, 1);
    assert.equal(list.noEpicCount, 2);
  });

  it('shows done epics with showDoneEpics, and always shows the focused one', () => {
    const store = storeWith(corpus());
    store.setShowDoneEpics(true);
    assert.equal(store.epicList().entries.length, 3);
    store.setShowDoneEpics(false);
    store.toggleEpicFocus('EPIC-000002');
    assert.ok(store.epicList().entries.some((e) => e.id === 'EPIC-000002'));
  });

  it('follows the active sort', () => {
    const store = storeWith(corpus());
    store.setSort({ field: 'title', direction: 'desc' });
    assert.deepEqual(store.epicList().entries.map((e) => e.id), ['EPIC-000003', 'EPIC-000001']);
  });

  it('reports no epics for a repository without EPIC items', () => {
    const store = storeWith([record('BUG-000001'), record('STORY-000001', { type: 'Epic' })]);
    assert.equal(store.epicList().hasEpics, false);
  });
});

describe('store: outsideBlockers and newItemParent', () => {
  const byIdOf = (store, id) => store.model.items.get(`items/${id}.md`);

  it('names dependencies outside the focused epic that are not done, including missing IDs', () => {
    const store = storeWith(corpus());
    store.toggleEpicFocus('EPIC-000001');
    // BUG-000001: outside and open → counts. STORY-000002: outside but Done → no.
    // TASK-000001: inside the epic → no. NOPE-000001: missing → counts.
    assert.deepEqual(store.outsideBlockers(byIdOf(store, 'TASK-000002')), ['BUG-000001', 'NOPE-000001']);
  });

  it('counts an outside item that names the card in its own blocks list', () => {
    const recs = [
      ...corpus(),
      record('BUG-000002', { blocks: ['STORY-000003'] }), // outside, open → counts
      record('BUG-000003', { blocks: 'STORY-000003', status: 'Done' }), // outside, done → no
      record('TASK-000005', { parent: 'EPIC-000001', blocks: ['STORY-000003'] }), // inside → no
    ];
    const store = storeWith(recs);
    store.toggleEpicFocus('EPIC-000001');
    assert.deepEqual(store.outsideBlockers(byIdOf(store, 'STORY-000003')), ['BUG-000002']);
  });

  it('lists a blocker once when both sides record the dependency', () => {
    const store = storeWith([
      record('EPIC-000001'),
      record('STORY-000001', { parent: 'EPIC-000001', depends_on: ['BUG-000001'] }),
      record('BUG-000001', { blocks: ['STORY-000001'] }),
    ]);
    store.toggleEpicFocus('EPIC-000001');
    assert.deepEqual(store.outsideBlockers(byIdOf(store, 'STORY-000001')), ['BUG-000001']);
  });

  it('accepts a scalar depends_on and returns nothing without a focus', () => {
    const store = storeWith([...corpus(), record('TASK-000004', { parent: 'EPIC-000001', depends_on: 'BUG-000001' })]);
    assert.deepEqual(store.outsideBlockers(byIdOf(store, 'TASK-000004')), []);
    store.toggleEpicFocus('EPIC-000001');
    assert.deepEqual(store.outsideBlockers(byIdOf(store, 'TASK-000004')), ['BUG-000001']);
    store.toggleEpicFocus(NO_EPIC);
    assert.deepEqual(store.outsideBlockers(byIdOf(store, 'TASK-000004')), []);
  });

  it('pre-fills parent with the focused epic, except for a new EPIC', () => {
    const store = storeWith(corpus());
    assert.equal(store.newItemParent('STORY'), null);
    store.toggleEpicFocus('EPIC-000001');
    assert.equal(store.newItemParent('STORY'), 'EPIC-000001');
    assert.equal(store.newItemParent('EPIC'), null);
    store.toggleEpicFocus(NO_EPIC);
    assert.equal(store.newItemParent('TASK'), null);
  });
});
