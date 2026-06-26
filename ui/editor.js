// ui/editor.js
// Split work-item editor (PROMPT.md §4.3, §9.2):
//   Left  — YAML metadata (structured form OR raw YAML toggle)
//   Right — Markdown body
//
// Typing updates an in-memory working copy and refreshes only the small status
// strip in place — it never re-renders the editor, so input focus is preserved.
// Writing to disk is explicit: the Save button (or Ctrl+S), with a save-on-close
// safety net so edits are never lost. Field order and unknown fields are
// preserved by always working from a clone of the source `meta` and only
// overwriting the keys the form manages.

(function (WS) {
'use strict';

const { el, clear, renderMarkdown } = WS;
const { stringifyYaml, parseYaml } = WS;
const { validateItem, REQUIRED_FIELDS } = WS;

const KNOWN_TYPES = ['EPIC', 'STORY', 'TASK', 'BUG', 'SPIKE'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
// Fields the form shows but does not let the user hand-edit. `id` is immutable
// (SPEC.md §7.2); `created`/`updated` are managed automatically.
const READONLY_FIELDS = new Set(['id', 'created', 'updated']);
// Fields whose values are conventionally arrays — rendered as multiline inputs.
const ARRAY_FIELDS = new Set([
  'labels', 'depends_on', 'blocks', 'related', 'context',
  'affected_paths', 'related_files', 'acceptance_criteria', 'definition_of_done',
]);

class EditorView {
  constructor(store) {
    this.store = store;
    this.root = el('aside', { class: 'editor', id: 'editor' });
    this.rawMode = false;
    this.preview = false;
    this._dirty = false; // unsaved edits in the working copy
    this._path = null;
  }

  _bind(record) {
    // (Re)load working copy when a different item is opened.
    if (this._path !== record.path) {
      this._path = record.path;
      this.meta = JSON.parse(JSON.stringify(record.meta || {}));
      this.body = record.body || '';
      this.rawMode = false;
      this.preview = false;
      this._rawError = null;
      this._dirty = false;
    }
  }

  render() {
    const record = this.store.selectedItem();
    clear(this.root);
    if (!record) {
      this.root.classList.remove('open');
      return this.root;
    }
    this._bind(record);
    this.root.classList.add('open');

    this.root.append(this._header(record));
    this.root.append(this._validation());
    const panes = el('div', { class: 'editor-panes' }, [this._metaPane(), this._bodyPane()]);
    this.root.append(panes);
    return this.root;
  }

  _header(record) {
    const m = this.meta;
    const saveBtn = el('button', {
      class: 'btn-save',
      title: 'Save (Ctrl+S)',
      onclick: () => this.save(),
      text: 'Save',
    });
    saveBtn.disabled = !this._dirty;

    return el('header', { class: 'editor-header' }, [
      el('div', { class: 'editor-title' }, [
        el('span', { class: 'editor-id', text: String(m.id || record.fileName) }),
        el('span', {
          class: 'save-indicator ' + (this._dirty ? 'dirty' : 'saved'),
          text: this._dirty ? '● Unsaved' : '✓ Saved',
        }),
      ]),
      el('div', { class: 'editor-actions' }, [
        el('button', {
          class: 'btn-toggle',
          onclick: () => {
            if (!this.rawMode) {
              this._rawText = stringifyYaml(this.meta);
            } else {
              // Leaving raw mode — try to adopt edits.
              if (!this._commitRaw()) return;
            }
            this.rawMode = !this.rawMode;
            this.render();
          },
          text: this.rawMode ? 'Form view' : 'Raw YAML',
        }),
        saveBtn,
        el('button', { class: 'btn-close', title: 'Close (Esc)', onclick: () => this._closeGuard(), text: '✕' }),
      ]),
    ]);
  }

  _validation() {
    const record = { meta: this.meta, fileName: this._path.split('/').pop(), errors: [], warnings: [] };
    validateItem(record, this.store.model.workflow);
    if (this._rawError) record.errors.unshift(`YAML: ${this._rawError}`);
    if (!record.errors.length && !record.warnings.length) return el('div', { class: 'validation ok', text: '' });
    const box = el('div', { class: 'validation ' + (record.errors.length ? 'has-error' : 'has-warn') });
    for (const e of record.errors) box.append(el('div', { class: 'v-error', text: `✕ ${e}` }));
    for (const w of record.warnings) box.append(el('div', { class: 'v-warn', text: `⚠ ${w}` }));
    return box;
  }

  // --- Left pane: metadata -------------------------------------------------

  _metaPane() {
    const pane = el('div', { class: 'pane pane-meta' });
    pane.append(el('div', { class: 'pane-label', text: 'Metadata' }));
    pane.append(this.rawMode ? this._rawEditor() : this._form());
    return pane;
  }

  _rawEditor() {
    const ta = el('textarea', {
      class: 'raw-yaml' + (this._rawError ? ' invalid' : ''),
      spellcheck: 'false',
      oninput: (e) => {
        this._rawText = e.target.value;
        try {
          this.meta = parseYaml(e.target.value) || {};
          this._rawError = null;
        } catch (err) {
          this._rawError = err.message;
        }
        this._markDirty();
      },
    });
    ta.value = this._rawText != null ? this._rawText : stringifyYaml(this.meta);
    return ta;
  }

  _commitRaw() {
    if (this._rawText == null) return true;
    try {
      this.meta = parseYaml(this._rawText) || {};
      this._rawError = null;
      return true;
    } catch (err) {
      this._rawError = err.message;
      this.render();
      return false;
    }
  }

  _form() {
    const form = el('div', { class: 'meta-form' });
    // Preserve source key order; ensure required fields show even if missing.
    const keys = [...Object.keys(this.meta)];
    for (const r of REQUIRED_FIELDS) if (!keys.includes(r)) keys.push(r);

    for (const key of keys) {
      form.append(this._field(key, this.meta[key]));
    }
    return form;
  }

  _field(key, value) {
    const row = el('div', { class: 'field' });
    row.append(el('label', { class: 'field-label', text: key }));

    let input;
    if (key === 'status') {
      input = el('select', { class: 'field-input' });
      for (const col of this.store.model.workflow) {
        input.append(el('option', { value: col, selected: value === col }, col));
      }
      input.value = value || '';
      input.addEventListener('change', () => this._setMeta(key, input.value));
    } else if (key === 'type') {
      input = el('select', { class: 'field-input' });
      const types = [...new Set([...KNOWN_TYPES, value].filter(Boolean))];
      for (const t of types) input.append(el('option', { value: t, selected: value === t }, t));
      input.addEventListener('change', () => this._setMeta(key, input.value));
    } else if (key === 'priority') {
      input = el('select', { class: 'field-input' });
      input.append(el('option', { value: '' }, '—'));
      const opts = [...new Set([...PRIORITIES, value].filter(Boolean))];
      for (const p of opts) input.append(el('option', { value: p, selected: value === p }, p));
      input.value = value || '';
      input.addEventListener('change', () => this._setMeta(key, input.value || null));
    } else if (key === 'assignee' && (this.store.model.users || []).length) {
      // Dropdown sourced from config/users.yaml; keeps an unknown current value.
      const users = this.store.model.users;
      const cur = value == null ? '' : String(value);
      input = el('select', { class: 'field-input' });
      input.append(el('option', { value: '' }, '— unassigned —'));
      for (const u of users) {
        const label = u.name && u.name !== u.handle ? `${u.name} (${u.handle})` : u.handle;
        input.append(el('option', { value: u.handle, selected: cur === u.handle }, label));
      }
      if (cur && !users.some((u) => u.handle === cur)) {
        input.append(el('option', { value: cur, selected: true }, `${cur} (not in users.yaml)`));
      }
      input.value = cur;
      input.addEventListener('change', () => this._setMeta(key, input.value || null));
    } else if (Array.isArray(value) || ARRAY_FIELDS.has(key)) {
      const arr = Array.isArray(value) ? value : [];
      input = el('textarea', { class: 'field-input field-array', rows: String(Math.max(1, arr.length)) });
      input.value = arr.join('\n');
      input.placeholder = 'one per line';
      input.addEventListener('input', () => {
        const items = input.value.split('\n').map((s) => s.trim()).filter((s) => s !== '');
        this._setMeta(key, items);
      });
    } else if (value !== null && typeof value === 'object') {
      // Nested namespaces (extensions/custom/agent) — preserved, edit via raw.
      input = el('textarea', { class: 'field-input field-nested', rows: '3', readonly: true });
      input.value = stringifyYaml(value);
      const note = el('div', { class: 'field-note', text: 'Edit nested fields in Raw YAML view.' });
      row.append(input, note);
      return row;
    } else if (typeof value === 'string' && value.includes('\n')) {
      input = el('textarea', { class: 'field-input', rows: '4' });
      input.value = value;
      input.addEventListener('input', () => this._setMeta(key, input.value));
    } else {
      input = el('input', { class: 'field-input', type: 'text', value: value == null ? '' : String(value) });
      if (READONLY_FIELDS.has(key)) {
        input.readOnly = true;
        input.classList.add('readonly');
        input.title = key === 'id' ? 'IDs are immutable' : 'Managed automatically';
      } else {
        input.addEventListener('input', () => this._setMeta(key, input.value === '' ? null : coerce(input.value)));
      }
    }
    row.append(input);
    return row;
  }

  // --- Right pane: markdown ------------------------------------------------

  _bodyPane() {
    const pane = el('div', { class: 'pane pane-body' });
    pane.append(
      el('div', { class: 'pane-label' }, [
        'Markdown',
        el('button', {
          class: 'btn-mini',
          onclick: () => {
            this.preview = !this.preview;
            this.render();
          },
          text: this.preview ? 'Edit' : 'Preview',
        }),
      ])
    );
    if (this.preview) {
      pane.append(el('div', { class: 'md-preview markdown', html: renderMarkdown(this.body) }));
    } else {
      const ta = el('textarea', { class: 'md-editor', spellcheck: 'false' });
      ta.value = this.body;
      ta.addEventListener('input', () => {
        this.body = ta.value;
        this._markDirty();
      });
      pane.append(ta);
    }
    return pane;
  }

  // --- Persistence ---------------------------------------------------------

  _setMeta(key, value) {
    this.meta[key] = value;
    this._markDirty();
  }

  /** Mark the working copy dirty and refresh only the status strip in place. */
  _markDirty() {
    this._dirty = true;
    this._refreshStatus();
  }

  /**
   * Targeted, in-place refresh of the validation strip, the unsaved indicator
   * and the Save button — WITHOUT rebuilding the editor (so focus is kept).
   */
  _refreshStatus() {
    const old = this.root.querySelector('.validation');
    if (old) old.replaceWith(this._validation());
    const ind = this.root.querySelector('.save-indicator');
    if (ind) {
      ind.className = 'save-indicator ' + (this._dirty ? 'dirty' : 'saved');
      ind.textContent = this._dirty ? '● Unsaved' : '✓ Saved';
    }
    const btn = this.root.querySelector('.btn-save');
    if (btn) btn.disabled = !this._dirty;
  }

  /** Persist the working copy to the single file (PROMPT.md §5.2). */
  async save() {
    if (!this._dirty) return;
    if (this._rawError) {
      this.store.set({ message: 'Cannot save: YAML has errors.' });
      return;
    }
    try {
      await this.store.saveItem(this._path, JSON.parse(JSON.stringify(this.meta)), this.body);
      this._dirty = false;
      this._refreshStatus();
    } catch (err) {
      this.store.set({ message: `Save failed: ${err.message}` });
    }
  }

  async _closeGuard() {
    // Safety net: persist pending edits on close so nothing is lost.
    if (this._dirty && !this._rawError) await this.save();
    this.store.close();
  }

  /** Called by the app on Escape. */
  async handleEscape() {
    if (this.store.state.selectedPath) await this._closeGuard();
  }

  /** Drop the working copy so the next open rebinds from a fresh record (used on reload). */
  reset() {
    this._path = null;
    this._dirty = false;
    this._rawError = null;
  }
}

// Coerce a free-text scalar into boolean/number/string where unambiguous.
function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  return v;
}

Object.assign(WS, { EditorView });
})(window.WS = window.WS || {});
