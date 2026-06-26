// core/filesystem.js
//
// The single abstraction layer over file access (PROMPT.md §7). Every read and
// write in the application goes through a WorkspecFS instance. The only backend
// is the browser File System Access API (Chromium), per the chosen build target.
//
// The user picks the `.workspec` directory itself; this class exposes typed
// helpers for the well-known sub-directories and caches handles so that saving
// a single edited file never re-walks the tree.

(function (WS) {
'use strict';

function isSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

class WorkspecFS {
  constructor(rootHandle) {
    this.root = rootHandle; // FileSystemDirectoryHandle for `.workspec/`
    this.name = rootHandle.name;
    this._fileHandles = new Map(); // relPath -> FileSystemFileHandle
    this._dirHandles = new Map(); // relPath -> FileSystemDirectoryHandle
    this._dirHandles.set('', rootHandle);
  }

  /** Prompt the user to select a `.workspec` directory. */
  static async open() {
    if (!isSupported()) {
      throw new Error('This browser does not support the File System Access API.');
    }
    const handle = await window.showDirectoryPicker({ id: 'workspec', mode: 'readwrite' });
    return new WorkspecFS(handle);
  }

  /** Ensure we still hold read/write permission, re-prompting if necessary. */
  async ensurePermission() {
    const opts = { mode: 'readwrite' };
    if ((await this.root.queryPermission(opts)) === 'granted') return true;
    return (await this.root.requestPermission(opts)) === 'granted';
  }

  async _getDirHandle(relPath, { create = false } = {}) {
    if (this._dirHandles.has(relPath)) return this._dirHandles.get(relPath);
    const parts = relPath.split('/').filter(Boolean);
    let dir = this.root;
    let built = '';
    for (const part of parts) {
      built = built ? `${built}/${part}` : part;
      if (this._dirHandles.has(built)) {
        dir = this._dirHandles.get(built);
        continue;
      }
      dir = await dir.getDirectoryHandle(part, { create });
      this._dirHandles.set(built, dir);
    }
    return dir;
  }

  /** True if a sub-directory exists directly under the root. */
  async hasDir(name) {
    try {
      await this.root.getDirectoryHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List files within a sub-directory (non-recursive), filtered by extension.
   * Returns [{ name, path, handle }]. Missing directories yield an empty list.
   */
  async listFiles(dirPath, { ext = null } = {}) {
    let dir;
    try {
      dir = await this._getDirHandle(dirPath);
    } catch {
      return [];
    }
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue;
      if (ext && !name.toLowerCase().endsWith(ext)) continue;
      const path = `${dirPath}/${name}`;
      this._fileHandles.set(path, handle);
      out.push({ name, path, handle });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  async _getFileHandle(path, { create = false } = {}) {
    if (this._fileHandles.has(path) && !create) return this._fileHandles.get(path);
    const segments = path.split('/');
    const fileName = segments.pop();
    const dir = await this._getDirHandle(segments.join('/'), { create });
    const handle = await dir.getFileHandle(fileName, { create });
    this._fileHandles.set(path, handle);
    return handle;
  }

  /** Read a UTF-8 text file by repository-relative path. */
  async readFile(path) {
    const handle = await this._getFileHandle(path);
    const file = await handle.getFile();
    return await file.text();
  }

  /** Write a UTF-8 text file, creating it (and parent dirs) if needed. */
  async writeFile(path, content) {
    const handle = await this._getFileHandle(path, { create: true });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  /** True if a file exists at the given path. */
  async exists(path) {
    try {
      await this._getFileHandle(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Delete a file by repository-relative path. */
  async deleteFile(path) {
    const segments = path.split('/');
    const fileName = segments.pop();
    const dir = await this._getDirHandle(segments.join('/'));
    await dir.removeEntry(fileName);
    this._fileHandles.delete(path);
  }
}

Object.assign(WS, { isSupported, WorkspecFS });
})(window.WS = window.WS || {});
