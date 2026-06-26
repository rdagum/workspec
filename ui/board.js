// ui/board.js
// Kanban board rendering and drag/drop (PROMPT.md §4.2, §4.5).
// Columns come from the workflow config; cards are filtered work items.

(function (WS) {
'use strict';

const { el, clear } = WS;

const TYPE_CLASS = {
  EPIC: 'type-epic',
  STORY: 'type-story',
  TASK: 'type-task',
  BUG: 'type-bug',
  SPIKE: 'type-spike',
};

class BoardView {
  constructor(store, { onOpenItem, onDeleteItem } = {}) {
    this.store = store;
    // Opening goes through a handler so the app can flush unsaved edits to the
    // previously open item first; falls back to a plain open.
    this.onOpenItem = onOpenItem || ((path) => this.store.open(path));
    this.onDeleteItem = onDeleteItem || (() => {});
    this.root = el('div', { class: 'board', id: 'board' });
  }

  render() {
    const store = this.store;
    clear(this.root);
    if (!store.model) {
      this.root.append(this._emptyState());
      return this.root;
    }

    const { columns, orphans } = store.columns();
    const cols = [...columns];
    if (orphans.length) cols.push({ name: '⚠ Unknown status', items: orphans, orphan: true });

    for (const col of cols) {
      this.root.append(this._renderColumn(col));
    }
    return this.root;
  }

  _renderColumn(col) {
    const list = el('div', { class: 'column-list', dataset: { status: col.name } });

    if (!col.orphan) {
      list.addEventListener('dragover', (e) => {
        e.preventDefault(); // required so the column is a valid drop target
        e.dataTransfer.dropEffect = 'move';
        list.classList.add('drag-over');
      });
      list.addEventListener('dragleave', (e) => {
        // dragleave also fires when moving onto a child card; only clear the
        // highlight when the pointer truly leaves the column.
        if (!list.contains(e.relatedTarget)) list.classList.remove('drag-over');
      });
      list.addEventListener('drop', async (e) => {
        e.preventDefault();
        list.classList.remove('drag-over');
        const path = e.dataTransfer.getData('text/plain');
        if (!path) return;
        try {
          const moved = await this.store.moveItem(path, col.name);
          if (moved) this.store.set({ message: `Moved to ${col.name}` });
        } catch (err) {
          this.store.set({ message: `Move failed: ${err.message}` });
        }
      });
    }

    for (const record of col.items) list.append(this._renderCard(record));

    return el('section', { class: 'column' + (col.orphan ? ' column-orphan' : '') }, [
      el('header', { class: 'column-header' }, [
        el('span', { class: 'column-title', text: col.name }),
        el('span', { class: 'column-count', text: String(col.items.length) }),
      ]),
      list,
    ]);
  }

  _renderCard(record) {
    const m = record.meta || {};
    const type = String(m.type || '').toUpperCase();
    const hasErrors = record.errors && record.errors.length > 0;

    const card = el('article', {
      class: 'card' + (hasErrors ? ' card-error' : ''),
      dataset: { path: record.path },
      tabindex: '0',
      role: 'button',
      title: hasErrors ? record.errors.join('\n') : 'Open',
    });
    // Set the IDL property (not the attribute): `draggable` is an enumerated
    // attribute, so `draggable=""` would map to "auto" and an <article> would
    // not be draggable. Assigning the property reliably enables HTML5 drag.
    card.draggable = !hasErrors;

    card.addEventListener('click', () => this.onOpenItem(record.path));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.onOpenItem(record.path);
      }
    });
    if (!hasErrors) {
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', record.path);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    }

    const del = el('button', {
      class: 'card-delete',
      title: 'Delete item',
      'aria-label': `Delete ${m.id || record.fileName}`,
      text: '🗑',
    });
    // Don't let the delete button open the card or start a drag.
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onDeleteItem(record.path);
    });
    del.addEventListener('pointerdown', (e) => e.stopPropagation());

    const idLine = el('div', { class: 'card-id-row' }, [
      el('span', { class: `card-type ${TYPE_CLASS[type] || ''}`, text: type || '—' }),
      el('span', { class: 'card-id', text: String(m.id || record.fileName) }),
      del,
    ]);

    card.append(idLine);
    card.append(el('div', { class: 'card-title', text: String(m.title || '(untitled)') }));

    const metaRow = el('div', { class: 'card-meta' });
    if (m.priority) {
      metaRow.append(
        el('span', { class: `pill priority-${String(m.priority).toLowerCase()}`, text: String(m.priority) })
      );
    }
    if (m.assignee) metaRow.append(el('span', { class: 'pill assignee', text: `@${m.assignee}` }));
    if (Array.isArray(m.labels)) {
      for (const label of m.labels) metaRow.append(el('span', { class: 'pill label', text: String(label) }));
    }
    if (metaRow.childNodes.length) card.append(metaRow);

    if (hasErrors) {
      card.append(el('div', { class: 'card-error-badge', text: `⚠ ${record.errors.length} error(s)` }));
    }
    return card;
  }

  _emptyState() {
    return el('div', { class: 'board-empty' }, [
      el('h2', { text: 'No repository loaded' }),
      el('p', { text: 'Open a .workspec folder to get started.' }),
    ]);
  }
}

Object.assign(WS, { BoardView });
})(window.WS = window.WS || {});
