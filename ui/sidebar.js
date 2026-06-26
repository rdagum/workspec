// ui/sidebar.js
// Search, filters, context document list and the "new item" entry point
// (PROMPT.md §4.4, §4.6, §4.7). Pure rendering against the store.

(function (WS) {
'use strict';

const { el, clear } = WS;

class SidebarView {
  constructor(store, { onNewItem, onOpenContext } = {}) {
    this.store = store;
    this.onNewItem = onNewItem || (() => {});
    this.onOpenContext = onOpenContext || ((path) => this.store.openContext(path));
    this.root = el('aside', { class: 'sidebar', id: 'sidebar' });
  }

  render() {
    const store = this.store;
    clear(this.root);
    if (!store.model) {
      this.root.append(el('div', { class: 'sidebar-hint', text: 'Load a .workspec folder to begin.' }));
      return this.root;
    }

    const facets = store.facets();
    const f = store.state.filters;
    const total = store.allItems().length;
    const shown = store.filteredItems().length;

    // Create
    this.root.append(
      el('div', { class: 'sidebar-section' }, [
        el('button', { class: 'btn-primary btn-new', onclick: () => this.onNewItem(), text: '+ New work item' }),
      ])
    );

    // Search
    const search = el('input', {
      class: 'search-input',
      type: 'search',
      placeholder: 'Search id or title…',
      value: f.text,
    });
    search.addEventListener('input', () => store.setFilter('text', search.value));
    this.root.append(
      el('div', { class: 'sidebar-section' }, [el('label', { class: 'sb-label', text: 'Search' }), search])
    );

    // Filters
    const filters = el('div', { class: 'sidebar-section' }, [
      el('label', { class: 'sb-label', text: 'Filter' }),
      this._select('type', 'Type', facets.type, f.type),
      this._select('status', 'Status', facets.status, f.status),
      this._select('assignee', 'Assignee', facets.assignee, f.assignee),
      this._select('label', 'Label', facets.label, f.label),
      el('button', {
        class: 'btn-link',
        onclick: () => store.clearFilters(),
        text: 'Clear filters',
      }),
      el('div', { class: 'filter-count', text: `${shown} of ${total} shown` }),
    ]);
    this.root.append(filters);

    // Sort (fields configured in board.yaml)
    const sortSection = this._sortSection();
    if (sortSection) this.root.append(sortSection);

    // Context documents
    if (store.model.context.length) {
      const list = el('ul', { class: 'context-list' });
      for (const doc of store.model.context) {
        const active = store.state.contextPath === doc.path;
        list.append(
          el('li', {}, [
            el('button', {
              class: 'context-link' + (active ? ' active' : ''),
              onclick: () => this.onOpenContext(doc.path),
              text: doc.name,
            }),
          ])
        );
      }
      this.root.append(
        el('div', { class: 'sidebar-section' }, [
          el('label', { class: 'sb-label', text: 'Context' }),
          list,
        ])
      );
    }

    // Load problems
    if (store.model.loadErrors.length || store.model.warnings.length) {
      const box = el('div', { class: 'sidebar-section problems' }, [
        el('label', { class: 'sb-label', text: 'Repository notices' }),
      ]);
      for (const e of store.model.loadErrors) {
        box.append(el('div', { class: 'problem-error', text: `✕ ${e.file}: ${e.message}` }));
      }
      for (const w of store.model.warnings) {
        box.append(el('div', { class: 'problem-warn', text: `⚠ ${w}` }));
      }
      this.root.append(box);
    }

    return this.root;
  }

  _sortSection() {
    const sortCfg = (this.store.model.board && this.store.model.board.sort) || {};
    const fields = Array.isArray(sortCfg.fields) ? sortCfg.fields : [];
    if (!fields.length) return null;

    const cur = this.store.state.sort;
    const fieldSel = el('select', { class: 'filter-select' });
    fieldSel.append(el('option', { value: '' }, 'Default order'));
    for (const fld of fields) {
      fieldSel.append(el('option', { value: fld, selected: cur.field === fld }, fld));
    }
    fieldSel.value = cur.field || '';
    fieldSel.addEventListener('change', () => this.store.setSort({ field: fieldSel.value }));

    const dirBtn = el('button', {
      class: 'btn-link sort-dir',
      title: 'Toggle sort direction',
      onclick: () => this.store.setSort({ direction: cur.direction === 'asc' ? 'desc' : 'asc' }),
      text: cur.direction === 'asc' ? '↑ Ascending' : '↓ Descending',
    });
    dirBtn.disabled = !cur.field;

    return el('div', { class: 'sidebar-section' }, [
      el('label', { class: 'sb-label', text: 'Sort' }),
      fieldSel,
      dirBtn,
    ]);
  }

  _select(key, label, options, current) {
    const select = el('select', { class: 'filter-select' });
    select.append(el('option', { value: '' }, `All ${label.toLowerCase()}`));
    for (const opt of options) {
      select.append(el('option', { value: opt, selected: current === opt }, opt));
    }
    select.value = current || '';
    select.addEventListener('change', () => this.store.setFilter(key, select.value));
    return select;
  }
}

Object.assign(WS, { SidebarView });
})(window.WS = window.WS || {});
