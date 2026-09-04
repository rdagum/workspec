// test/roundtrip.test.js — the fixture corpus under test/fixtures/items.
//
// Every fixture is a complete work-item file. For each one the suite proves:
//   1. it parses through the real item path (parseItem) with no errors;
//   2. serializeItem(parse(x)) is content-equal to x (see helpers.normalizeDocument
//      for the exact definition: BOM, CRLF, full-line comments and trailing
//      whitespace are the only tolerated differences);
//   3. a second parse/serialize pass is byte-identical to the first, so the board
//      never rewrites a file it has already written;
//   4. the same holds with the fixture converted to CRLF and prefixed with a BOM.
//
// Adding a fixture: drop a file in test/fixtures/items. A defect fixed in
// another story is expected to add its own fixture here (STORY-000003 DoD).

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadWS } = require('./load.js');
const { BOM, readFixtures, normalizeDocument, withCrlf, withBom } = require('./helpers.js');

const { parseItem, serializeItem, parseYaml, stringifyYaml, splitDocument } = loadWS();

const fixtures = readFixtures();

/** Fixtures every contributor must keep; they are the acceptance criteria of STORY-000003. */
const REQUIRED_FIXTURES = [
  'scalars.md',
  'quoted.md',
  'sequences.md',
  'block-scalars.md',
  'nested-namespaces.md',
  'comments.md',
  'crlf.md',
  'bom.md',
];

/**
 * Fixtures are named after what they cover, not after their ID, while the
 * parser (SPEC.md §7.2) requires the file name to equal the ID. Parse each one
 * under the path the board would find it at.
 */
function fixturePath(raw) {
  const m = String(raw).match(/^id:[ \t]*(\S+)[ \t]*\r?$/m);
  return `items/${m ? m[1] : 'unknown'}.md`;
}

function roundTrip(name, raw) {
  const path = fixturePath(raw);
  const rec = parseItem(path, raw);
  assert.deepEqual(rec.errors, [], `${name} should parse without errors`);
  const once = serializeItem(rec.meta, rec.body);
  assert.equal(normalizeDocument(once), normalizeDocument(raw), `${name} is not content-equal after a round trip`);
  const again = parseItem(path, once);
  assert.deepEqual(again.errors, []);
  assert.deepEqual(again.meta, rec.meta, `${name} meta changed on the second parse`);
  assert.equal(serializeItem(again.meta, again.body), once, `${name} is not stable after the first write`);
  return rec;
}

describe('fixtures: corpus', () => {
  it('contains the required coverage files', () => {
    const names = fixtures.map((f) => f.name);
    for (const required of REQUIRED_FIXTURES) assert.ok(names.includes(required), `missing fixture ${required}`);
  });

  it('crlf.md really uses CRLF on every line', () => {
    const { raw } = fixtures.find((f) => f.name === 'crlf.md');
    assert.ok(raw.includes('\r\n'));
    assert.equal(raw.replace(/\r\n/g, '').includes('\n'), false, 'found a bare LF: was the file converted on checkout?');
    assert.equal(raw.replace(/\r\n/g, '').includes('\r'), false);
  });

  it('bom.md really starts with a byte-order mark', () => {
    const { raw } = fixtures.find((f) => f.name === 'bom.md');
    assert.ok(raw.startsWith(BOM), 'BOM missing: was the file rewritten by an editor?');
  });

  it('the other fixtures use LF and no BOM, so the CRLF/BOM variants below are distinct', () => {
    for (const { name, raw } of fixtures) {
      if (name === 'crlf.md' || name === 'bom.md') continue;
      assert.equal(raw.includes('\r'), false, `${name} contains CR`);
      assert.equal(raw.startsWith(BOM), false, `${name} starts with a BOM`);
    }
  });
});

describe('fixtures: round trip through parseItem / serializeItem', () => {
  for (const { name, raw } of fixtures) {
    it(name, () => {
      roundTrip(name, raw);
    });
  }
});

describe('fixtures: round trip with CRLF line endings', () => {
  for (const { name, raw } of fixtures) {
    it(name, () => {
      const rec = roundTrip(name, withCrlf(raw));
      const lf = parseItem(`items/${name}`, raw.replace(/\r\n/g, '\n'));
      assert.deepEqual(rec.meta, lf.meta, `${name} parses differently with CRLF`);
      assert.equal(JSON.stringify(rec.meta).includes('\\r'), false, `${name} leaked a CR into a value`);
    });
  }
});

describe('fixtures: round trip with a leading BOM', () => {
  for (const { name, raw } of fixtures) {
    it(name, () => {
      const rec = roundTrip(name, withBom(raw));
      const plain = parseItem(`items/${name}`, raw.replace(/^﻿/, ''));
      assert.deepEqual(rec.meta, plain.meta, `${name} parses differently with a BOM`);
      assert.equal(serializeItem(rec.meta, rec.body).startsWith(BOM), false, 'the BOM must not be written back');
    });
  }
});

describe('fixtures: front matter alone round-trips through parseYaml / stringifyYaml', () => {
  for (const { name, raw } of fixtures) {
    it(name, () => {
      const { frontMatter } = splitDocument(raw);
      assert.notEqual(frontMatter, null, `${name} has no front matter`);
      const obj = parseYaml(frontMatter);
      const text = stringifyYaml(obj);
      assert.deepEqual(parseYaml(text), obj, `${name} front matter is not a fixed point`);
      assert.equal(
        normalizeDocument(`---\n${text}\n---\n`),
        normalizeDocument(`---\n${frontMatter}\n---\n`),
        `${name} front matter is not content-equal`
      );
    });
  }
});
