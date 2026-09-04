// test/recent.test.js — core/recent.js: the remembered-repositories list
// (docs/REVIEW-2026-09.md F1) driven through an in-memory adapter that stands
// in for IndexedDB, with fake directory handles that implement isSameEntry.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadWS } = require('./load.js');

const WS = loadWS(['core/recent.js']);
const { RecentRepositories, MAX_RECENT, probeHandle, isMissingError, sameDirectory } = WS;

/** The three-method adapter core/recent.js expects, backed by a Map. */
class MemoryStore {
  constructor() {
    this.records = new Map();
  }
  async getAll() {
    return [...this.records.values()].map((r) => ({ ...r }));
  }
  async put(record) {
    this.records.set(record.key, { ...record });
  }
  async delete(key) {
    this.records.delete(key);
  }
}

/** A stand-in FileSystemDirectoryHandle: identity is the `id`, not the object. */
function handle(id, { name = '.workspec', permission = 'prompt', missing = false } = {}) {
  return {
    id,
    name,
    kind: 'directory',
    async isSameEntry(other) {
      return !!other && other.id === this.id;
    },
    async queryPermission() {
      return permission;
    },
    keys() {
      return {
        async next() {
          if (missing) throw Object.assign(new Error('gone'), { name: 'NotFoundError' });
          return { value: 'config', done: false };
        },
      };
    },
  };
}

function ticking(start = 1000) {
  let t = start;
  return () => (t += 1000);
}

describe('recent: remember and list', () => {
  it('stores the handle, the name and the directory name and lists newest first', async () => {
    const store = new MemoryStore();
    const recent = new RecentRepositories(store, { now: ticking() });
    await recent.remember({ handle: handle('a'), name: 'Alpha' });
    await recent.remember({ handle: handle('b'), name: 'Beta' });

    const list = await recent.list();
    assert.deepEqual(list.map((r) => r.name), ['Beta', 'Alpha']);
    assert.equal(list[0].dirName, '.workspec');
    assert.equal(list[0].handle.id, 'b');
    assert.equal(list[0].unavailable, false);
    assert.ok(list[0].key && list[1].key && list[0].key !== list[1].key);
    assert.ok(list[0].lastOpened > list[1].lastOpened);
  });

  it('falls back to the directory name when no board name is given', async () => {
    const recent = new RecentRepositories(new MemoryStore());
    const record = await recent.remember({ handle: handle('a', { name: 'my-workspec' }) });
    assert.equal(record.name, 'my-workspec');
  });

  it('reopening the same directory keeps its key, refreshes the name and moves it to the top', async () => {
    const store = new MemoryStore();
    const recent = new RecentRepositories(store, { now: ticking() });
    const first = await recent.remember({ handle: handle('a'), name: 'Alpha' });
    await recent.remember({ handle: handle('b'), name: 'Beta' });
    // A different handle object for the same directory, as IndexedDB returns.
    const again = await recent.remember({ handle: handle('a'), name: 'Alpha renamed' });

    assert.equal(again.key, first.key);
    const list = await recent.list();
    assert.equal(list.length, 2);
    assert.deepEqual(list.map((r) => r.name), ['Alpha renamed', 'Beta']);
  });

  it('caps the list, evicting the least recently opened', async () => {
    const store = new MemoryStore();
    const recent = new RecentRepositories(store, { max: 3, now: ticking() });
    for (const id of ['a', 'b', 'c', 'd']) await recent.remember({ handle: handle(id), name: id });
    assert.deepEqual((await recent.list()).map((r) => r.name), ['d', 'c', 'b']);

    // Reopening an existing entry never evicts anything.
    await recent.remember({ handle: handle('b'), name: 'b' });
    assert.deepEqual((await recent.list()).map((r) => r.name), ['b', 'd', 'c']);
  });

  it('defaults the cap to about eight', () => {
    assert.equal(MAX_RECENT, 8);
    assert.equal(new RecentRepositories(new MemoryStore()).max, MAX_RECENT);
  });

  it('ignores records without a key or handle', async () => {
    const store = new MemoryStore();
    store.records.set('broken', { key: 'broken', name: 'No handle' });
    const recent = new RecentRepositories(store);
    await recent.remember({ handle: handle('a'), name: 'Alpha' });
    assert.deepEqual((await recent.list()).map((r) => r.name), ['Alpha']);
  });
});

describe('recent: forget and unavailable', () => {
  it('forget removes one entry and tolerates unknown keys', async () => {
    const store = new MemoryStore();
    const recent = new RecentRepositories(store, { now: ticking() });
    const a = await recent.remember({ handle: handle('a'), name: 'Alpha' });
    await recent.remember({ handle: handle('b'), name: 'Beta' });
    await recent.forget(a.key);
    await recent.forget('nope');
    assert.deepEqual((await recent.list()).map((r) => r.name), ['Beta']);
  });

  it('setUnavailable flags an entry and a later successful open clears the flag', async () => {
    const store = new MemoryStore();
    const recent = new RecentRepositories(store, { now: ticking() });
    const a = await recent.remember({ handle: handle('a'), name: 'Alpha' });
    assert.equal((await recent.setUnavailable(a.key)).unavailable, true);
    assert.equal((await recent.list())[0].unavailable, true);
    assert.equal(await recent.setUnavailable('nope'), null);

    await recent.remember({ handle: handle('a'), name: 'Alpha' });
    assert.equal((await recent.list())[0].unavailable, false);
  });
});

describe('recent: handle helpers', () => {
  it('sameDirectory uses isSameEntry and treats failures as different directories', async () => {
    assert.equal(await sameDirectory(handle('a'), handle('a')), true);
    assert.equal(await sameDirectory(handle('a'), handle('b')), false);
    assert.equal(await sameDirectory(null, handle('b')), false);
    const noMethod = { name: '.workspec' };
    assert.equal(await sameDirectory(noMethod, noMethod), true);
    assert.equal(await sameDirectory(noMethod, handle('a')), false);
    const throwing = {
      async isSameEntry() {
        throw new Error('boom');
      },
    };
    assert.equal(await sameDirectory(throwing, handle('a')), false);
  });

  it('probeHandle only answers when permission is already granted', async () => {
    assert.equal(await probeHandle(handle('a', { permission: 'prompt' })), 'unknown');
    assert.equal(await probeHandle(handle('a', { permission: 'granted' })), 'ok');
    assert.equal(await probeHandle(handle('a', { permission: 'granted', missing: true })), 'missing');
    const broken = {
      async queryPermission() {
        throw new Error('odd');
      },
    };
    assert.equal(await probeHandle(broken), 'unknown');
  });

  it('isMissingError recognises the errors a gone directory raises', () => {
    assert.equal(isMissingError({ name: 'NotFoundError' }), true);
    assert.equal(isMissingError({ name: 'TypeMismatchError' }), true);
    assert.equal(isMissingError({ name: 'AbortError' }), false);
    assert.equal(isMissingError(null), false);
  });
});
