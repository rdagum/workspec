// test/parser.test.js — core/parser.js: parse / validate / serialize / surgical status patch.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadWS } = require('./load.js');
const { normalizeDocument } = require('./helpers.js');

const WS = loadWS(['utils/yaml.js', 'utils/ids.js', 'core/parser.js']);
const { REQUIRED_FIELDS, CANONICAL_ORDER, parseItem, validateItem, parseConfig, serializeItem, changeStatus } = WS;

const GOOD = [
  '---',
  'id: STORY-000042',
  'type: STORY',
  'title: "A good item: with a colon"',
  'status: Ready',
  'priority: high',
  'assignee:',
  'reporter: rdagum',
  'created: 2026-09-04',
  'updated: 2026-09-04',
  'labels:',
  '  - a',
  '  - b',
  'depends_on: []',
  'spec_version: 1.0',
  'custom:',
  '  vendor: acme',
  '---',
  '',
  '# Summary',
  '',
  'Body text.',
  '',
].join('\n');

describe('parser: constants', () => {
  it('lists the SPEC.md section 8 required fields', () => {
    assert.deepEqual(REQUIRED_FIELDS, ['id', 'type', 'title', 'status', 'created', 'updated', 'spec_version']);
  });

  it('places every required field in the canonical order', () => {
    for (const f of REQUIRED_FIELDS) assert.ok(CANONICAL_ORDER.includes(f), f);
    assert.equal(CANONICAL_ORDER[0], 'id');
    assert.equal(CANONICAL_ORDER[CANONICAL_ORDER.length - 1], 'spec_version');
    assert.equal(new Set(CANONICAL_ORDER).size, CANONICAL_ORDER.length, 'no duplicates');
  });
});

describe('parser: parseItem', () => {
  it('builds a record with ordered meta, body and no errors for a valid file', () => {
    const rec = parseItem('items/STORY-000042.md', GOOD);
    assert.equal(rec.path, 'items/STORY-000042.md');
    assert.equal(rec.fileName, 'STORY-000042.md');
    assert.equal(rec.raw, GOOD);
    assert.deepEqual(rec.errors, []);
    assert.deepEqual(rec.warnings, []);
    assert.equal(rec.body, '\n# Summary\n\nBody text.\n');
    assert.deepEqual(Object.keys(rec.meta), [
      'id', 'type', 'title', 'status', 'priority', 'assignee', 'reporter',
      'created', 'updated', 'labels', 'depends_on', 'spec_version', 'custom',
    ]);
    assert.equal(rec.meta.title, 'A good item: with a colon');
    assert.equal(rec.meta.assignee, null);
    assert.deepEqual(rec.meta.labels, ['a', 'b']);
    assert.deepEqual(rec.meta.depends_on, []);
    assert.equal(rec.meta.spec_version, '1.0');
    assert.deepEqual(rec.meta.custom, { vendor: 'acme' });
  });

  it('derives fileName from the last path segment', () => {
    assert.equal(parseItem('a/b/c/TASK-000001.md', GOOD).fileName, 'TASK-000001.md');
    assert.equal(parseItem('TASK-000001.md', GOOD).fileName, 'TASK-000001.md');
  });

  it('records an error and keeps the whole text as body when front matter is missing', () => {
    const rec = parseItem('items/X.md', '# Just markdown\n');
    assert.equal(rec.errors.length, 1);
    assert.match(rec.errors[0], /front matter/i);
    assert.deepEqual(rec.meta, {});
    assert.equal(rec.body, '# Just markdown\n');
  });

  it('reports every missing required field', () => {
    const rec = parseItem('items/STORY-000001.md', '---\nid: STORY-000001\ntitle: ""\n---\n');
    const missing = rec.errors.filter((e) => e.startsWith('Missing required field')).map((e) => e.split(': ')[1]);
    assert.deepEqual(missing, ['type', 'title', 'status', 'created', 'updated', 'spec_version']);
  });

  it('reports an invalid ID format', () => {
    const rec = parseItem('items/story-1.md', '---\nid: story-1\n---\n');
    assert.ok(rec.errors.some((e) => /Invalid ID format/.test(e)), rec.errors.join('; '));
  });

  it('accepts an integer-looking id only if it is a valid ID string', () => {
    const rec = parseItem('items/x.md', '---\nid: 42\n---\n');
    assert.ok(rec.errors.some((e) => /Invalid ID format/.test(e)));
  });

  it('errors when the filename does not match the id (SPEC.md §7.2)', () => {
    const rec = parseItem('items/wrong-name.md', GOOD);
    assert.deepEqual(rec.warnings, []);
    assert.equal(rec.errors.length, 1);
    assert.match(rec.errors[0], /wrong-name\.md.*STORY-000042.*expected STORY-000042\.md/);
  });

  it('never throws on garbage input', () => {
    for (const raw of ['', '---', '---\n---', '---\n---\n', '﻿', 'a: b', '---\n  : :\n---\n']) {
      assert.doesNotThrow(() => parseItem('items/x.md', raw), JSON.stringify(raw));
    }
  });

  it('accepts a CRLF file and a BOM file without spurious errors', () => {
    const crlf = GOOD.replace(/\n/g, '\r\n');
    const rec1 = parseItem('items/STORY-000042.md', crlf);
    assert.deepEqual(rec1.errors, []);
    assert.equal(rec1.meta.status, 'Ready');
    assert.deepEqual(rec1.meta.labels, ['a', 'b']);

    const rec2 = parseItem('items/STORY-000042.md', '﻿' + GOOD);
    assert.deepEqual(rec2.errors, []);
    assert.equal(rec2.meta.id, 'STORY-000042');
  });
});

describe('parser: validateItem', () => {
  it('rejects a status that is not a configured workflow column', () => {
    const rec = parseItem('items/STORY-000042.md', GOOD);
    validateItem(rec, ['Backlog', 'Done']);
    assert.ok(rec.errors.some((e) => /Status "Ready" is not a configured workflow column/.test(e)));
  });

  it('accepts a status that is a configured column', () => {
    const rec = parseItem('items/STORY-000042.md', GOOD);
    validateItem(rec, ['Backlog', 'Ready', 'Done']);
    assert.deepEqual(rec.errors, []);
  });

  it('does not check status when no workflow is supplied', () => {
    const rec = { fileName: 'STORY-000001.md', meta: { id: 'STORY-000001', type: 'STORY', title: 't', status: 'Whatever', created: 'd', updated: 'd', spec_version: '1.0' }, errors: [], warnings: [] };
    validateItem(rec);
    assert.deepEqual(rec.errors, []);
    assert.deepEqual(rec.warnings, []);
  });

  it('returns the record it validated', () => {
    const rec = { fileName: 'x.md', meta: {}, errors: [], warnings: [] };
    assert.equal(validateItem(rec), rec);
  });
});

describe('parser: parseConfig', () => {
  it('parses a workflow file into ordered data', () => {
    const { data, error } = parseConfig('columns:\n  - Backlog\n  - Done\n');
    assert.equal(error, null);
    assert.deepEqual(data, { columns: ['Backlog', 'Done'] });
  });

  it('returns an empty object for an empty file', () => {
    assert.deepEqual(parseConfig(''), { data: {}, error: null });
  });

  it('keeps nested settings and comments-free values', () => {
    const { data } = parseConfig('name: Board\n# comment\nsettings:\n  card_fields:\n    - id\n    - title\n  detail_display: floating\n');
    assert.deepEqual(data, { name: 'Board', settings: { card_fields: ['id', 'title'], detail_display: 'floating' } });
  });
});

describe('parser: serializeItem', () => {
  it('reproduces a canonical file from its parsed record', () => {
    const rec = parseItem('items/STORY-000042.md', GOOD);
    assert.equal(normalizeDocument(serializeItem(rec.meta, rec.body)), normalizeDocument(GOOD));
  });

  it('preserves unknown fields and their position', () => {
    const rec = parseItem('items/STORY-000042.md', GOOD);
    const out = serializeItem(rec.meta, rec.body);
    const keys = Object.keys(parseItem('items/STORY-000042.md', out).meta);
    assert.deepEqual(keys, Object.keys(rec.meta));
    assert.ok(out.includes('custom:\n  vendor: acme'));
  });

  it('writes edited values and newly added keys at the end', () => {
    const rec = parseItem('items/STORY-000042.md', GOOD);
    rec.meta.title = 'Renamed';
    rec.meta.estimate = 3;
    const out = serializeItem(rec.meta, rec.body);
    assert.match(out, /^title: Renamed$/m);
    assert.match(out, /^estimate: 3$/m);
    assert.deepEqual(Object.keys(parseItem('x.md', out).meta).slice(-1), ['estimate']);
  });

  it('treats a missing body as empty', () => {
    assert.equal(serializeItem({ id: 'TASK-000001' }), '---\nid: TASK-000001\n---\n\n');
    assert.equal(serializeItem({ id: 'TASK-000001' }, null), '---\nid: TASK-000001\n---\n\n');
  });

  it('is idempotent after the first write', () => {
    const rec = parseItem('items/STORY-000042.md', GOOD);
    const once = serializeItem(rec.meta, rec.body);
    const again = parseItem('items/STORY-000042.md', once);
    assert.equal(serializeItem(again.meta, again.body), once);
  });
});

describe('parser: changeStatus', () => {
  it('rewrites only the status line and nothing else', () => {
    const rec = parseItem('items/STORY-000042.md', GOOD);
    const out = changeStatus(rec, 'In Progress');
    const before = GOOD.split('\n');
    const after = out.split('\n');
    assert.equal(after.length, before.length);
    const changed = before.map((l, i) => (l === after[i] ? null : i)).filter((i) => i !== null);
    assert.deepEqual(changed, [4]);
    assert.equal(after[4], 'status: In Progress');
  });

  it('does not touch a status line inside the body', () => {
    const raw = GOOD + 'status: Done\n';
    const rec = parseItem('items/STORY-000042.md', raw);
    const out = changeStatus(rec, 'Review');
    assert.ok(out.endsWith('status: Done\n'));
    assert.match(out, /^status: Review$/m);
  });

  it('quotes a status that needs quoting', () => {
    const rec = parseItem('items/STORY-000042.md', GOOD);
    assert.match(changeStatus(rec, 'yes'), /^status: "yes"$/m);
  });

  it('falls back to a full re-serialize when there is no status line', () => {
    const raw = '---\nid: TASK-000001\ntype: TASK\ntitle: t\ncreated: d\nupdated: d\nspec_version: 1.0\n---\n\nbody\n';
    const rec = parseItem('items/TASK-000001.md', raw);
    const out = changeStatus(rec, 'Backlog');
    const again = parseItem('items/TASK-000001.md', out);
    assert.equal(again.meta.status, 'Backlog');
    assert.equal(again.meta.id, 'TASK-000001');
    assert.equal(again.body, '\nbody\n');
    assert.ok(!rec.meta.status, 'the original record is not mutated');
  });

  it('leaves the record itself unchanged', () => {
    const rec = parseItem('items/STORY-000042.md', GOOD);
    changeStatus(rec, 'Done');
    assert.equal(rec.meta.status, 'Ready');
    assert.equal(rec.raw, GOOD);
  });
});

describe('parser: unresolved Git conflict markers', () => {
  const { hasConflictMarkers } = WS;
  const conflicted = [
    '---', 'id: STORY-000014', 'type: STORY', 'title: x', 'status: Ready',
    '<<<<<<< HEAD', 'priority: high', '=======', 'priority: low', '>>>>>>> origin/feat-c',
    'created: 2026-09-04', 'updated: 2026-09-04', 'spec_version: 1.0', '---', '', '# Summary', '',
  ].join('\n');

  it('detects the markers Git writes, in LF and CRLF files', () => {
    assert.equal(hasConflictMarkers(conflicted), true);
    assert.equal(hasConflictMarkers(conflicted.replace(/\n/g, '\r\n')), true);
    assert.equal(hasConflictMarkers('a\n||||||| base\nb\n'), true);
    assert.equal(hasConflictMarkers(GOOD), false);
  });

  it('does not mistake a setext heading underline or ASCII art for a conflict', () => {
    assert.equal(hasConflictMarkers('Title\n=======\n\ntext\n'), false);
    assert.equal(hasConflictMarkers('<<<<<<<\n>>>>>>>\n'), false);
    assert.equal(hasConflictMarkers('see <<<<<<< HEAD inline\n'), false);
  });

  it('marks a half-merged item as an error even though it still parses', () => {
    const rec = parseItem('items/STORY-000014.md', conflicted);
    assert.ok(rec.errors.some((e) => /Unresolved Git conflict markers/.test(e)), rec.errors.join('; '));
    assert.equal(rec.meta.id, 'STORY-000014', 'the rest of the file is still read');
  });

  it('reports a half-merged config file as an error instead of parsing it quietly', () => {
    const { data, error } = parseConfig('blocks:\n<<<<<<< HEAD\n  - { block: 3, owner: a }\n=======\n  - { block: 3, owner: b }\n>>>>>>> feat\n');
    assert.match(error, /Unresolved Git conflict markers/);
    assert.equal(typeof data, 'object');
    assert.equal(parseConfig('columns:\n  - Backlog\n').error, null);
  });
});
