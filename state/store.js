// state/store.js
//
// A tiny observable store. Holds the loaded model plus view state (filters,
// selection, dirty flags) and notifies subscribers on change. No framework,
// no magic — just a value bag and a listener set.
//
// Performance note (PROMPT.md §8): edits mutate the single affected record in
// place; the board re-derives columns from the existing item map rather than
// re-parsing files, so editing never triggers a full reload.

(function (WS) {
'use strict';

const { buildColumns, distinctValues, sortItems } = WS;
const { serializeItem, changeStatus, validateItem } = WS;
const { knownIds, lowestFreeBlock, appendBlockEntry, setLocalKeys, REGISTRY_PATH, LOCAL_PATH } = WS;

const emptyFilters = () => ({ text: '', type: '', status: '', assignee: '', label: '' });

class Store {
  constructor() {
    this.state = {
      fs: null,
      model: null,
      filters: emptyFilters(),
      sort: { field: '', direction: 'desc' }, // configured via board.yaml
      selectedPath: null, // open editor target
      contextPath: null, // open context doc
      dirty: false, // unsaved edits in the open editor
      status: 'idle', // idle | loading | ready | error
      message: '',
    };
    this._listeners = new Set();
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  emit() {
    for (const fn of this._listeners) fn(this.state);
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.emit();
  }

  // --- Derived selectors ---------------------------------------------------

  get model() {
    return this.state.model;
  }

  allItems() {
    return this.model ? [...this.model.items.values()] : [];
  }

  selectedItem() {
    if (!this.state.selectedPath || !this.model) return null;
    return this.model.items.get(this.state.selectedPath) || null;
  }

  /** Apply the active filters (PROMPT.md §4.6). */
  filteredItems() {
    const { filters } = this.state;
    const text = filters.text.trim().toLowerCase();
    return this.allItems().filter((r) => {
      const m = r.meta || {};
      if (filters.type && String(m.type) !== filters.type) return false;
      if (filters.status && String(m.status) !== filters.status) return false;
      if (filters.assignee && String(m.assignee || '') !== filters.assignee) return false;
      if (filters.label) {
        const labels = Array.isArray(m.labels) ? m.labels.map(String) : [];
        if (!labels.includes(filters.label)) return false;
      }
      if (text) {
        const id = String(m.id || '').toLowerCase();
        const title = String(m.title || '').toLowerCase();
        if (!id.includes(text) && !title.includes(text)) return false;
      }
      return true;
    });
  }

  /** Filtered items with the active sort applied. */
  sortedItems() {
    return sortItems(this.filteredItems(), this.state.sort.field, this.state.sort.direction);
  }

  columns() {
    return buildColumns(this.model, this.sortedItems());
  }

  facets() {
    const items = this.allItems();
    return {
      type: distinctValues(items, 'type'),
      status: this.model ? this.model.workflow : [],
      assignee: distinctValues(items, 'assignee'),
      label: distinctValues(items, 'labels'),
    };
  }

  // --- Mutations -----------------------------------------------------------

  setFilter(key, value) {
    this.state.filters = { ...this.state.filters, [key]: value };
    this.emit();
  }

  clearFilters() {
    this.state.filters = emptyFilters();
    this.emit();
  }

  setSort(patch) {
    this.state.sort = { ...this.state.sort, ...patch };
    this.emit();
  }

  open(path) {
    this.set({ selectedPath: path, contextPath: null, dirty: false });
  }

  close() {
    this.set({ selectedPath: null, dirty: false });
  }

  openContext(path) {
    this.set({ contextPath: path, selectedPath: null });
  }

  closeContext() {
    this.set({ contextPath: null });
  }

  /**
   * Persist an edited item. `meta`/`body` come from the editor. Only the one
   * file is rewritten (PROMPT.md §5.2). Re-validates and updates the record
   * in place so the board reflects changes without a reload.
   */
  async saveItem(path, meta, body) {
    const record = this.model.items.get(path);
    if (!record) throw new Error(`Unknown item: ${path}`);
    const text = serializeItem(meta, body);
    await this.state.fs.writeFile(path, text);
    record.raw = text;
    record.meta = meta;
    record.body = body;
    record.errors = [];
    record.warnings = [];
    validateItem(record, this.model.workflow);
    this.set({ dirty: false, message: `Saved ${meta.id || record.fileName}` });
    return record;
  }

  /**
   * Drag/drop status move — surgically rewrites only the `status:` line
   * (PROMPT.md §4.5). Returns false if nothing changed.
   */
  async moveItem(path, newStatus) {
    const record = this.model.items.get(path);
    if (!record) return false;
    if ((record.meta && record.meta.status) === newStatus) return false;
    const text = changeStatus(record, newStatus);
    await this.state.fs.writeFile(path, text);
    record.raw = text;
    record.meta = { ...record.meta, status: newStatus };
    validateItem(record, this.model.workflow);
    record.errors = [...new Set(record.errors)];
    this.emit();
    return true;
  }

  /** Insert a freshly created item record and write it to disk. */
  async addItem(path, meta, body) {
    const text = serializeItem(meta, body);
    await this.state.fs.writeFile(path, text);
    const record = {
      path,
      fileName: path.split('/').pop(),
      raw: text,
      meta,
      body,
      errors: [],
      warnings: [],
    };
    validateItem(record, this.model.workflow);
    this.model.items.set(path, record);
    if (meta.id && !this.model.itemsById.has(meta.id)) this.model.itemsById.set(meta.id, record);
    this.set({ selectedPath: path, dirty: false, message: `Created ${meta.id}` });
    return record;
  }

  /**
   * Claim the lowest free ID block for this working copy (SPEC.md §18.1):
   * append it to the committed registry and point the git-ignored local
   * config at it. Returns the new registry entry; the caller reminds the user
   * to commit the registry so no other clone can take the same block.
   */
  async claimIdBlock({ owner, label }) {
    const model = this.model;
    const fs = this.state.fs;
    const block = lowestFreeBlock(model.idBlocks, knownIds(model), model.idAllocation.blockSize);
    // Same date source as createItem's `created`, so the claim-date check in
    // validateRepository compares like with like (STORY-000005 moves both to local time).
    const entry = { block, owner, label, claimed: new Date().toISOString().slice(0, 10) };

    const registry = (await fs.exists(REGISTRY_PATH)) ? await fs.readFile(REGISTRY_PATH) : '';
    await fs.writeFile(REGISTRY_PATH, appendBlockEntry(registry, entry));

    const patch = {};
    if (!model.local.handle) patch.handle = owner;
    patch.id_block = block;
    const local = (await fs.exists(LOCAL_PATH)) ? await fs.readFile(LOCAL_PATH) : '';
    await fs.writeFile(LOCAL_PATH, setLocalKeys(local, patch));

    model.idBlocks.push(entry);
    model.local = { ...model.local, ...patch };
    // The clone now has a registered block, so those load-time notices are stale.
    model.loadErrors = model.loadErrors.filter(
      (e) => e.code !== 'unregistered-local-block' && e.code !== 'invalid-local-block'
    );
    this.emit();
    return entry;
  }

  /** Delete an item's file from disk and drop it from the model. */
  async deleteItem(path) {
    const record = this.model.items.get(path);
    await this.state.fs.deleteFile(path);
    this.model.items.delete(path);
    const id = record && record.meta && record.meta.id;
    if (id && this.model.itemsById.get(id) === record) this.model.itemsById.delete(id);
    const label = (record && record.meta && record.meta.id) || path.split('/').pop();
    const patch = { message: `Deleted ${label}` };
    if (this.state.selectedPath === path) patch.selectedPath = null; // close editor
    this.set(patch);
  }
}

Object.assign(WS, { Store });
})(window.WS = window.WS || {});
