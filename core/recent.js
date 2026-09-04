// core/recent.js
//
// Remembered repositories (docs/REVIEW-2026-09.md §2 F1, §1.2 A6).
//
// A FileSystemDirectoryHandle is structured-cloneable, so the handle of every
// successfully opened `.workspec` directory is stored in IndexedDB together
// with the repository name. On the next visit the app lists those entries and
// reopens one with a single permission prompt instead of the directory picker.
//
// The IndexedDB code is behind a three-method adapter (getAll / put / delete)
// so the list logic — newest first, the cap, de-duplication by directory
// identity — is plain JavaScript that the Node test suite drives with an
// in-memory adapter. This is a browser-side cache of handles, never project
// data: nothing here is written into the repository (SKILL.md, "Repository
// Rules"), and only the native File System Access backend uses it.

(function (WS) {
'use strict';

const DB_NAME = 'workspec';
const DB_VERSION = 1;
const STORE_NAME = 'recent';
/** How many repositories are remembered; the oldest is evicted beyond this. */
const MAX_RECENT = 8;

/** Promise wrapper over an IDBRequest. */
function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * IndexedDB adapter: a single object store keyed by `key`. The database is
 * opened lazily on first use so a browser without IndexedDB (or a blocked
 * storage partition) only fails when the feature is actually touched.
 */
class IndexedDbStore {
  constructor(indexedDB) {
    this.idb = indexedDB;
    this._db = null;
  }

  static available() {
    return typeof window !== 'undefined' && !!window.indexedDB;
  }

  async _open() {
    if (this._db) return this._db;
    const req = this.idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    const db = await request(req);
    // Another tab upgrading the schema: drop our connection so it can proceed.
    db.onversionchange = () => {
      db.close();
      this._db = null;
    };
    this._db = db;
    return db;
  }

  async _transaction(mode, fn) {
    const db = await this._open();
    const tx = db.transaction(STORE_NAME, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
    const result = await fn(tx.objectStore(STORE_NAME));
    await done;
    return result;
  }

  getAll() {
    return this._transaction('readonly', (store) => request(store.getAll()));
  }

  put(record) {
    return this._transaction('readwrite', (store) => request(store.put(record)));
  }

  delete(key) {
    return this._transaction('readwrite', (store) => request(store.delete(key)));
  }
}

function newKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * True when two directory handles point at the same directory. Uses the
 * platform's `isSameEntry` (which needs no permission); anything else — a
 * missing method, a handle that can no longer be compared — counts as a
 * different directory, so at worst a repository is listed twice, never lost.
 */
async function sameDirectory(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (typeof a.isSameEntry !== 'function') return false;
  try {
    return !!(await a.isSameEntry(b));
  } catch {
    return false;
  }
}

/**
 * Check whether a remembered handle still resolves, without prompting. That is
 * only possible while permission is already granted (a handle opened in this
 * session, or a grant the browser persisted); otherwise the answer stays
 * 'unknown' until the user clicks the entry. Returns 'ok' | 'missing' | 'unknown'.
 */
async function probeHandle(handle) {
  try {
    if ((await handle.queryPermission({ mode: 'read' })) !== 'granted') return 'unknown';
    // Touching the directory listing is the cheapest operation that fails
    // when the directory was deleted, moved or renamed.
    await handle.keys().next();
    return 'ok';
  } catch (err) {
    return isMissingError(err) ? 'missing' : 'unknown';
  }
}

/** True for the errors a handle raises once its directory is gone. */
function isMissingError(err) {
  const name = err && err.name;
  return name === 'NotFoundError' || name === 'TypeMismatchError' || name === 'InvalidStateError';
}

/**
 * The list of remembered repositories, newest first. Records look like
 *   { key, name, dirName, handle, lastOpened, unavailable }
 * where `name` is the board name shown to the user, `dirName` the picked
 * directory's own name (normally `.workspec`) and `lastOpened` a timestamp.
 */
class RecentRepositories {
  constructor(store, { max = MAX_RECENT, now = () => Date.now() } = {}) {
    this.store = store;
    this.max = max;
    this.now = now;
  }

  /** All remembered repositories, most recently opened first. */
  async list() {
    const records = await this.store.getAll();
    return records
      .filter((r) => r && r.key && r.handle)
      .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
  }

  /**
   * Record a successful open. The same directory (by `isSameEntry`) keeps its
   * key, takes the new name and moves to the top; a new directory is added and
   * the oldest entries beyond the cap are dropped. Returns the stored record.
   */
  async remember({ handle, name }) {
    const existing = await this.list();
    let previous = null;
    for (const r of existing) {
      if (await sameDirectory(r.handle, handle)) {
        previous = r;
        break;
      }
    }
    const record = {
      key: previous ? previous.key : newKey(),
      name: name || handle.name,
      dirName: handle.name,
      handle,
      lastOpened: this.now(),
      unavailable: false,
    };
    await this.store.put(record);
    const others = existing.filter((r) => r.key !== record.key);
    for (const stale of others.slice(this.max - 1)) await this.store.delete(stale.key);
    return record;
  }

  /** Drop one entry. Unknown keys are ignored. */
  async forget(key) {
    await this.store.delete(key);
  }

  /** Flag (or clear the flag on) an entry whose directory no longer resolves. */
  async setUnavailable(key, unavailable = true) {
    const record = (await this.store.getAll()).find((r) => r && r.key === key);
    if (!record) return null;
    record.unavailable = !!unavailable;
    await this.store.put(record);
    return record;
  }
}

Object.assign(WS, { RecentRepositories, IndexedDbStore, MAX_RECENT, probeHandle, isMissingError, sameDirectory });
})(window.WS = window.WS || {});
