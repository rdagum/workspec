// ui/editor.js
// Split work-item editor (PROMPT.md §4.3, §9.2):
//   Left  — YAML metadata (structured form OR raw YAML toggle)
//   Right — Markdown body
//
// In the `floating` detail display the modal is too short to stack both panes,
// so the same two panes become tabs and only the active one is built. There the
// AI usage section (`agent`) gets a third tab of its own instead of sitting in
// the metadata form.
//
// Typing updates an in-memory working copy and refreshes only the small status
// strip in place — it never re-renders the editor, so input focus is preserved.
// Writing to disk is explicit: the Save button (or Ctrl+S), with a save-on-close
// safety net so edits are never lost. Field order and unknown fields are
// preserved by always working from a clone of the source `meta` and only
// overwriting the keys the form manages.
//
// The working copy is bound to one record at one `version` (state/store.js).
// When that record changes behind the editor's back (a drag/drop move of the
// open card) the copy is reloaded if clean, or has only the changed keys merged
// in if dirty, so a later save can never write a stale value back. Leaving the
// item (another card, Escape, reload...) goes through `leave()`: a save that
// fails or cannot be attempted asks Save / Discard / Cancel instead of dropping
// the buffer.

(function (WS) {
'use strict';

const { el, clear, renderMarkdown } = WS;
const { stringifyYaml, parseYaml, splitDocument, patchScalarLine } = WS;
const { mergeWorkingCopy } = WS;
const { validateItem, REQUIRED_FIELDS } = WS;
const { detailDisplay, isEpic } = WS;
const { itemUsage, runsOf, runCost, runTokens, resolveBudget, usageIssues, formatUsd, formatTokens, TOKEN_KINDS } = WS;

const KNOWN_TYPES = ['EPIC', 'STORY', 'TASK', 'BUG', 'SPIKE'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
// Fields the form shows but does not let the user hand-edit. `id` is immutable
// (SPEC.md §7.2); `created`/`updated` are managed automatically.
const READONLY_FIELDS = new Set(['id', 'created', 'updated']);

const LOSSY_NOTE = 'Raw YAML only: this front matter uses YAML the form would rewrite differently, so it is saved exactly as typed.';

// Sticky editor view preferences, persisted across page reloads.
const PREFS_KEY = 'workspec.editor.prefs';
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {}; // localStorage unavailable (e.g. private mode) — fall back to defaults
  }
}
function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore — preferences just won't persist */
  }
}
// AI usage section (SPEC.md §18.2): at most this many runs are listed, the rest
// summarised, so an epic's long history cannot flood the floating view.
const MAX_RUN_ROWS = 20;
const RUN_PURPOSES = ['plan', 'implement', 'review', 'feedback', 'triage'];
const TOKEN_COLUMNS = [
  ['input', 'in'],
  ['output', 'out'],
  ['cache_read', 'cache r'],
  ['cache_write', 'cache w'],
  ['cache_write_1h', 'cache w 1h'],
];

const isMapping = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));
const localToday = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Fields whose values are conventionally arrays — rendered as multiline inputs.
const ARRAY_FIELDS = new Set([
  'labels', 'depends_on', 'blocks', 'related', 'context',
  'affected_paths', 'related_files', 'acceptance_criteria', 'definition_of_done',
]);

class EditorView {
  /**
   * `confirmLeave({ id, reason })` asks the user what to do with edits that
   * could not be saved and resolves 'save' | 'discard' | 'cancel'. Without one
   * the editor cancels: it never discards on its own.
   */
  constructor(store, { confirmLeave } = {}) {
    this.store = store;
    this.confirmLeave = confirmLeave || (async () => 'cancel');
    this.root = el('aside', { class: 'editor', id: 'editor' });
    const prefs = loadPrefs();
    this.rawMode = !!prefs.rawMode;
    this.preview = !!prefs.preview;
    this.tab = ['body', 'usage'].includes(prefs.tab) ? prefs.tab : 'meta'; // only used by the floating layout
    this._dirty = false; // unsaved edits in the working copy
    this._path = null;
    this._version = undefined; // record.version the working copy was last in sync with
    this._base = null; // { meta, body } of the record at that version: what a merge compares against
    this._notice = null; // shown in the validation strip after an external change was merged
    this._saving = false; // our own save is in flight; its version bump is not an external change
    this._saveError = ''; // why the last save() returned false
  }

  _savePrefs() {
    savePrefs({ rawMode: this.rawMode, preview: this.preview, tab: this.tab });
  }

  _bind(record) {
    if (this._path !== record.path) return this._load(record);
    if (this._version === record.version) return;
    // The open record changed behind the editor (a drag/drop move, another
    // save): a clean working copy just reloads from it, a dirty one takes only
    // the keys that change touched.
    if (this._dirty) this._merge(record);
    else this._load(record);
  }

  /**
   * (Re)load the working copy from a record: a different item was opened, or
   * the same one changed while the copy had no edits. `rawMode` and `preview`
   * are sticky view preferences — preserved across items so that, e.g.,
   * choosing Markdown "Preview" keeps applying to the next card opened.
   */
  _load(record) {
    this._path = record.path;
    this._adopt(record);
    this.meta = clone(record.meta || {});
    this.body = record.body || '';
    this._rawText = null; // per-item raw buffer; rebuild from the new meta
    this._rawError = null;
    this._dirty = false;
    this._notice = null;
    // A lossy record (core/parser.js round-trip guard) is edited as its own
    // front-matter text, never as a form re-serialized from `meta`, and the
    // store saves that text verbatim.
    this._lossy = !!record.lossy;
    this._rawEdited = false;
    if (this._lossy) {
      const { frontMatter } = splitDocument(record.raw || '');
      this._rawText = frontMatter == null ? '' : frontMatter;
    }
  }

  /** Remember which version of the record the working copy is in sync with. */
  _adopt(record) {
    this._version = record.version;
    this._base = { meta: clone(record.meta || {}), body: record.body || '' };
  }

  /**
   * The record changed while the working copy has unsaved edits. Take the keys
   * that change touched and the user did not, keep every key the user edited
   * (see mergeWorkingCopy), and say what happened in the validation strip.
   */
  _merge(record) {
    const id = this._label();
    if (this._lossy) {
      // A lossy record is edited as raw text, which has no keys to merge by.
      this._version = record.version;
      this._notice = `${id} changed elsewhere. Your unsaved raw YAML is kept; saving it overwrites that change.`;
      return;
    }
    const { meta, body, applied, kept } = mergeWorkingCopy(
      this._base,
      { meta: this.meta, body: this.body },
      { meta: record.meta || {}, body: record.body || '' }
    );
    const unmerged = this._syncRaw(meta, applied, record);
    this.meta = meta;
    this.body = body;
    this._adopt(record);
    const parts = [];
    const merged = applied.filter((k) => !unmerged.includes(k));
    if (merged.length) parts.push(`${merged.join(', ')} ${merged.length === 1 ? 'was' : 'were'} merged into your edits`);
    if (kept.length) parts.push(`your unsaved edit of ${kept.join(', ')} was kept, so saving overwrites the change`);
    if (unmerged.length) {
      parts.push(`${unmerged.join(', ')} could not be applied to the YAML you are editing; set ${unmerged.length === 1 ? 'it' : 'them'} again`);
    }
    this._notice = parts.length ? `Changed elsewhere: ${parts.join('; ')}.` : null;
  }

  /**
   * Bring the raw-YAML buffer in line with a merged working copy. A buffer
   * that parses is regenerated from the merged `meta`. One that does not parse
   * keeps the user's text: scalar keys are patched into it line by line, and
   * any key that cannot be is returned so the notice can say so.
   */
  _syncRaw(meta, applied, record) {
    const keys = applied.filter((k) => k !== 'body');
    if (this._rawText == null || !keys.length) return [];
    if (!this._rawError) {
      this._rawText = stringifyYaml(meta);
      return [];
    }
    const scalar = (v) => v === null || v === undefined || typeof v !== 'object';
    const unmerged = [];
    for (const key of keys) {
      const value = (record.meta || {})[key];
      const wrapped = `---\n${this._rawText}\n---\n`;
      const patched = scalar(value) && scalar(this._base.meta[key]) && key in (record.meta || {})
        ? patchScalarLine(wrapped, key, value)
        : null;
      if (patched == null) {
        unmerged.push(key);
        continue;
      }
      this._rawText = patched.slice('---\n'.length, -'\n---\n'.length);
    }
    return unmerged;
  }

  _label() {
    return String((this.meta && this.meta.id) || (this._path || '').split('/').pop());
  }

  /** Raw YAML is the only metadata view of a lossy record. */
  _showRaw() {
    return this.rawMode || this._lossy;
  }

  render() {
    const record = this.store.selectedItem();
    clear(this.root);
    if (!record) {
      this.root.classList.remove('open');
      this.reset(); // no item is open, so there is no working copy to keep
      return this.root;
    }
    this._bind(record);
    this.root.classList.add('open');

    this.root.append(this._header(record));
    this.root.append(this._validation());
    if (detailDisplay(this.store.model) === 'floating') {
      // Tabs: one pane at a time, so the Markdown body gets the full modal.
      this.root.append(this._tabs());
      const pane =
        this.tab === 'body' ? this._bodyPane() : this.tab === 'usage' ? this._usagePane() : this._metaPane();
      this.root.append(el('div', { class: 'editor-panes tabbed' }, [pane]));
    } else {
      this.root.append(el('div', { class: 'editor-panes' }, [this._metaPane(), this._bodyPane()]));
    }
    return this.root;
  }

  /**
   * Called by the app on every store change that does not switch items: when
   * the open record has moved to a version this editor has not seen, rebind or
   * merge and redraw. The editor's own save is skipped; it adopts its version
   * itself once the write has finished.
   */
  sync() {
    if (this._saving) return;
    const record = this.store.selectedItem();
    if (!record || record.path !== this._path || record.version === this._version) return;
    this.render();
  }

  /**
   * Tab strip for the floating layout. Switching tabs only swaps the rendered
   * pane — `meta`, `body` and the raw-YAML buffer live on the working copy, so
   * nothing typed is lost (an invalid raw buffer keeps its error and its text).
   */
  _tabs() {
    const tab = (id, label) =>
      el('button', {
        class: 'tab' + (this.tab === id ? ' active' : ''),
        type: 'button',
        role: 'tab',
        'aria-selected': this.tab === id ? 'true' : 'false',
        onclick: () => {
          if (this.tab === id) return;
          this.tab = id;
          this._savePrefs();
          this.render();
        },
        text: label,
      });
    return el('div', { class: 'editor-tabs', role: 'tablist' }, [
      tab('meta', 'Metadata'),
      tab('body', 'Markdown'),
      tab('usage', 'AI usage'),
    ]);
  }

  /** True when `agent` is shown on the AI usage tab rather than in the metadata form. */
  _usageTabbed() {
    return detailDisplay(this.store.model) === 'floating';
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
        this._rawToggle(),
        // An EPIC can focus the board on itself (README "Epic focus").
        // Keyed on the saved record: the focus needs it to be an EPIC on disk.
        isEpic(record)
          ? el('button', {
              class: 'btn-toggle',
              title: 'Show only this epic and its items on the board',
              onclick: () => this._focusEpic(record),
              text: 'Focus on board',
            })
          : null,
        saveBtn,
        el('button', { class: 'btn-close', title: 'Close (Esc)', onclick: () => this._closeGuard(), text: '✕' }),
      ]),
    ]);
  }

  /** Form/raw switch; a lossy record has no form view, so it shows a disabled marker instead. */
  _rawToggle() {
    if (this._lossy) {
      return el('button', {
        class: 'btn-toggle',
        disabled: true,
        title: 'This front matter uses YAML the form would rewrite differently, so it is edited and saved as raw text.',
        text: 'Raw YAML only',
      });
    }
    return el('button', {
      class: 'btn-toggle',
      onclick: () => {
        if (!this.rawMode) {
          this._rawText = stringifyYaml(this.meta);
        } else {
          // Leaving raw mode — try to adopt edits.
          if (!this._commitRaw()) return;
        }
        this.rawMode = !this.rawMode;
        // Raw YAML lives on the Metadata tab; from the AI usage tab, go there.
        if (this.tab === 'usage') this.tab = 'meta';
        this._savePrefs();
        this.render();
      },
      text: this.rawMode ? 'Form view' : 'Raw YAML',
    });
  }

  _validation() {
    const record = { meta: this.meta, fileName: this._path.split('/').pop(), errors: [], warnings: [] };
    const stored = this.store.selectedItem();
    if (this._lossy && !this._rawEdited && stored) {
      // Until the raw text is edited, `meta` may be empty (the file did not
      // parse); show what loading the file reported instead.
      record.errors = [...(stored.errors || [])];
      record.warnings = [...(stored.warnings || [])];
    } else {
      validateItem(record, this.store.model.workflow);
      if (this._lossy) record.warnings.unshift(LOSSY_NOTE);
    }
    if (this._notice) record.warnings.unshift(this._notice);
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
    pane.append(this._showRaw() ? this._rawEditor() : this._form());
    return pane;
  }

  _rawEditor() {
    const ta = el('textarea', {
      class: 'raw-yaml' + (this._rawError ? ' invalid' : ''),
      spellcheck: 'false',
      oninput: (e) => {
        this._rawText = e.target.value;
        this._rawEdited = true;
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

    const tabbed = this._usageTabbed();
    for (const key of keys) {
      // With its own tab, a well-formed `agent` is edited there, not here.
      if (key === 'agent' && tabbed && this._usageEditable(this.meta[key])) continue;
      form.append(this._field(key, this.meta[key]));
    }
    // An item without `agent` can still get its first run from the form.
    if (!('agent' in this.meta) && !tabbed) form.append(this._usageSection());
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
    } else if (key === 'agent' && this._usageEditable(value)) {
      return this._usageSection();
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

  // --- AI usage section (SPEC.md §18.2) -------------------------------------

  /**
   * The AI usage tab of the floating layout. Its edits go to `this.meta`, so a
   * pending raw-YAML buffer is dropped (it already parsed into `this.meta`) and
   * the raw view is rebuilt from the edited working copy; while that buffer has
   * an error the section is withheld rather than edit stale values.
   */
  _usagePane() {
    const pane = el('div', { class: 'pane pane-usage' });
    const body = el('div', { class: 'usage-pane' });
    if (this._lossy) {
      body.append(el('div', { class: 'usage-hint', text: 'This item is edited as raw YAML only; change agent on the Metadata tab.' }));
    } else if (this._rawError) {
      body.append(el('div', { class: 'usage-hint', text: 'Fix the YAML errors on the Metadata tab first.' }));
    } else if ('agent' in this.meta && !this._usageEditable(this.meta.agent)) {
      body.append(
        el('div', {
          class: 'usage-hint',
          text: 'agent is not a mapping with a runs list, so it can only be edited in Raw YAML view.',
        })
      );
    } else {
      this._rawText = null;
      body.append(this._usageSection());
    }
    pane.append(body);
    return pane;
  }

  /** The structured section handles only the well-formed shape; anything else stays a read-only textarea. */
  _usageEditable(agent) {
    return isMapping(agent) && (!('runs' in agent) || Array.isArray(agent.runs));
  }

  /**
   * The `agent` namespace as a budget input, a spent line, the runs table and
   * an add-run form. Every number comes from core/usage.js; keys under `agent`
   * other than budget_usd and runs are left untouched in `this.meta`.
   */
  _usageSection() {
    const model = this.store.model;
    const section = el('div', { class: 'field usage-section' });
    const summary = el('div', { class: 'usage-summary' });
    const refreshSummary = () => summary.replaceChildren(...this._usageSummary().childNodes);

    const agent = isMapping(this.meta.agent) ? this.meta.agent : {};
    const budget = el('input', {
      class: 'field-input usage-budget',
      type: 'text',
      inputmode: 'decimal',
      'aria-label': 'Budget in USD',
      value: agent.budget_usd != null ? String(agent.budget_usd) : '',
    });
    const typeDefault = resolveBudget({ type: this.meta.type }, model.ai);
    if (typeDefault != null) budget.placeholder = String(typeDefault);
    budget.addEventListener('input', () => {
      const target = this._ensureAgent();
      if (budget.value.trim() === '') delete target.budget_usd;
      else target.budget_usd = coerce(budget.value.trim());
      this._markDirty();
      refreshSummary();
    });

    section.append(
      el('label', { class: 'field-label', text: 'agent — AI usage' }),
      el('div', { class: 'usage-budget-row' }, [
        el('span', { text: 'Budget' }),
        budget,
        el('span', {
          class: 'usage-hint',
          text: typeDefault != null ? `USD (default for ${this.meta.type}: ${typeDefault})` : 'USD',
        }),
      ]),
      summary
    );
    refreshSummary();

    const runs = runsOf(this.meta) || [];
    section.append(el('div', { class: 'usage-sub', text: `Runs (${runs.length})` }));
    section.append(
      runs.length ? this._runsTable(runs, model.ai) : el('div', { class: 'usage-hint', text: 'No runs recorded.' })
    );
    section.append(this._addRunForm(() => section.replaceWith(this._usageSection())));

    const other = Object.keys(agent).filter((k) => k !== 'budget_usd' && k !== 'runs');
    if (other.length) {
      section.append(
        el('div', { class: 'field-note', text: `Other keys (${other.join(', ')}) are kept; edit them in Raw YAML view.` })
      );
    }
    return section;
  }

  _ensureAgent() {
    if (!isMapping(this.meta.agent)) this.meta.agent = {};
    return this.meta.agent;
  }

  /** Spent / remaining / bar plus the item's usage warnings (the validation strip shows only errors). */
  _usageSummary() {
    const model = this.store.model;
    const box = el('div');
    const record = { meta: this.meta };
    const usage = itemUsage(record, model);
    if (usage) {
      let text = `Spent ${usage.priced ? formatUsd(usage.cost) : 'unpriced'}`;
      if (usage.budget != null) text += ` of ${formatUsd(usage.budget)}`;
      const row = el('div', { class: 'usage-spent' + (usage.overBudget ? ' over' : '') }, [el('span', { text })]);
      if (usage.budget != null && usage.cost != null) {
        const pct = usage.budget > 0 ? Math.round((usage.cost / usage.budget) * 100) : null;
        const bar = el('div', {
          class: 'usage-bar',
          role: 'img',
          'aria-label': pct == null ? 'budget is zero' : `${pct}% of budget`,
        });
        bar.append(el('div', { class: 'usage-bar-fill', style: `width: ${Math.min(100, pct == null ? 100 : pct)}%` }));
        row.append(bar);
        if (pct != null) row.append(el('span', { text: `${pct} %` }));
        if (usage.remaining != null && !usage.overBudget) {
          row.append(el('span', { class: 'usage-hint', text: `${formatUsd(usage.remaining)} remaining` }));
        }
      }
      box.append(row);
    }
    for (const issue of usageIssues(record, model)) {
      if (issue.level === 'warning') box.append(el('div', { class: 'v-warn', text: `⚠ ${issue.message}` }));
    }
    return box;
  }

  _runsTable(runs, ai) {
    const hidden = Math.max(0, runs.length - MAX_RUN_ROWS);
    const shown = runs.slice(hidden); // runs are appended, so these are the most recent
    const th = (t) => el('th', { text: t });
    const head = el('tr', {}, [
      th('date'), th('handle'), th('model'),
      ...TOKEN_COLUMNS.map(([, label]) => th(label)),
      th('cost'), th('ref'),
    ]);
    const body = el('tbody');
    let estimated = false;
    for (const run of shown) {
      const cost = runCost(run, ai);
      const tokens = runTokens(run);
      const est = run.estimated === true;
      estimated = estimated || est;
      const ref = run.ref == null ? '' : String(run.ref);
      const refCell = el('td');
      if (/^https?:\/\//i.test(ref)) {
        refCell.append(
          el('a', { href: ref, target: '_blank', rel: 'noopener noreferrer', text: ref.replace(/^https?:\/\/(www\.)?/i, '') })
        );
      } else {
        refCell.textContent = ref;
      }
      body.append(
        el('tr', {}, [
          el('td', { text: run.date == null ? '' : String(run.date) }),
          el('td', { text: run.handle == null ? '' : String(run.handle) }),
          el('td', { text: run.model == null ? '' : String(run.model) }),
          ...TOKEN_COLUMNS.map(([kind]) => el('td', { class: 'num', text: tokens[kind] ? formatTokens(tokens[kind]) : '' })),
          el('td', { class: 'num', text: (cost == null ? 'unpriced' : formatUsd(cost)) + (est ? ' ~' : '') }),
          refCell,
        ])
      );
    }
    const wrap = el('div', { class: 'usage-runs' }, [
      el('table', { class: 'usage-table' }, [el('thead', {}, [head]), body]),
    ]);
    if (hidden) {
      wrap.append(el('div', { class: 'usage-hint', text: `${hidden} earlier run${hidden === 1 ? '' : 's'} not shown; see Raw YAML.` }));
    }
    if (estimated) wrap.append(el('div', { class: 'usage-hint', text: '~ estimated' }));
    return wrap;
  }

  _addRunForm(onAdded) {
    const model = this.store.model;
    const users = model.users || [];
    const field = (label, input) => el('label', { class: 'usage-add-field' }, [el('span', { text: label }), input]);
    const text = (props) => el('input', { class: 'field-input', type: 'text', ...props });

    const date = text({ value: localToday(), 'aria-label': 'Run date' });
    const localHandle = (model.local || {}).handle || '';
    let handle;
    if (users.length) {
      handle = el('select', { class: 'field-input', 'aria-label': 'Run handle' });
      for (const u of users) handle.append(el('option', { value: u.handle }, u.handle));
      handle.value = users.some((u) => u.handle === localHandle) ? localHandle : users[0].handle;
    } else {
      handle = text({ value: localHandle, 'aria-label': 'Run handle' });
    }
    const runModel = text({ list: 'usage-models', placeholder: 'model', 'aria-label': 'Run model' });
    const datalist = el(
      'datalist',
      { id: 'usage-models' },
      Object.keys((model.ai && model.ai.pricing) || {}).map((m) => el('option', { value: m }))
    );
    const tokenInputs = {};
    for (const [kind, label] of TOKEN_COLUMNS) {
      tokenInputs[kind] = text({ inputmode: 'numeric', 'aria-label': `${label} tokens` });
    }
    const cost = text({ inputmode: 'decimal', placeholder: 'from pricing', 'aria-label': 'Cost in USD' });
    const purpose = el('select', { class: 'field-input', 'aria-label': 'Run purpose' });
    purpose.append(el('option', { value: '' }, '—'));
    for (const p of RUN_PURPOSES) purpose.append(el('option', { value: p }, p));
    const ref = text({ placeholder: 'PR URL or note', 'aria-label': 'Run reference' });
    const error = el('div', { class: 'v-error' });

    const add = el('button', {
      class: 'btn-mini',
      type: 'button',
      text: 'Add',
      onclick: () => {
        const run = { date: date.value.trim(), handle: handle.value.trim(), model: runModel.value.trim() };
        const missing = ['date', 'handle', 'model'].filter((k) => !run[k]);
        if (missing.length) {
          error.textContent = `✕ ${missing.join(', ')} required.`;
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(run.date)) {
          error.textContent = '✕ date must be YYYY-MM-DD.';
          return;
        }
        for (const [kind, field] of TOKEN_KINDS) {
          const v = tokenInputs[kind].value.trim();
          if (v === '') continue;
          if (!/^\d+$/.test(v)) {
            error.textContent = `✕ ${field} must be a whole number.`;
            return;
          }
          run[field] = parseInt(v, 10);
        }
        if (cost.value.trim() !== '') {
          if (!/^\d+(\.\d+)?$/.test(cost.value.trim())) {
            error.textContent = '✕ cost must be a non-negative number.';
            return;
          }
          run.cost_usd = coerce(cost.value.trim());
        }
        if (purpose.value) run.purpose = purpose.value;
        if (ref.value.trim()) run.ref = ref.value.trim();
        run.source = 'manual';
        const agent = this._ensureAgent();
        if (!Array.isArray(agent.runs)) agent.runs = [];
        agent.runs.push(run);
        this._markDirty();
        onAdded();
      },
    });

    return el('div', { class: 'usage-add' }, [
      el('div', { class: 'usage-sub', text: 'Add run' }),
      el('div', { class: 'usage-add-row' }, [field('date', date), field('handle', handle), field('model', runModel), datalist]),
      el('div', { class: 'usage-add-row' }, [
        field('input', tokenInputs.input),
        field('output', tokenInputs.output),
        field('cache read', tokenInputs.cache_read),
        field('cache write', tokenInputs.cache_write),
        field('cache write 1h', tokenInputs.cache_write_1h),
      ]),
      el('div', { class: 'usage-add-row' }, [field('cost', cost), field('purpose', purpose), field('ref', ref), add]),
      error,
    ]);
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
            this._savePrefs();
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

  /**
   * Persist the working copy to the single file (PROMPT.md §5.2). Resolves
   * true when the edits are on disk (or there was nothing to write) and false
   * when they are not: the write failed or the raw YAML does not parse. The
   * buffer is kept either way; `_saveError` says why a save did not happen.
   */
  async save() {
    if (!this._dirty) return true;
    if (this._rawError) {
      this._saveError = `the YAML does not parse (${this._rawError})`;
      this.store.set({ message: 'Cannot save: YAML has errors.' });
      return false;
    }
    this._saving = true;
    try {
      const raw = this._lossy ? this._rawText : null; // the store writes it verbatim
      const record = await this.store.saveItem(this._path, clone(this.meta), this.body, raw);
      this._dirty = false;
      this._notice = null;
      this._saveError = '';
      if (this._lossy) {
        // The store re-parsed the file (it may no longer be lossy); rebind to it.
        this._path = null;
        this.render();
        return true;
      }
      this._adopt(record);
      this._refreshStatus();
      return true;
    } catch (err) {
      this._saveError = err.message;
      this.store.set({ message: `Save failed: ${err.message}` });
      return false;
    } finally {
      this._saving = false;
    }
  }

  /**
   * Make the open item safe to leave. Resolves true when nothing is lost by
   * moving on: there were no edits, they were saved, or the user chose to
   * discard them. Resolves false when the user cancelled; the buffer is kept
   * and the caller must not navigate.
   */
  async leave() {
    while (!(await this.save())) {
      const choice = await this.confirmLeave({ id: this._label(), reason: this._saveError });
      if (choice === 'discard') {
        this.reset();
        return true;
      }
      if (choice !== 'save') return false;
    }
    return true;
  }

  /** Close the editor (✕, Escape, backdrop) unless leaving the item was cancelled. */
  async _closeGuard() {
    if (!(await this.leave())) return false;
    this.store.close();
    return true;
  }

  /** Focus the board on this epic; the floating modal covers the board, so close it first. */
  async _focusEpic(record) {
    if (detailDisplay(this.store.model) === 'floating' && !(await this._closeGuard())) return;
    this.store.setFilter('epic', String(record.meta.id));
  }

  /** Called by the app on Escape. */
  async handleEscape() {
    if (this.store.state.selectedPath) await this._closeGuard();
  }

  /** Drop the working copy so the next open rebinds from a fresh record. */
  reset() {
    this._path = null;
    this._version = undefined;
    this._base = null;
    this._dirty = false;
    this._rawText = null;
    this._rawError = null;
    this._notice = null;
    this._saveError = '';
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
