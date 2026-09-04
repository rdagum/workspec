// core/parser.js
//
// Turns a raw work-item file (or template/config) into a structured record and
// back again, without losing information. Parsing never throws on a bad file:
// the error is captured on the record so the board can keep loading the rest
// (PROMPT.md §11 — "continue loading valid items even if some fail").

(function (WS) {
'use strict';

const { parseYaml, stringifyYaml, splitDocument, joinDocument, patchScalarLine } = WS;
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
  };

  const { frontMatter, body } = splitDocument(raw);
  record.body = body || '';

  // A half-merged file would otherwise parse "successfully": the YAML engine
  // skips marker lines (no colon) and the body keeps them as text.
  if (hasConflictMarkers(raw)) record.errors.push(CONFLICT_MESSAGE);

  if (frontMatter === null) {
    record.errors.push('Missing YAML front matter (expected a leading `---` block).');
    return record;
  }

  try {
    record.meta = parseYaml(frontMatter) || {};
  } catch (err) {
    record.errors.push(`YAML parse error: ${err.message}`);
    return record;
  }

  validateItem(record);
  return record;
}

/** Populate record.errors / record.warnings per the validation rules (PROMPT.md §10). */
function validateItem(record, workflowStatuses = null) {
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
    return { data: parseYaml(text) || {}, error: conflict };
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
 * raw file text. Falls back to a full re-serialize if the line can't be found.
 */
function changeStatus(record, newStatus) {
  const patched = patchScalarLine(record.raw, 'status', newStatus);
  if (patched !== null) return patched;
  const meta = { ...record.meta, status: newStatus };
  return serializeItem(meta, record.body);
}

Object.assign(WS, {
  REQUIRED_FIELDS, CANONICAL_ORDER,
  parseItem, validateItem, parseConfig, serializeItem, changeStatus, hasConflictMarkers,
});
})(window.WS = window.WS || {});
