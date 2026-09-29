# WorkSpec — Epic Focus on the Board: Design

**Written:** 2026-09-29
**Status:** accepted design; requirement in `PROMPT.md` §4.6, implementation tracked by EPIC-001001 (STORY-001005 … STORY-001007)
**Scope:** a sidebar filter that narrows the board to one epic and everything under it, so the epic can be worked and finished as a project. Viewer only: no change to `SPEC.md` or to the file format.

---

## Summary

The board shows every item in its status column. Once a repository has several epics, the columns mix all of them and there is no way to see one epic's remaining work at a glance. The only hierarchy cue today is the `↳ PARENT-ID` link on a card (`ui/board.js`).

This design adds an **Epics** section to the sidebar: a list of the repository's `EPIC` items with progress counts. Clicking one *focuses* the board on it — the columns then show only the epic and the items that reach it through `parent`. The focus is one more filter: it combines with the existing ones and "Clear filters" resets it.

---

## 1. Decisions

### 1.1 Placement: a sidebar list, not a board column

A left-hand "Epics" column was considered and rejected:

- Every board column is a workflow status and a drop target. A non-status column next to Backlog invites dropping a card onto an epic to set its `parent` — either a dead end or a second editing path to maintain.
- It takes horizontal space from the status columns people actually work in; the sidebar is already always visible.
- Every other filter lives in the sidebar and shares `setFilter` / `clearFilters` in `state/store.js`.

The sidebar section is a *list* (not a `<select>` like the other filters) because it carries progress and is meant to be scanned, which matches the always-visible intent of the original proposal.

### 1.2 What the list shows: items with `type: EPIC` only

The list contains exactly the items whose `type` is `EPIC` — the literal defined by `SPEC.md` §7.1. No other type is listed, even one that has children (a story with tasks is not an epic), and there is no configuration for it. Epics are listed in the board's active sort order.

An epic whose `status` is the last workflow column (`Done` in both bundled repositories) is hidden by default; a "Show done" toggle below the list reveals them. The toggle is view state, not persisted.

### 1.3 Membership: the whole `parent` chain, not direct children

An item belongs to an epic when the epic appears anywhere on its `parent` chain. In `.workspec-demo/`, `TASK-000001 → STORY-000001 → EPIC-000001`: the task belongs to the epic although its `parent` is a story. Matching only `parent == EPIC-ID` would silently drop it.

This is the same relation `SPEC.md` §18.2 uses for the AI-usage roll-up ("the items that reach it through `parent`"), so it is implemented once, as a pure helper in `core/model.js`, and shared:

- The walk follows `parent` IDs through `model.items`; a missing parent ends the chain (it is already reported elsewhere).
- A cycle (`A → B → A`) ends the walk at the first repeated ID and never loops; the helper does not throw.
- Nested epics are allowed: an epic whose parent is another epic belongs to it, and so do its descendants.

### 1.4 What the focused board shows

- The focused epic itself, in its own status column, so it can be moved to Done when the project finishes.
- Every item that belongs to it (§1.3), of any type.
- The other filters still apply on top (type, status, priority, assignee, label, search), so "my open bugs in this epic" is two clicks.

### 1.5 "No epic"

The list ends with a **No epic** entry: non-EPIC items that reach no epic through `parent`. It is where unplanned work shows up for triage. The store represents it with a sentinel value that cannot be an ID.

### 1.6 Progress

Each entry shows `done/total`, where *total* counts the epic's members (§1.3, the epic itself excluded) and *done* counts those whose status is the last workflow column. Progress is computed over all items, not the filtered ones, so it does not change when other filters change. The numbers come from the store/model, never from arithmetic in `ui/`.

### 1.7 Lifecycle of the focus

- Clicking the focused entry again, or "Clear filters", removes the focus.
- If the focused epic is no longer an `EPIC` after a reload or save (deleted, renumbered, type changed), the focus is cleared rather than leaving an empty board.
- The focus is not persisted across sessions, like every other filter.

### 1.8 Conveniences while focused

- **New items default to the epic.** "+ New work item" pre-fills `parent` with the focused epic's ID (not for a new EPIC), so new work lands inside the project being viewed.
- **Focus from the editor.** An open EPIC shows a "Focus on board" action in the editor header. The card's `↳ PARENT-ID` link keeps its current meaning (open the parent).
- **Blockers outside the epic.** When a focus is active, a card held up by an item that is neither the epic nor one of its members, and not in the last workflow column, shows a small "blocked outside epic" marker listing those IDs. "Held up by" reads both sides of the relation: the card's own `depends_on`, and any item naming the card in its `blocks` (in `.workspec-demo/`, BUG-000001 records that it blocks STORY-000002 only on its own side). Membership, not the combined filter result, decides "outside", so narrowing by type or assignee does not create markers. Otherwise the focused view hides exactly the work that holds the project up.

---

## 2. Reference layout

```
EPICS
  ▸ EPIC-000001  Board MVP              3/7
  ▸ EPIC-000002  CLI tooling            0/4   ← focused (highlighted)
  ▸ No epic                              5
  ☐ Show done
```

The entry uses the existing `.context-link` button style with an `.active` state; the count sits right-aligned in the `filter-count` style. The "N of M shown" line under the filters keeps reporting the combined result.

---

## 3. Non-goals

- Setting `parent` by drag and drop.
- Swimlanes or grouping the board by epic.
- Any change to `SPEC.md`, the validator or the item format.
- Persisting the focus (URL, IndexedDB).

---

## 4. Implementation plan

| Item | Scope | Depends on |
|---|---|---|
| EPIC-001001 | Parent for the three stories below | — |
| STORY-001005 | Pure membership helper and progress in `core/model.js`, with tests | — |
| STORY-001006 | `filters.epic` in the store, the sidebar Epics section, "No epic", "Show done", lifecycle, README | STORY-001005 |
| STORY-001007 | Parent pre-fill on create, "Focus on board" in the editor, blocked-outside-epic marker | STORY-001006 |

STORY-001003 (AI usage sidebar totals) should use the STORY-001005 helper for the epic roll-up instead of writing its own walk.
