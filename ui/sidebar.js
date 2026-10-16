// ui/sidebar.js
// Search, filters, context document list and the "new item" entry point
// (PROMPT.md §4.4, §4.6, §4.7). Pure rendering against the store.

(function (WS) {
'use strict';

const { el, clear, NO_EPIC } = WS;
const { runsOf, formatUsd, formatTokens, USAGE_PERIODS } = WS;

// Which collapsible sections the viewer has closed, persisted across reloads.
const COLLAPSED_KEY = 'workspec.sidebar.collapsed';
function loadCollapsed() {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY));
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set(); // localStorage unavailable — every section starts open
  }
}
function saveCollapsed(set) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore — the choice just won't persist */
  }
}

class SidebarView {
  constructor(store, { onNewItem, onOpenContext } = {}) {
    this.store = store;
    this.onNewItem = onNewItem || (() => {});
    this.onOpenContext = onOpenContext || ((path) => this.store.openContext(path));
    this.root = el('aside', { class: 'sidebar', id: 'sidebar' });
    this.collapsed = loadCollapsed();
  }

  /**
   * A sidebar section the viewer can fold away. The sidebar re-renders on
   * every store change, so the open state lives on the view, not the DOM.
   * `hint` is shown beside the label only while the section is closed, so a
   * folded section still says what it is doing to the board.
   */
  _collapsible(id, label, children, { className = '', hint = '' } = {}) {
    const open = !this.collapsed.has(id);
    const details = el('details', { class: `sidebar-section collapsible ${className}`.trim(), open }, [
      el('summary', { class: 'sb-label sb-summary' }, [
        el('span', { text: label }),
        hint ? el('span', { class: 'sb-hint', text: hint }) : null,
      ]),
      ...children,
    ]);
    details.addEventListener('toggle', () => {
      if (details.open === !this.collapsed.has(id)) return;
      if (details.open) this.collapsed.delete(id);
      else this.collapsed.add(id);
      saveCollapsed(this.collapsed);
    });
    return details;
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

    // Epics (README "Epic focus"): focus the board on one epic
    const epics = this._epicSection();
    if (epics) this.root.append(epics);

    // Filters
    const filtered = ['type', 'status', 'priority', 'assignee', 'label'].some((k) => f[k]);
    const filters = this._collapsible('filter', 'Filter', [
      this._select('type', 'Type', facets.type, f.type),
      this._select('status', 'Status', facets.status, f.status),
      this._select('priority', 'Priority', facets.priority, f.priority),
      this._select('assignee', 'Assignee', facets.assignee, f.assignee),
      this._select('label', 'Label', facets.label, f.label),
      el('button', {
        class: 'btn-link',
        onclick: () => store.clearFilters(),
        text: 'Clear filters',
      }),
      el('div', { class: 'filter-count', text: `${shown} of ${total} shown` }),
    ], { hint: filtered ? `${shown} of ${total}` : '' });
    this.root.append(filters);

    // AI usage totals of the filtered items
    const usage = this._usageSection();
    if (usage) this.root.append(usage);

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

  /**
   * The repository's EPIC items as a focus list with done/total progress, a
   * "No epic" entry, and a toggle for epics in the last workflow column. The
   * numbers come from store.epicList(); this only formats them. Omitted when
   * the repository has no EPIC items.
   */
  _epicSection() {
    const store = this.store;
    const { entries, hiddenDone, noEpicCount, hasEpics } = store.epicList();
    if (!hasEpics) return null;
    const focused = store.state.filters.epic;

    const entry = (value, label, title, count, tooltip) =>
      el('li', {}, [
        el('button', {
          class: 'context-link epic-link' + (focused === value ? ' active' : ''),
          title: tooltip,
          'aria-pressed': focused === value ? 'true' : 'false',
          onclick: () => store.toggleEpicFocus(value),
        }, [
          label ? el('span', { class: 'epic-id', text: label }) : null,
          el('span', { class: 'epic-title', text: title }),
          el('span', { class: 'epic-count', text: count }),
        ]),
      ]);

    const list = el('ul', { class: 'context-list epic-list' });
    for (const e of entries) {
      list.append(
        entry(e.id, e.id, e.title || '(untitled)', `${e.done}/${e.total}`,
          `${e.id} — ${e.title}\n${e.done} of ${e.total} item(s) done. Click to ${focused === e.id ? 'show all items' : 'focus the board on this epic'}.`)
      );
    }
    list.append(
      entry(NO_EPIC, '', 'No epic', String(noEpicCount),
        'Items that belong to no epic. Click to ' + (focused === NO_EPIC ? 'show all items.' : 'show only these.'))
    );

    const toggle = el('input', { type: 'checkbox', checked: store.state.showDoneEpics });
    toggle.addEventListener('change', () => store.setShowDoneEpics(toggle.checked));
    const showDone = el('label', { class: 'epic-show-done' }, [
      toggle,
      el('span', { text: hiddenDone && !store.state.showDoneEpics ? `Show done (${hiddenDone})` : 'Show done' }),
    ]);

    return this._collapsible('epics', 'Epics', [list, showDone], {
      hint: focused ? (focused === NO_EPIC ? 'No epic' : String(focused)) : '',
    });
  }

  /**
   * Total cost and tokens of the filtered items' runs, by column and by
   * handle, limited to a period by run date. All numbers come from
   * store.usageTotals() (core/usage.js summarize); this only formats them.
   * Omitted when no item in the repository carries runs.
   */
  _usageSection() {
    const store = this.store;
    if (!store.allItems().some((r) => runsOf(r.meta))) return null;
    const totals = store.usageTotals();

    const period = el('select', { class: 'filter-select', 'aria-label': 'Usage period' });
    for (const [value, label] of USAGE_PERIODS) {
      period.append(el('option', { value, selected: store.state.usagePeriod === value }, label));
    }
    period.value = store.state.usagePeriod;
    period.addEventListener('change', () => store.setUsagePeriod(period.value));

    const money = (t) => (t.priced ? formatUsd(t.cost) : `≥ ${formatUsd(t.knownCost)}`);
    const row = (label, t) =>
      el('li', { class: 'usage-row', title: `${t.runs} run${t.runs === 1 ? '' : 's'}` + (t.priced ? '' : `; ${t.unpricedRuns} unpriced`) }, [
        el('span', { class: 'usage-row-label', text: label || '(none)' }),
        el('span', { class: 'usage-row-tokens', text: `${formatTokens(t.totalTokens)} tok` }),
        el('span', { class: 'usage-row-cost', text: money(t) }),
      ]);
    const list = (title, map, order) => {
      const keys = Object.keys(map).filter((k) => map[k].runs > 0);
      if (!keys.length) return null;
      if (order) keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      return el('div', {}, [
        el('div', { class: 'usage-sub', text: title }),
        el('ul', { class: 'usage-list' }, keys.map((k) => row(k, map[k]))),
      ]);
    };

    return this._collapsible('usage', 'AI usage', [
      period,
      totals.runs === 0
        ? el('div', { class: 'filter-count', text: 'No runs in this period.' })
        : el('div', { class: 'usage-total' }, [
            el('strong', { text: money(totals) }),
            el('span', { class: 'usage-hint', text: ` · ${formatTokens(totals.totalTokens)} tok · ${totals.runs} run${totals.runs === 1 ? '' : 's'}` }),
          ]),
      totals.runs ? list('By column', totals.byStatus, store.model.workflow) : null,
      totals.runs ? list('By handle', totals.byHandle) : null,
    ], { className: 'sidebar-usage', hint: totals.runs ? money(totals) : '' });
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
