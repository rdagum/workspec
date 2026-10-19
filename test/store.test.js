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

describe('store: saveItem honours the round-trip guard (record.lossy)', () => {
  const { parseItem } = WS;
  // CRLF and a BOM, so "verbatim" is checked byte for byte.
  const RAW = [
    '﻿---', 'id: STORY-000042', 'type: STORY', 'title: &t Anchored', 'status: Backlog',
    'created: 2026-10-19', 'updated: 2026-10-19', 'spec_version: 1.0', '---', '', 'Body', '',
  ].join('\r\n');
  const FM_LF = 'id: STORY-000042\ntype: STORY\ntitle: &t Anchored\nstatus: Backlog\ncreated: 2026-10-19\nupdated: 2026-10-19\nspec_version: 1.0';

  function setup(raw) {
    const rec = parseItem('items/STORY-000042.md', raw);
    const store = storeWith([rec]);
    const written = {};
    store.state.fs = { writeFile: async (p, text) => { written[p] = text; } };
    return { store, rec, written };
  }

  it('writes the file back byte for byte and ignores the meta it is given', async () => {
    const { store, rec, written } = setup(RAW);
    assert.equal(rec.lossy, true);
    await store.saveItem(rec.path, { id: 'STORY-000042', title: 'from the form' }, rec.body);
    assert.equal(written[rec.path], RAW);
    assert.equal(rec.raw, RAW);
    assert.equal(rec.meta.title, '&t Anchored');
  });

  it('writes the raw editor text verbatim, in the file\'s own line endings', async () => {
    const { store, rec, written } = setup(RAW);
    await store.saveItem(rec.path, rec.meta, '\nNew body\n', FM_LF.replace('Anchored', 'Renamed'));
    assert.equal(written[rec.path], RAW.replace('Anchored', 'Renamed').replace('\r\nBody\r\n', '\nNew body\n'));
    assert.equal(rec.meta.title, '&t Renamed');
    assert.equal(rec.lossy, true, 'still lossy: the anchor is still there');
    assert.ok(rec.warnings.some((w) => /raw YAML only/.test(w)));
  });

  it('re-parses what it wrote, so fixing the YAML clears the flag', async () => {
    const { store, rec } = setup(RAW);
    await store.saveItem(rec.path, rec.meta, rec.body, FM_LF.replace('&t Anchored', 'Plain'));
    assert.equal(rec.lossy, false);
    assert.deepEqual(rec.errors, []);
    assert.deepEqual(rec.warnings, []);
    assert.equal(rec.meta.title, 'Plain');
  });

  it('keeps front matter that does not parse verbatim when only the body changes', async () => {
    const broken = RAW.replace('title: &t Anchored', 'title: t\r\n   oops: 1');
    const { store, rec, written } = setup(broken);
    assert.equal(rec.lossy, true);
    assert.deepEqual(rec.meta, {});
    await store.saveItem(rec.path, rec.meta, '\r\nEdited body\r\n');
    assert.equal(written[rec.path], broken.replace('Body', 'Edited body'));
    assert.match(rec.errors[0], /^YAML parse error: line 5: unexpected indentation/);
  });

  it('still serializes a record that is not lossy from its meta', async () => {
    const { store, rec, written } = setup(RAW.replace('&t ', ''));
    assert.equal(rec.lossy, false);
    await store.saveItem(rec.path, { ...rec.meta, title: 'From the form' }, rec.body);
    assert.match(written[rec.path], /^---\nid: STORY-000042\n[\s\S]*^title: From the form$/m);
  });

  it('refuses a drag/drop that would have to re-serialize a lossy record', async () => {
    const { store, rec, written } = setup(RAW.replace('status: Backlog\r\n', ''));
    await assert.rejects(store.moveItem(rec.path, 'Done'), /raw YAML/);
    assert.deepEqual(written, {});
  });
});
