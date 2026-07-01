// core/model.js
//
// Loads a `.workspec` repository through the filesystem abstraction and builds
// the in-memory model: work items, workflow columns, board config, templates,
// and context documents (PROMPT.md §4.1). Loading is resilient — one bad file
// never stops the rest.

(function (WS) {
'use strict';

const { parseItem, parseConfig, validateItem } = WS;

const SUPPORTED_MAJOR = 1;

const DEFAULT_WORKFLOW = ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'];

// Item detail layouts, configurable via board.yaml `settings.detail_display`.
const DETAIL_DISPLAY_MODES = ['side-panel-vertical', 'side-panel-horizontal', 'floating'];

/** Chosen detail layout, falling back to the current side-panel-vertical default. */
function detailDisplay(model) {
  const v = model && model.board && model.board.settings && model.board.settings.detail_display;
  return DETAIL_DISPLAY_MODES.includes(v) ? v : 'side-panel-vertical';
}

function coerceColumns(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && Array.isArray(raw.columns)) return raw.columns.map(String);
  return null;
}

/**
 * Read the whole repository. Returns a model object:
 *   { fs, board, workflow, items: Map, templates: [], context: [], loadErrors: [] }
 */
async function loadRepository(fs) {
  const model = {
    fs,
    name: fs.name,
    board: { name: fs.name, settings: {} },
    workflow: [...DEFAULT_WORKFLOW],
    specVersion: null,
    items: new Map(),
    templates: [],
    context: [],
    users: [],
    local: {},
    loadErrors: [],
    warnings: [],
  };

  // --- Configuration -------------------------------------------------------
  try {
    if (await fs.exists('config/workflow.yaml')) {
      const text = await fs.readFile('config/workflow.yaml');
      const { data, error } = parseConfig(text);
      if (error) model.loadErrors.push({ file: 'config/workflow.yaml', message: error });
      const cols = coerceColumns(data);
      if (cols && cols.length) model.workflow = cols;
    } else {
      model.warnings.push('config/workflow.yaml not found — using default columns.');
    }
  } catch (err) {
    model.loadErrors.push({ file: 'config/workflow.yaml', message: err.message });
  }

  try {
    if (await fs.exists('config/board.yaml')) {
      const text = await fs.readFile('config/board.yaml');
      const { data, error } = parseConfig(text);
      if (error) model.loadErrors.push({ file: 'config/board.yaml', message: error });
      model.board = { ...model.board, ...data };
      if (data.name) model.board.name = data.name;
      if (data.spec_version != null) model.specVersion = String(data.spec_version);
      // Workflow may alternatively be declared inline on the board.
      const inlineCols = coerceColumns(data.columns);
      if (inlineCols && inlineCols.length && model.workflow === DEFAULT_WORKFLOW) {
        model.workflow = inlineCols;
      }
    } else {
      model.warnings.push('config/board.yaml not found.');
    }
  } catch (err) {
    model.loadErrors.push({ file: 'config/board.yaml', message: err.message });
  }

  // Users roster (optional) — powers the assignee dropdown.
  try {
    if (await fs.exists('config/users.yaml')) {
      const { data, error } = parseConfig(await fs.readFile('config/users.yaml'));
      if (error) model.loadErrors.push({ file: 'config/users.yaml', message: error });
      const list = Array.isArray(data) ? data : Array.isArray(data.users) ? data.users : [];
      model.users = list
        .map((u) => (typeof u === 'string' ? { handle: u, name: u } : { handle: u.handle || u.name, name: u.name || u.handle }))
        .filter((u) => u.handle);
    }
  } catch (err) {
    model.loadErrors.push({ file: 'config/users.yaml', message: err.message });
  }

  // Local user preferences (optional, git-ignored) — defaults + theme (SPEC.md §14).
  try {
    if (await fs.exists('config/user.local.yaml')) {
      const { data, error } = parseConfig(await fs.readFile('config/user.local.yaml'));
      if (error) model.loadErrors.push({ file: 'config/user.local.yaml', message: error });
      model.local = data || {};
    }
  } catch (err) {
    model.loadErrors.push({ file: 'config/user.local.yaml', message: err.message });
  }

  // Compatibility check (SPEC.md §16).
  if (model.specVersion) {
    const major = parseInt(String(model.specVersion).split('.')[0], 10);
    if (Number.isFinite(major) && major > SUPPORTED_MAJOR) {
      throw new Error(
        `Unsupported spec_version ${model.specVersion}. This implementation supports WorkSpec ${SUPPORTED_MAJOR}.x.`
      );
    }
  }

  // --- Work items ----------------------------------------------------------
  const itemFiles = await fs.listFiles('items', { ext: '.md' });
  for (const f of itemFiles) {
    try {
      const raw = await fs.readFile(f.path);
      const record = parseItem(f.path, raw);
      validateItem(record, model.workflow); // re-validate now that we know columns
      // De-duplicate the workflow validation message added during parse vs now.
      record.errors = [...new Set(record.errors)];
      model.items.set(record.path, record);
    } catch (err) {
      model.loadErrors.push({ file: f.path, message: err.message });
    }
  }

  // --- Templates -----------------------------------------------------------
  const templateFiles = await fs.listFiles('templates', { ext: '.md' });
  for (const f of templateFiles) {
    try {
      const raw = await fs.readFile(f.path);
      const record = parseItem(f.path, raw);
      const type =
        (record.meta && record.meta.type) ||
        f.name.replace(/\.md$/i, '').toUpperCase();
      model.templates.push({
        name: f.name.replace(/\.md$/i, ''),
        type: String(type).toUpperCase(),
        path: f.path,
        meta: record.meta || {},
        body: record.body || '',
      });
    } catch (err) {
      model.loadErrors.push({ file: f.path, message: err.message });
    }
  }

  // --- Context documents (read-only) --------------------------------------
  const contextFiles = await fs.listFiles('context', { ext: '.md' });
  for (const f of contextFiles) {
    model.context.push({ name: f.name.replace(/\.md$/i, ''), path: f.path });
  }

  return model;
}

/** Group items into ordered workflow columns. Items with an unknown status are surfaced separately. */
function buildColumns(model, items) {
  const columns = model.workflow.map((name) => ({ name, items: [] }));
  const byName = new Map(columns.map((c) => [c.name, c]));
  const orphans = [];
  for (const record of items) {
    const status = record.meta && record.meta.status;
    const col = byName.get(status);
    if (col) col.items.push(record);
    else orphans.push(record);
  }
  return { columns, orphans };
}

// Priority is categorical, not lexical — rank it so "descending" means the most
// urgent first. Unknown/blank priorities rank lowest.
const PRIORITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

/** Value used to compare a record on a given sort field. */
function sortValue(record, field) {
  const v = record.meta ? record.meta[field] : undefined;
  if (field === 'priority') return PRIORITY_RANK[String(v).toLowerCase()] || 0;
  return v;
}

/**
 * Return a new array of items sorted by `field` ('asc' | 'desc'). An empty
 * `field` leaves the order untouched. Missing values always sort to the end.
 */
function sortItems(items, field, direction) {
  if (!field) return items;
  const dir = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = sortValue(a, field);
    const bv = sortValue(b, field);
    const aMissing = av == null || av === '';
    const bMissing = bv == null || bv === '';
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1; // missing last regardless of direction
    if (bMissing) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

/** Distinct values for a metadata field across all items, for filter dropdowns. */
function distinctValues(items, field) {
  const set = new Set();
  for (const r of items) {
    const v = r.meta && r.meta[field];
    if (Array.isArray(v)) v.forEach((x) => x != null && x !== '' && set.add(String(x)));
    else if (v != null && v !== '') set.add(String(v));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

Object.assign(WS, { SUPPORTED_MAJOR, loadRepository, buildColumns, distinctValues, sortItems, detailDisplay });
})(window.WS = window.WS || {});
