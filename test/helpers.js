// test/helpers.js
//
// Shared helpers for the test suite: fixture discovery and the definition of
// "content-equal" used by every round-trip assertion.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'items');
// Valid files the serializer reformats without changing content (flow
// collections, indentless sequences, ...): not lossy, not text-identical.
const REFORMAT_DIR = path.join(__dirname, 'fixtures', 'reformat');
// Valid files the round-trip guard must flag lossy (anchors, tags, folded blocks).
const LOSSY_DIR = path.join(__dirname, 'fixtures', 'lossy');
const BOM = '﻿';

/**
 * Read every fixture under test/fixtures/items (or another fixture directory)
 * as raw bytes decoded as UTF-8, preserving BOM and line endings. Returns
 * [{ name, file, raw }] sorted by name.
 */
function readFixtures(dir = FIXTURE_DIR) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      return { name, file, raw: fs.readFileSync(file, 'utf8') };
    });
}

/**
 * Canonical form used to compare a serialized document with its source.
 * Two documents are "content-equal" when they are identical after:
 *   - dropping a leading UTF-8 BOM,
 *   - normalising CRLF to LF,
 *   - dropping standalone `# comment` lines inside the front matter, and
 *     unquoted trailing ` # comments` on front-matter lines (the engine does
 *     not preserve either across a metadata re-serialize; see the README
 *     "Notes & limits"),
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
      .map(stripTrailingComment)
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

/**
 * Cut a line at an unquoted ` #`. Deliberately independent of utils/yaml.js
 * (same rule: a quote opens a quoted token only at the start of a token), so
 * the round-trip assertion does not trust the engine under test.
 */
function stripTrailingComment(line) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if ((ch === '"' || ch === "'") && (i === 0 || /[\s[{,:]/.test(line[i - 1]))) {
      let j = i + 1;
      for (; j < line.length; j++) {
        if (ch === '"' && line[j] === '\\') {
          j++;
        } else if (line[j] === ch) {
          if (ch === "'" && line[j + 1] === "'") j++;
          else break;
        }
      }
      if (j >= line.length) return line; // unterminated quote: leave the line alone
      i = j;
    } else if (ch === '#' && i > 0 && /\s/.test(line[i - 1])) {
      return line.slice(0, i).replace(/[ \t]+$/, '');
    }
  }
  return line;
}

/** Rewrite a document with Windows line endings (LF and lone CR become CRLF). */
function withCrlf(text) {
  return String(text).replace(/\r\n?|\n/g, '\r\n');
}

/** Prefix a document with a UTF-8 byte-order mark. */
function withBom(text) {
  return BOM + String(text).replace(/^﻿/, '');
}

module.exports = { FIXTURE_DIR, REFORMAT_DIR, LOSSY_DIR, BOM, readFixtures, normalizeDocument, withCrlf, withBom };
