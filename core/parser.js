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
  if (meta.id && record.fileName !== `${meta.id}.md`) {
    record.warnings.push(`Filename "${record.fileName}" does not match ID "${meta.id}".`);
  }
  if (workflowStatuses && meta.status && !workflowStatuses.includes(meta.status)) {
    record.errors.push(`Status "${meta.status}" is not a configured workflow column.`);
  }
  return record;
}

/** Parse a config/template YAML file; returns { data, error }. */
function parseConfig(text) {
  try {
    return { data: parseYaml(text) || {}, error: null };
  } catch (err) {
    return { data: {}, error: err.message };
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
  parseItem, validateItem, parseConfig, serializeItem, changeStatus,
});
})(window.WS = window.WS || {});
