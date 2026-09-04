// test/helpers.js
//
// Shared helpers for the test suite: fixture discovery and the definition of
// "content-equal" used by every round-trip assertion.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'items');
const BOM = '﻿';

/**
 * Read every fixture under test/fixtures/items as raw bytes decoded as UTF-8,
 * preserving BOM and line endings. Returns [{ name, file, raw }] sorted by name.
 */
function readFixtures() {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const file = path.join(FIXTURE_DIR, name);
      return { name, file, raw: fs.readFileSync(file, 'utf8') };
    });
}

/**
 * Canonical form used to compare a serialized document with its source.
 * Two documents are "content-equal" when they are identical after:
 *   - dropping a leading UTF-8 BOM,
 *   - normalising CRLF to LF,
 *   - dropping standalone `# comment` lines inside the front matter (the
 *     engine does not preserve them across a metadata re-serialize; see the
 *     README "Notes & limits"),
 *   - trimming trailing spaces/tabs on each line (the serializer emits
 *     `key: ` with a trailing space for null values),
 *   - collapsing trailing newlines at the end of the file to exactly one.
 * Everything else, including the Markdown body, must match byte for byte.
 */
function normalizeDocument(text) {
  let t = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = t.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (m) {
    const frontMatter = m[1]
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    t = `---\n${frontMatter}\n---\n${m[2]}`;
  }
  return (
    t
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\n+$/, '') + '\n'
  );
}

/** Rewrite a document with Windows line endings (LF and lone CR become CRLF). */
function withCrlf(text) {
  return String(text).replace(/\r\n?|\n/g, '\r\n');
}

/** Prefix a document with a UTF-8 byte-order mark. */
function withBom(text) {
  return BOM + String(text).replace(/^﻿/, '');
}

module.exports = { FIXTURE_DIR, BOM, readFixtures, normalizeDocument, withCrlf, withBom };
