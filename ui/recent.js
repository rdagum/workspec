// ui/recent.js
// The "Recent repositories" list (docs/REVIEW-2026-09.md F1). Rendered twice
// from the same function: in the board's empty state and in the topbar
// open-button menu. Pure rendering — entries come from the store and every
// action goes back through a callback, so no persistence lives here.

(function (WS) {
'use strict';

const { el } = WS;

/** "just now", "5 min ago", "3 h ago", "2 days ago", then a plain date. */
function relativeTime(ts, now = Date.now()) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Build the list.
 *   entries          [{ key, name, dirName, lastOpened, unavailable }], newest first
 *   autoReopen       current value of the "reopen last repository" preference
 *   onOpen(entry)    reopen this entry (permission prompt, no picker)
 *   onForget(entry)  remove this entry from the list
 *   onSetAutoReopen(bool)
 *   heading          set false to omit the "Recent repositories" title
 */
function renderRecentList({ entries = [], autoReopen = false, onOpen, onForget, onSetAutoReopen, heading = true }) {
  const root = el('div', { class: 'recent' });
  if (heading) root.append(el('h3', { class: 'recent-title', text: 'Recent repositories' }));

  if (!entries.length) {
    root.append(el('p', { class: 'recent-empty', text: 'Repositories you open are listed here for one-click reopening.' }));
  } else {
    const list = el('ul', { class: 'recent-list' });
    for (const entry of entries) list.append(renderEntry(entry, { onOpen, onForget }));
    root.append(list);
  }

  const checkbox = el('input', { type: 'checkbox', class: 'recent-auto-input' });
  checkbox.checked = !!autoReopen;
  checkbox.addEventListener('change', () => onSetAutoReopen && onSetAutoReopen(checkbox.checked));
  root.append(
    el('label', { class: 'recent-auto', title: 'On page load, reopen the most recent repository (one permission click may still be needed)' }, [
      checkbox,
      'Reopen the last repository automatically',
    ])
  );
  return root;
}

function renderEntry(entry, { onOpen, onForget }) {
  const unavailable = !!entry.unavailable;
  const subtitle = unavailable
    ? 'Unavailable — the folder was moved or deleted. Click to retry, or remove it.'
    : [entry.dirName, entry.lastOpened ? `opened ${relativeTime(entry.lastOpened)}` : '']
        .filter(Boolean)
        .join(' · ');

  const open = el('button', {
    class: 'recent-open',
    title: unavailable ? `Retry ${entry.name}` : `Reopen ${entry.name}`,
    onclick: () => onOpen && onOpen(entry),
  }, [
    el('span', { class: 'recent-name', text: entry.name || entry.dirName || '(unnamed)' }),
    el('span', { class: 'recent-sub', text: subtitle }),
  ]);
  const forget = el('button', {
    class: 'recent-forget',
    title: 'Remove from recent repositories',
    'aria-label': `Remove ${entry.name} from recent repositories`,
    text: '✕',
    onclick: () => onForget && onForget(entry),
  });
  return el('li', { class: 'recent-entry' + (unavailable ? ' unavailable' : ''), dataset: { key: entry.key } }, [open, forget]);
}

Object.assign(WS, { renderRecentList, relativeTime });
})(window.WS = window.WS || {});
