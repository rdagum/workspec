// core/parser.js
//
// Turns a raw work-item file (or template/config) into a structured record and
// back again, without losing information. Parsing never throws on a bad file:
// the error is captured on the record so the board can keep loading the rest
// (PROMPT.md §11 — "continue loading valid items even if some fail").

(function (WS) {
'use strict';

const { parseYaml, stringifyYaml, splitDocument, joinDocument, patchScalarLine, roundTripDifference } = WS;
const { isValidId } = WS;

// Required metadata fields (SPEC.md §8).
const REQUIRED_FIELDS = ['id', 'type', 'title', 'status', 'created', 'updated', 'spec_version'];

// Git writes `<<<<<<< label` and `>>>>>>> label` (and `||||||| label` in diff3
// style) around an unresolved conflict. `=======` alone is deliberately not
// matched: it is also a Markdown setext heading underline.
const CONFLICT_MARKER_RE = /^(?:<{7}|>{7}|\|{7}) /m;

/** True when the text still contains unresolved Git conflict markers. */
function hasConflictMarkers(text) {
  return CONFLICT_MARKER_RE.test(String(text));
}

const CONFLICT_MESSAGE = 'Unresolved Git conflict markers (<<<<<<< / >>>>>>>) in this file; resolve the merge first.';

/**
 * The "ours" side of a conflicted text: marker lines and the base/theirs
 * sections become blank lines, so the strict YAML parser can still read the
 * rest (with line numbers unchanged) while the conflict itself is reported.
 */
function oursSide(text) {
  let section = 'normal';
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      if (/^<{7}(?: |$)/.test(line)) section = 'ours';
      else if (/^\|{7}(?: |$)/.test(line) && section === 'ours') section = 'base';
      else if (/^={7}$/.test(line) && section !== 'normal') section = 'theirs';
      else if (/^>{7}(?: |$)/.test(line) && section !== 'normal') section = 'normal';
      else if (section === 'normal' || section === 'ours') return line;
      return '';
    })
    .join('\n');
}

// Canonical field order (SPEC.md §8) used when emitting brand-new items.
const CANONICAL_ORDER = [
  'id', 'type', 'title',
  'status', 'priority',
  'assignee', 'reporter',
  'created', 'updated',
  'estimate', 'labels',
  'parent', 'depends_on', 'blocks', 'related',
  'context', 'affected_paths', 'related_files',
  'acceptance_criteria', 'definition_of_done',
  'spec_version',
];

/**
 * Parse a work-item file into a record:
 *   { path, fileName, raw, meta, body, errors[], warnings[] }
 * `meta` preserves source key order; `raw` keeps the original text for surgical
 * edits. `errors` is non-empty when the file could not be fully understood.
 */
function parseItem(path, raw) {
  const record = {
    path,
    fileName: path.split('/').pop(),
    raw,
    meta: {},
    body: '',
    errors: [],
    warnings: [],
    // True when `meta` cannot be written back without changing the file's
    // content: raw-YAML editing only, and saveItem writes the raw text verbatim.
    lossy: false,
  };

  const { frontMatter, body } = splitDocument(raw);
  record.body = body || '';

  // A half-merged file is an error even when its "ours" side parses; the body
  // would otherwise keep the markers as text without anyone noticing.
  const conflicted = hasConflictMarkers(raw);
  if (conflicted) record.errors.push(CONFLICT_MESSAGE);

  if (frontMatter === null) {
    record.errors.push('Missing YAML front matter (expected a leading `---` block).');
    return record;
  }

  // A half-merged file's metadata is a guess (the "ours" side), and a file
  // that does not parse has none: neither may be re-serialized from `meta`.
  if (conflicted) record.lossy = true;

  // Line 1 of the file is the opening fence, so front-matter line N is file line N + 1.
  try {
    record.meta = parseYaml(conflicted ? oursSide(frontMatter) : frontMatter, { lineOffset: 1 }) || {};
  } catch (err) {
    record.errors.push(`YAML parse error: ${err.message}`);
    record.lossy = true;
    record.parseFailed = true;
    return record;
  }

  // Round-trip guard (REVIEW-2026-09 A1): front matter that the serializer
  // would not reproduce is edited as raw YAML only and saved verbatim.
  if (!conflicted) {
    const at = roundTripDifference(frontMatter);
    if (at) {
      record.lossy = true;
      record.warnings.push(`${LOSSY_MESSAGE} (first difference at ${at}).`);
    }
  }

  validateItem(record);
  return record;
}

const LOSSY_MESSAGE =
  'Front matter uses YAML the form editor would rewrite differently, so the editor opens it as raw YAML only and saves it verbatim';

/** Populate record.errors / record.warnings per the validation rules (PROMPT.md §10). */
function validateItem(record, workflowStatuses = null) {
  // Nothing was read from a file whose YAML failed to parse, so "missing
  // field" errors would only bury the real parse error.
  if (record.parseFailed) return record;
  const meta = record.meta;
  for (const field of REQUIRED_FIELDS) {
    if (meta[field] === undefined || meta[field] === null || meta[field] === '') {
      record.errors.push(`Missing required field: ${field}`);
    }
  }
  if (meta.id !== undefined && meta.id !== null && !isValidId(String(meta.id))) {
    record.errors.push(`Invalid ID format: "${meta.id}" (expected TYPE-000000).`);
  }
  // SPEC.md §7.2: the filename is the ID. A mismatch means two files can claim
  // one ID, or an ID can point at a file nobody can find, so it is an error.
  if (meta.id && record.fileName !== `${meta.id}.md`) {
    record.errors.push(`Filename "${record.fileName}" does not match ID "${meta.id}" (expected ${meta.id}.md).`);
  }
  if (workflowStatuses && meta.status && !workflowStatuses.includes(meta.status)) {
    record.errors.push(`Status "${meta.status}" is not a configured workflow column.`);
  }
  return record;
}

/**
 * Parse a config/template YAML file; returns { data, error }. Conflict markers
 * are reported as the error while the rest of the file is still parsed, so a
 * half-merged registry or board config never passes as valid.
 */
function parseConfig(text) {
  const conflict = hasConflictMarkers(text) ? CONFLICT_MESSAGE : null;
  try {
    return { data: parseYaml(conflict ? oursSide(text) : String(text)) || {}, error: conflict };
  } catch (err) {
    return { data: {}, error: conflict ? `${conflict} ${err.message}` : err.message };
  }
}

/**
 * Re-serialize a record to file text after a metadata and/or body edit.
 * Key order is whatever `meta` currently holds (insertion order preserved),
 * so unknown fields and ordering survive.
 */
function serializeItem(meta, body) {
  return joinDocument(stringifyYaml(meta), body || '');
}

/**
 * Surgical status change for drag/drop: rewrite only the `status:` line in the
 * raw file text. Falls back to a full re-serialize if the line can't be found,
 * except for a lossy record, which must never be re-serialized.
 */
function changeStatus(record, newStatus) {
  const patched = patchScalarLine(record.raw, 'status', newStatus);
  if (patched !== null) return patched;
  if (record.lossy) {
    throw new Error('this item has no top-level "status:" line and can only be edited as raw YAML');
  }
  const meta = { ...record.meta, status: newStatus };
  return serializeItem(meta, record.body);
}

Object.assign(WS, {
  REQUIRED_FIELDS, CANONICAL_ORDER,
  parseItem, validateItem, parseConfig, serializeItem, changeStatus, hasConflictMarkers,
});
})(window.WS = window.WS || {});
