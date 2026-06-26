// utils/ids.js
//
// Work-item identity rules (SPEC.md §7.2, PROMPT.md §5.3):
//   - format: TYPE-000123
//   - zero-padded to six digits
//   - unique within a project
//   - immutable once assigned

(function (WS) {
'use strict';

const ID_PAD = 6;
const ID_RE = /^([A-Z]+)-(\d{6})$/;

/** Validate a fully-formed work-item ID. */
function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

/** Build an ID from a type and a numeric sequence, e.g. ("STORY", 1) -> STORY-000001. */
function formatId(type, n) {
  return `${String(type).toUpperCase()}-${String(n).padStart(ID_PAD, '0')}`;
}

/** Pull the { type, number } out of an ID, or null when malformed. */
function parseId(id) {
  const m = String(id).match(ID_RE);
  if (!m) return null;
  return { type: m[1], number: parseInt(m[2], 10) };
}

/**
 * Compute the next available padded ID for a given type.
 * Sequences are kept globally unique per type by scanning all known IDs.
 */
function nextId(type, existingIds) {
  const upper = String(type).toUpperCase();
  let max = 0;
  for (const id of existingIds) {
    const parsed = parseId(id);
    if (parsed && parsed.type === upper && parsed.number > max) {
      max = parsed.number;
    }
  }
  return formatId(upper, max + 1);
}

Object.assign(WS, { ID_PAD, ID_RE, isValidId, formatId, parseId, nextId });
})(window.WS = window.WS || {});
