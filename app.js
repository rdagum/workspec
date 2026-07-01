// app.js
// Application entry point. Wires the store to the views, handles repository
// loading via the filesystem abstraction, the create-item flow, the read-only
// context viewer, keyboard navigation and the toast/notice area.

(function (WS) {
'use strict';

const { WorkspecFS, isSupported } = WS;
const { loadRepository, detailDisplay } = WS;
const { Store } = WS;
const { BoardView } = WS;
const { EditorView } = WS;
const { SidebarView } = WS;
const { el, clear, renderMarkdown } = WS;
const { nextId } = WS;
const { CANONICAL_ORDER } = WS;

const store = new Store();
const editor = new EditorView(store);
// Flush unsaved edits to the currently open item before switching/creating, so
// navigation never silently drops changes.
async function flushOpenEditor() {
  if (store.state.selectedPath) await editor.save();
}
async function openItem(path) {
  if (store.state.selectedPath && store.state.selectedPath !== path) await flushOpenEditor();
  store.open(path);
}
const board = new BoardView(store, { onOpenItem: openItem, onDeleteItem: (path) => confirmDelete(path) });
const sidebar = new SidebarView(store, {
  onNewItem: () => openCreateDialog(),
  onOpenContext: async (path) => {
    await flushOpenEditor();
    store.openContext(path);
  },
});

const refs = {
  boardMount: document.getElementById('board-mount'),
  sidebarMount: document.getElementById('sidebar-mount'),
  editorMount: document.getElementById('editor-mount'),
  overlay: document.getElementById('overlay'),
  editorBackdrop: document.getElementById('editor-backdrop'),
  toast: document.getElementById('toast'),
  repoName: document.getElementById('repo-name'),
  boardName: document.getElementById('board-name'),
  openBtn: document.getElementById('open-btn'),
  refreshBtn: document.getElementById('refresh-btn'),
  themeBtn: document.getElementById('theme-btn'),
};

let lastMessage = '';

// --- Render loop -----------------------------------------------------------

let lastEditorKey;
store.subscribe((state) => {
  renderSidebarPreservingFocus();
  // Rebuilding the board resets scroll; capture and restore it so opening a card
  // (or saving/moving) doesn't jump the columns back to the top.
  const scroll = captureBoardScroll();
  refs.boardMount.replaceChildren(board.render());
  restoreBoardScroll(scroll);
  // Only (re)build the editor when the open item or open/closed state changes.
  // Rebuilding on every emit would destroy the focused input mid-typing; while
  // an item stays open the editor manages its own DOM in place.
  const editorKey = state.selectedPath || '';
  if (editorKey !== lastEditorKey) {
    refs.editorMount.replaceChildren(editor.render());
    lastEditorKey = editorKey;
  }
  renderContextOverlay();

  refs.repoName.textContent = state.model ? state.model.name : '';
  refs.boardName.textContent = state.model ? state.model.board.name || '' : 'WorkSpec';
  refs.refreshBtn.disabled = !state.fs || state.status === 'loading';
  document.body.classList.toggle('has-editor', !!state.selectedPath);
  // Item detail layout (side-panel-vertical | side-panel-horizontal | floating).
  const detailMode = state.model ? detailDisplay(state.model) : 'side-panel-vertical';
  document.body.dataset.detailDisplay = detailMode;
  // The floating layout needs a click-to-close backdrop behind the modal.
  refs.editorBackdrop.classList.toggle('open', detailMode === 'floating' && !!state.selectedPath);

  if (state.message && state.message !== lastMessage) {
    showToast(state.message);
    lastMessage = state.message;
  }
});

// --- Repository loading -----------------------------------------------------

async function openRepository() {
  if (!isSupported()) {
    showToast('This browser is not supported. Use a Chromium browser (Chrome/Edge).', 8000);
    return;
  }
  try {
    store.set({ status: 'loading', message: '' });
    const fs = await WorkspecFS.open();
    if (!(await fs.ensurePermission())) {
      store.set({ status: 'idle' });
      return;
    }
    const model = await loadRepository(fs);
    applyTheme(model.local && model.local.theme);
    store.set({ fs, model, sort: sortDefault(model), status: 'ready', selectedPath: null, contextPath: null });
    const errs = model.loadErrors.length;
    showToast(
      `Loaded ${model.items.size} item(s)` + (errs ? `, ${errs} file error(s)` : ''),
      errs ? 6000 : 3000
    );
  } catch (err) {
    if (err && err.name === 'AbortError') {
      store.set({ status: 'idle' });
      return;
    }
    store.set({ status: 'error' });
    showToast(`Could not load repository: ${err.message}`, 8000);
    console.error(err);
  }
}

// Re-read config, items, templates and context from the already-open folder
// (no re-pick). Pending edits are saved first so a reload never loses them.
async function refreshRepository() {
  if (!store.state.fs) return;
  try {
    await flushOpenEditor();
    store.set({ status: 'loading' });
    const model = await loadRepository(store.state.fs);
    applyTheme(model.local && model.local.theme);
    editor.reset(); // working copy is stale after reload — rebind on next open
    store.set({ model, status: 'ready', selectedPath: null, contextPath: null });
    const errs = model.loadErrors.length;
    showToast(
      `Reloaded ${model.items.size} item(s)` + (errs ? `, ${errs} file error(s)` : ''),
      errs ? 6000 : 2500
    );
  } catch (err) {
    store.set({ status: 'error' });
    showToast(`Reload failed: ${err.message}`, 8000);
    console.error(err);
  }
}

// --- Create work item -------------------------------------------------------

function openCreateDialog() {
  const model = store.model;
  if (!model) return;

  const templates = model.templates;
  const typeOptions = templates.length
    ? templates
    : ['STORY', 'TASK', 'BUG', 'EPIC', 'SPIKE'].map((t) => ({ name: t, type: t, meta: null, body: '' }));

  const typeSelect = el('select', { class: 'field-input', id: 'create-type' });
  for (const t of typeOptions) {
    typeSelect.append(el('option', { value: t.name }, `${t.type}${t.name !== t.type ? ` (${t.name})` : ''}`));
  }
  const titleInput = el('input', { class: 'field-input', type: 'text', placeholder: 'Title…' });

  const previewId = el('code', { class: 'create-id-preview' });
  const updatePreview = () => {
    const sel = typeOptions.find((t) => t.name === typeSelect.value) || typeOptions[0];
    const ids = [...model.items.keys()].map((p) => p.split('/').pop().replace(/\.md$/i, ''));
    previewId.textContent = nextId(sel.type, ids);
  };
  typeSelect.addEventListener('change', updatePreview);
  updatePreview();

  const form = el('div', { class: 'modal' }, [
    el('h2', { text: 'New work item' }),
    el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Type / template' }), typeSelect]),
    el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Title' }), titleInput]),
    el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Generated ID' }), previewId]),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn-link', onclick: () => closeOverlay(), text: 'Cancel' }),
      el('button', {
        class: 'btn-primary',
        onclick: async () => {
          const sel = typeOptions.find((t) => t.name === typeSelect.value) || typeOptions[0];
          await createItem(sel, titleInput.value.trim());
        },
        text: 'Create',
      }),
    ]),
  ]);

  showOverlay(form);
  titleInput.focus();
}

async function createItem(template, title) {
  const model = store.model;
  const ids = [...model.items.keys()].map((p) => p.split('/').pop().replace(/\.md$/i, ''));
  const id = nextId(template.type, ids);
  const today = new Date().toISOString().slice(0, 10);

  // Start from template metadata (if any), then enforce identity/required fields
  // in canonical order (SPEC.md §8).
  const base = template.meta ? JSON.parse(JSON.stringify(template.meta)) : {};
  const meta = {};
  for (const key of CANONICAL_ORDER) {
    if (key in base) meta[key] = base[key];
  }
  for (const key of Object.keys(base)) {
    if (!(key in meta)) meta[key] = base[key]; // keep any extra template fields
  }
  meta.id = id;
  meta.type = template.type;
  meta.title = title || 'Untitled';
  if (!meta.status) meta.status = model.workflow[0] || 'Backlog';
  meta.created = today;
  meta.updated = today;
  if (!meta.spec_version) meta.spec_version = model.specVersion || '1.0';
  // Ensure required keys exist even if no template was used.
  for (const k of ['priority', 'labels']) if (!(k in meta)) meta[k] = k === 'labels' ? [] : null;

  // Seed people fields from local preferences (config/user.local.yaml, SPEC §14).
  const local = model.local || {};
  const me = local.default_assignee || local.name;
  if (me) {
    if (meta.assignee == null || meta.assignee === '') meta.assignee = local.default_assignee || me;
    if (meta.reporter == null || meta.reporter === '') meta.reporter = local.default_assignee || me;
  }

  const body = template.body || '# Summary\n\n';
  const path = `items/${id}.md`;

  try {
    if (await store.state.fs.exists(path)) {
      showToast(`${id} already exists.`, 5000);
      return;
    }
    await flushOpenEditor(); // don't lose edits on the currently open item
    await store.addItem(path, meta, body);
    closeOverlay();
  } catch (err) {
    showToast(`Create failed: ${err.message}`, 6000);
  }
}

// --- Delete work item -------------------------------------------------------

function confirmDelete(path) {
  const id = path.split('/').pop().replace(/\.md$/i, '');
  const dialog = el('div', { class: 'modal' }, [
    el('h2', { text: 'Delete work item' }),
    el('p', { text: `Permanently delete ${id}? This removes the file from disk and cannot be undone.` }),
    el('div', { class: 'modal-actions' }, [
      el('button', { class: 'btn-link', onclick: () => closeOverlay(), text: 'Cancel' }),
      el('button', {
        class: 'btn-danger',
        onclick: async () => {
          try {
            await store.deleteItem(path);
            closeOverlay();
          } catch (err) {
            showToast(`Delete failed: ${err.message}`, 6000);
          }
        },
        text: 'Delete',
      }),
    ]),
  ]);
  showOverlay(dialog);
}

// --- Context overlay (read-only) -------------------------------------------

async function renderContextOverlay() {
  const path = store.state.contextPath;
  if (!path) return;
  // Render once per open.
  if (refs.overlay.dataset.context === path) return;
  refs.overlay.dataset.context = path;
  try {
    const text = await store.state.fs.readFile(path);
    const doc = el('div', { class: 'modal modal-context' }, [
      el('header', { class: 'context-header' }, [
        el('h2', { text: path.split('/').pop() }),
        el('button', { class: 'btn-close', onclick: () => closeOverlay(), text: '✕' }),
        el('span', { class: 'readonly-tag', text: 'read-only' }),
      ]),
      el('div', { class: 'markdown context-body', html: renderMarkdown(text) }),
    ]);
    showOverlay(doc, { keepContext: true });
  } catch (err) {
    showToast(`Could not open context: ${err.message}`, 5000);
    store.closeContext();
  }
}

// --- Preferences -----------------------------------------------------------

// Theme resolution order: a manual toggle (persisted in localStorage) wins over
// the repo's user.local.yaml value, which in turn falls back to dark.
const THEME_KEY = 'workspec.theme';
function storedTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null; // localStorage unavailable (e.g. private mode)
  }
}
function setTheme(theme) {
  document.body.dataset.theme = theme === 'light' ? 'light' : 'dark';
  refs.themeBtn.textContent = theme === 'light' ? '☾' : '☀';
  refs.themeBtn.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
}
function applyTheme(configTheme) {
  setTheme(storedTheme() || configTheme || 'dark');
}
function toggleTheme() {
  const next = document.body.dataset.theme === 'light' ? 'dark' : 'light';
  setTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore — the choice just won't persist across reloads */
  }
}

// Initial sort from board.yaml's `sort.default` (falls back to unsorted/desc).
function sortDefault(model) {
  const d = (model.board && model.board.sort && model.board.sort.default) || {};
  return { field: d.field || '', direction: d.direction === 'asc' ? 'asc' : 'desc' };
}

// Re-render the sidebar while keeping the search box focused and its caret in
// place — otherwise live filtering would steal focus on every keystroke.
function renderSidebarPreservingFocus() {
  const active = document.activeElement;
  const wasSearch = active && active.classList && active.classList.contains('search-input');
  const caret = wasSearch ? [active.selectionStart, active.selectionEnd] : null;
  refs.sidebarMount.replaceChildren(sidebar.render());
  if (wasSearch) {
    const input = refs.sidebarMount.querySelector('.search-input');
    if (input) {
      input.focus();
      if (caret[0] != null) {
        try { input.setSelectionRange(caret[0], caret[1]); } catch { /* non-text input */ }
      }
    }
  }
}

// Board scroll preservation across re-render (keyed by column status).
function captureBoardScroll() {
  const lists = {};
  refs.boardMount.querySelectorAll('.column-list').forEach((l) => {
    lists[l.dataset.status] = l.scrollTop;
  });
  return { left: refs.boardMount.scrollLeft, lists };
}
function restoreBoardScroll(scroll) {
  refs.boardMount.scrollLeft = scroll.left;
  refs.boardMount.querySelectorAll('.column-list').forEach((l) => {
    const top = scroll.lists[l.dataset.status];
    if (top != null) l.scrollTop = top;
  });
}

// --- Overlay & toast plumbing ----------------------------------------------

function showOverlay(content, { keepContext = false } = {}) {
  clear(refs.overlay);
  refs.overlay.append(content);
  refs.overlay.classList.add('open');
  if (!keepContext) refs.overlay.dataset.context = '';
  refs.overlay.onclick = (e) => {
    if (e.target === refs.overlay) closeOverlay();
  };
}

function closeOverlay() {
  refs.overlay.classList.remove('open');
  clear(refs.overlay);
  refs.overlay.dataset.context = '';
  if (store.state.contextPath) store.closeContext();
}

let toastTimer = null;
function showToast(message, ms = 3000) {
  refs.toast.textContent = message;
  refs.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => refs.toast.classList.remove('show'), ms);
}

// --- Keyboard --------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (refs.overlay.classList.contains('open')) {
      closeOverlay();
    } else if (store.state.selectedPath) {
      editor.handleEscape();
    }
    return;
  }
  // Ctrl+S / Cmd+S saves the open item.
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    if (store.state.selectedPath) {
      e.preventDefault();
      editor.save();
    }
  }
});

refs.openBtn.addEventListener('click', openRepository);
refs.refreshBtn.addEventListener('click', refreshRepository);
refs.themeBtn.addEventListener('click', toggleTheme);
// Clicking the floating-mode backdrop closes the open item (save-on-close guarded).
refs.editorBackdrop.addEventListener('click', () => editor.handleEscape());

// Apply any persisted theme immediately, before a repository is opened.
applyTheme();

// Surface unsupported browsers immediately.
if (!isSupported()) {
  document.body.classList.add('unsupported');
}

store.emit(); // initial paint
})(window.WS = window.WS || {});
