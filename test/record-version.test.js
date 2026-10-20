// test/record-version.test.js — STORY-000002: every record carries a version that
// saves, moves, creates and reloads advance, and the three-way merge the editor
// uses when the record it has open changes behind its back. Driven against a
// hand-built model with a stub filesystem, so nothing touches the disk.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadWS, PURE_MODULES } = require('./load.js');

const WS = loadWS([...PURE_MODULES, 'state/store.js']);
const { Store, parseItem, serializeItem, mergeWorkingCopy } = WS;

const RAW = [
  '---', 'id: STORY-000042', 'type: STORY', 'title: Plain', 'status: Backlog',
  'created: 2026-10-19', 'updated: 2026-10-19', 'spec_version: 1.0', '---', '', 'Body', '',
].join('\n');

function modelWith(records) {
  return { workflow: ['Backlog', 'Done'], items: new Map(records.map((r) => [r.path, r])), itemsById: new Map(), board: { settings: {} } };
}

function setup(raw = RAW) {
  const rec = parseItem('items/STORY-000042.md', raw);
  const store = new Store();
  store.state.model = modelWith([rec]);
  const written = {};
  store.state.fs = { writeFile: async (p, text) => { written[p] = text; } };
  return { store, rec, written };
}

describe('store: record versions', () => {
  it('saveItem advances the version of the record it saved', async () => {
    const { store, rec } = setup();
    rec.version = 3;
    await store.saveItem(rec.path, { ...rec.meta, title: 'Edited' }, rec.body);
    assert.equal(rec.version, 4);
    await store.saveItem(rec.path, { ...rec.meta, title: 'Edited again' }, rec.body);
    assert.equal(rec.version, 5);
  });

  it('a verbatim save of a lossy record advances the version as well', async () => {
    const { store, rec } = setup(RAW.replace('title: Plain', 'title: &t Anchored'));
    assert.equal(rec.lossy, true);
    rec.version = 1;
    await store.saveItem(rec.path, rec.meta, '\nNew body\n');
    assert.equal(rec.version, 2);
  });

  it('moveItem advances the version and emits; a move to the same column does neither', async () => {
    const { store, rec } = setup();
    rec.version = 1;
    let emits = 0;
    store.subscribe(() => emits++);
    assert.equal(await store.moveItem(rec.path, 'Done'), true);
    assert.equal(rec.version, 2);
    assert.equal(rec.meta.status, 'Done');
    assert.equal(emits, 1);
    assert.equal(await store.moveItem(rec.path, 'Done'), false);
    assert.equal(rec.version, 2);
    assert.equal(emits, 1);
  });

  it('a record that has no version yet is numbered from 1 by its first change', async () => {
    const { store, rec } = setup();
    assert.equal(rec.version, undefined);
    await store.moveItem(rec.path, 'Done');
    assert.equal(rec.version, 1);
  });

  it('a failed write leaves the record and its version untouched', async () => {
    const { store, rec } = setup();
    rec.version = 7;
    store.state.fs = { writeFile: async () => { throw new Error('disk full'); } };
    await assert.rejects(store.saveItem(rec.path, { ...rec.meta, title: 'Edited' }, rec.body), /disk full/);
    await assert.rejects(store.moveItem(rec.path, 'Done'), /disk full/);
    assert.equal(rec.version, 7);
    assert.equal(rec.meta.title, 'Plain');
    assert.equal(rec.meta.status, 'Backlog');
  });

  it('addItem creates a record at version 1', async () => {
    const { store, written } = setup();
    const meta = { id: 'STORY-000043', type: 'STORY', title: 'New', status: 'Backlog', created: '2026-10-19', updated: '2026-10-19', spec_version: '1.0' };
    const rec = await store.addItem('items/STORY-000043.md', meta, '# Summary\n');
    assert.equal(rec.version, 1);
    assert.equal(written['items/STORY-000043.md'], serializeItem(meta, '# Summary\n'));
    assert.equal(store.state.selectedPath, 'items/STORY-000043.md');
  });

  it('a reload numbers each record one past the record it replaces; new paths start at 1', () => {
    const { store, rec } = setup();
    rec.version = 4;
    const reloaded = parseItem(rec.path, RAW);
    const other = parseItem('items/STORY-000044.md', RAW.replace('000042', '000044'));
    store.set({ model: modelWith([reloaded, other]) });
    assert.equal(reloaded.version, 5);
    assert.equal(other.version, 1);
  });

  it('the first load of a repository numbers its records 1', () => {
    const store = new Store();
    const rec = parseItem('items/STORY-000042.md', RAW);
    store.set({ model: modelWith([rec]) });
    assert.equal(rec.version, 1);
  });

  it('other state changes leave versions alone', () => {
    const { store, rec } = setup();
    rec.version = 2;
    store.setFilter('type', 'STORY');
    store.open(rec.path);
    store.close();
    store.set({ message: 'hello' });
    assert.equal(rec.version, 2);
  });

  it('keeps no dirty flag: the editor owns that', () => {
    assert.equal('dirty' in new Store().state, false);
  });
});

describe('mergeWorkingCopy: an external change meets a dirty working copy', () => {
  const base = { meta: { id: 'S-1', title: 'Old', status: 'Backlog', labels: ['a'] }, body: 'Body' };

  it('takes the externally changed key and keeps the user\'s other edits', () => {
    const working = { meta: { ...base.meta, title: 'Typed' }, body: 'Body' };
    const incoming = { meta: { ...base.meta, status: 'Done' }, body: 'Body' };
    const out = mergeWorkingCopy(base, working, incoming);
    assert.deepEqual(out.meta, { id: 'S-1', title: 'Typed', status: 'Done', labels: ['a'] });
    assert.deepEqual(out.applied, ['status']);
    assert.deepEqual(out.kept, []);
  });

  it('never overwrites a key the user also edited, and says so', () => {
    const working = { meta: { ...base.meta, status: 'Mine' }, body: 'Body' };
    const incoming = { meta: { ...base.meta, status: 'Done' }, body: 'Body' };
    const out = mergeWorkingCopy(base, working, incoming);
    assert.equal(out.meta.status, 'Mine');
    assert.deepEqual(out.applied, []);
    assert.deepEqual(out.kept, ['status']);
  });

  it('leaves keys the external change did not touch alone, even if the user edited them', () => {
    const working = { meta: { ...base.meta, title: 'Typed', labels: ['a', 'b'] }, body: 'Typed body' };
    const out = mergeWorkingCopy(base, working, { meta: { ...base.meta, status: 'Done' }, body: 'Body' });
    assert.deepEqual(out.meta.labels, ['a', 'b']);
    assert.equal(out.body, 'Typed body');
    assert.deepEqual(out.kept, []);
  });

  it('adds and removes keys, and takes the body when only the record changed it', () => {
    const incoming = { meta: { id: 'S-1', title: 'Old', status: 'Backlog', assignee: 'sonnet' }, body: 'New body' };
    const out = mergeWorkingCopy(base, { meta: { ...base.meta }, body: 'Body' }, incoming);
    assert.deepEqual(out.meta, { id: 'S-1', title: 'Old', status: 'Backlog', assignee: 'sonnet' });
    assert.equal(out.body, 'New body');
    assert.deepEqual([...out.applied].sort(), ['assignee', 'body', 'labels']);
  });

  it('keeps an edited body when the record\'s body changed too', () => {
    const out = mergeWorkingCopy(base, { meta: { ...base.meta }, body: 'Mine' }, { meta: { ...base.meta }, body: 'Theirs' });
    assert.equal(out.body, 'Mine');
    assert.deepEqual(out.kept, ['body']);
  });

  it('does not mutate its arguments and returns an independent copy', () => {
    const working = { meta: { ...base.meta, labels: ['a', 'x'] }, body: 'Body' };
    const incoming = { meta: { ...base.meta, status: 'Done' }, body: 'Body' };
    const snapshot = JSON.stringify([base, working, incoming]);
    const out = mergeWorkingCopy(base, working, incoming);
    assert.equal(JSON.stringify([base, working, incoming]), snapshot);
    out.meta.labels.push('y');
    assert.deepEqual(working.meta.labels, ['a', 'x']);
  });

  it('keeps the working copy\'s key order', () => {
    const working = { meta: { title: 'T', id: 'S-1', status: 'Backlog' }, body: '' };
    const out = mergeWorkingCopy({ meta: { ...working.meta }, body: '' }, working, { meta: { ...working.meta, status: 'Done' }, body: '' });
    assert.deepEqual(Object.keys(out.meta), ['title', 'id', 'status']);
  });
});
