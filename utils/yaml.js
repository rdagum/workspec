// utils/yaml.js
//
// A small, order-preserving YAML engine purpose-built for WorkSpec front matter.
//
// It is deliberately NOT a full YAML 1.2 implementation. It supports the subset
// that WorkSpec work items use:
//   - scalar values (strings, numbers, booleans, null, dates-as-strings)
//   - quoted scalars (single/double)
//   - block sequences ("- item"), indented or in the key's column
//   - inline flow sequences ("[a, b, c]" and "[]")
//   - inline flow mappings ("{ block: 1, owner: rdagum }" and "{}")
//   - either flow form wrapped onto lines indented below its key, as editors
//     that format to a print width write it
//   - nested mappings (for reserved namespaces: extensions / custom / agent)
//   - block scalars ("|" and ">")
//
// Design goals (see SPEC.md §15 and PROMPT.md §5):
//   - preserve field order              -> objects keep insertion order
//   - preserve unknown fields           -> nothing is dropped
//   - avoid unnecessary normalization   -> values round-trip as written
//   - lossless or loud                  -> input outside the subset throws a
//                                          `line N:` error, never skipped
//
// For the most sensitive operation (drag/drop status change) callers should use
// `patchScalarLine` which edits a single line of raw text and touches nothing
// else, rather than re-serializing the whole document.

(function (WS) {
'use strict';

const INDENT = '  '; // two spaces per level on serialize

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/**
 * Index just past the quoted string that opens at s[i] (`"` with backslash
 * escapes, `'` with doubled quotes), or -1 when it is never closed.
 */
function skipQuoted(s, i) {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (q === '"' && s[j] === '\\') {
      j++;
    } else if (s[j] === q) {
      if (q === "'" && s[j + 1] === "'") j++;
      else return j + 1;
    }
  }
  return -1;
}

// A quote only opens a quoted scalar at the start of a token; inside plain
// text ("it's", 6'2") it is an ordinary character.
function isQuoteStart(s, i) {
  return (s[i] === '"' || s[i] === "'") && (i === 0 || /[\s[{,:]/.test(s[i - 1]));
}

/** True when the whole of `s` is one quoted scalar. */
function isQuoted(s) {
  return s.length >= 2 && isQuoteStart(s, 0) && skipQuoted(s, 0) === s.length;
}

/**
 * Drop an unquoted trailing comment: a `#` at the start or after whitespace,
 * outside any quoted token. `a#b` and `"x # y"` keep their `#`.
 */
function stripComment(s) {
  for (let i = 0; i < s.length; i++) {
    if (isQuoteStart(s, i)) {
      const end = skipQuoted(s, i);
      if (end === -1) return s; // unterminated: leave it to the scalar rules
      i = end - 1;
    } else if (s[i] === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      return s.slice(0, i).trimEnd();
    }
  }
  return s;
}

// Double-quoted escapes (YAML 1.2 §5.7). serializeScalar emits a subset of
// these and parseScalar decodes all of them, so the two are exact inverses.
const UNESCAPE = {
  '\\': '\\', '"': '"', '/': '/', ' ': ' ', '\t': '\t',
  n: '\n', t: '\t', r: '\r', 0: '\0', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v',
  N: '\u0085', _: '\u00a0', L: '\u2028', P: '\u2029',
};
const ESCAPE = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t', '\r': '\\r', '\0': '\\0' };

/**
 * Decode the body of a double-quoted scalar. An unknown escape such as the
 * `\p` of a hand-written "C:\path" is kept literally rather than rejected;
 * the serializer then writes it back as `\\p`, which reads as the same value.
 */
function unescapeDouble(body) {
  return body.replace(/\\(x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|[\s\S])/g, (m, e) => {
    if (e.length > 1) return String.fromCodePoint(parseInt(e.slice(1), 16));
    return Object.prototype.hasOwnProperty.call(UNESCAPE, e) ? UNESCAPE[e] : m;
  });
}

function escapeDouble(s) {
  return s.replace(/[\\"\x00-\x1f\x7f]/g, (c) => ESCAPE[c] || `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

// Plain text that real YAML reads as something else (anchor, alias, tag,
// directive, reserved character, block indicator, an unclosed flow
// collection, a nested "- "/"? "/": " indicator). This engine keeps it as a
// string, so writing it back quoted would change what the file says.
const EXOTIC_PLAIN = /^(?:[&*!%@`|>[{]|[-?:](?:\s|$))/;

/**
 * Parse one scalar or flow collection. With `fid` (the round-trip guard's
 * fidelity mode) each string or integer leaf is instead a token that tells
 * apart what the formatting-free comparison must keep apart: "s:" + the
 * string (however it was quoted), "i:" + the integer as written, "x:" + text
 * this engine does not reproduce. null, booleans and empty collections are
 * returned as values, since every spelling of them means the same.
 */
function parseScalar(raw, fid = false) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;

  // Quoted strings — strip the quotes and decode the escapes.
  if (isQuoted(s) && s[0] === '"') {
    const v = unescapeDouble(s.slice(1, -1));
    return fid ? `s:${v}` : v;
  }
  if (isQuoted(s) && s[0] === "'") {
    const v = s.slice(1, -1).replace(/''/g, "'");
    return fid ? `s:${v}` : v;
  }

  // Inline flow sequence: [], [a, b, c]
  if (s[0] === '[' && s[s.length - 1] === ']') {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return splitFlow(inner).map((part) => parseScalar(part, fid));
  }

  // Inline flow mapping: {}, { block: 1, owner: rdagum }. The ID block registry
  // uses this form so one clone is one line. Anything that does not split
  // cleanly into "key: value" pairs is an error: turning it into a string
  // would silently change a mapping into text on the next save.
  if (s[0] === '{' && s[s.length - 1] === '}') {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return {};
    const obj = {};
    for (const part of splitFlow(inner)) {
      const kv = splitKeyValue(part);
      if (!kv || kv.key === '') throw new Error(`flow mapping entry is not a "key: value" pair (${part || 'empty'})`);
      if (Object.prototype.hasOwnProperty.call(obj, kv.key)) throw new Error(`duplicate key "${kv.key}" in flow mapping`);
      obj[kv.key] = parseScalar(kv.rest, fid);
    }
    return obj;
  }

  // Integers become numbers; decimals stay strings so values like "1.0"
  // (e.g. spec_version) round-trip exactly instead of collapsing to "1".
  if (/^-?\d+$/.test(s)) return fid ? `i:${s}` : parseInt(s, 10);

  if (fid) return `${EXOTIC_PLAIN.test(s) ? 'x' : 's'}:${s}`;
  return s;
}

// Split a flow-collection body on commas that are not inside quotes or a
// nested collection.
function splitFlow(inner) {
  const out = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    const end = isQuoteStart(inner, i) ? skipQuoted(inner, i) : -1;
    if (end !== -1) {
      buf += inner.slice(i, end);
      i = end - 1;
    } else if (ch === '{' || ch === '[') {
      depth++;
      buf += ch;
    } else if (ch === '}' || ch === ']') {
      depth--;
      buf += ch;
    } else if (ch === ',' && depth <= 0) {
      out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim() !== '') out.push(buf.trim());
  return out;
}

// Split "key: value" honouring quoted keys/values and the block-scalar markers.
function splitKeyValue(content) {
  // Find the first ": " or trailing ":" that is not inside a quoted key.
  const keyEnd = isQuoteStart(content, 0) ? skipQuoted(content, 0) : 0;
  for (let i = Math.max(keyEnd, 0); i < content.length; i++) {
    const ch = content[i];
    if (ch === ':') {
      const after = content.slice(i + 1);
      if (after === '' || after[0] === ' ') {
        return { key: content.slice(0, i).trim(), rest: after.trim() };
      }
    }
  }
  return null;
}

// Net bracket depth of a flow collection's text, ignoring quoted brackets.
function flowDepth(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const end = isQuoteStart(s, i) ? skipQuoted(s, i) : -1;
    if (end !== -1) {
      i = end - 1;
    } else if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
    }
  }
  return depth;
}

const isSkippable = (line) => line.trim() === '' || line.trimStart().startsWith('#');
const isDash = (content) => content.startsWith('- ') || content === '-';
const isBlockMarker = (s) => /^[|>][+-]?$/.test(s);

/**
 * Parse a YAML document (the front-matter block, without the `---` fences)
 * into a plain object whose key order matches the source.
 *
 * The parser is strict: anything it does not understand throws an Error whose
 * message starts with `line N:` (and whose `line` property is N), instead of
 * being skipped. A silently skipped line would be dropped by the next save.
 * `options.lineOffset` is added to every reported line number, so a caller
 * parsing front matter can report positions in the whole file.
 */
function parseYaml(text, options = {}) {
  const offset = options.lineOffset || 0;
  const fid = !!options.fidelity; // internal: leaf tokens for roundTripDifference
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop(); // the final newline ends a line, it is not one
  const source = lines.slice(); // parseSequence rewrites lines; errors quote the original
  let idx = 0;

  function fail(i, message) {
    const shown = source[i].trim();
    const snippet = shown.length > 60 ? `${shown.slice(0, 57)}...` : shown;
    const err = new Error(`line ${i + 1 + offset}: ${message}: "${snippet}"`);
    err.line = i + 1 + offset;
    return err;
  }

  // parseScalar knows no line numbers; attach the line the value started on.
  function scalarAt(i, raw) {
    try {
      return parseScalar(raw, fid);
    } catch (err) {
      throw fail(i, err.message);
    }
  }

  function significantIndex(from) {
    for (let j = from; j < lines.length; j++) if (!isSkippable(lines[j])) return j;
    return -1;
  }

  function nextSignificant() {
    const j = significantIndex(idx);
    return j === -1 ? null : lines[j];
  }

  // A flow collection may run over several lines: an editor that wraps at a
  // print width writes "key:\n    { a: 1, b: 2 }" or breaks inside the braces.
  // Join the lines indented deeper than the key until the brackets balance;
  // if they never do, consume nothing and return the first line as written.
  function readFlow(first, keyIndent) {
    if (flowDepth(first) <= 0) return first;
    const start = idx;
    let joined = first;
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.trim() === '' || line.trimStart().startsWith('#')) {
        idx++;
        continue;
      }
      if (indentOf(line) <= keyIndent) break;
      joined += ' ' + stripComment(line.trim());
      idx++;
      if (flowDepth(joined) <= 0) return joined;
    }
    idx = start;
    return first;
  }

  // A literal block is just a string (the serializer may quote it instead); a
  // folded one is never written back as folded, so it never compares equal.
  function parseBlockScalar(parentIndent, marker) {
    const value = readBlockScalar(parentIndent, marker);
    if (!fid) return value;
    return marker[0] === '>' ? `x:${marker}${value}` : `s:${value}`;
  }

  function readBlockScalar(parentIndent, marker) {
    // Consume all lines indented deeper than parentIndent (blanks included).
    const collected = [];
    let contentIndent = null;
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.trim() === '') {
        collected.push('');
        idx++;
        continue;
      }
      const ci = indentOf(line);
      if (ci <= parentIndent) break;
      if (contentIndent === null) contentIndent = ci;
      // Slicing at the first line's indent would cut into this line's text.
      if (ci < contentIndent) throw fail(idx, 'block scalar line is indented less than its first line');
      collected.push(line.slice(contentIndent));
      idx++;
    }
    // Trailing blank lines belong to the block; only "keep" (|+) retains them.
    let trailing = 0;
    while (collected.length && collected[collected.length - 1] === '') {
      collected.pop();
      trailing++;
    }
    let value = collected.join('\n');
    const folded = marker[0] === '>';
    if (folded) value = value.replace(/\n(?!\n)/g, ' ');
    if (value === '') return marker[1] === '+' ? '\n'.repeat(trailing) : '';
    if (marker[1] === '-') return value; // strip: no trailing newline
    if (marker[1] === '+') return value + '\n'.repeat(trailing + 1); // keep: every line break
    return value + '\n'; // clip: exactly one trailing newline
  }

  function parseSequence(seqIndent) {
    const arr = [];
    while (idx < lines.length) {
      const line = lines[idx];
      if (isSkippable(line)) {
        idx++;
        continue;
      }
      const ci = indentOf(line);
      if (ci < seqIndent) break;
      // A deeper line here is a continuation this subset cannot represent
      // (a multi-line plain scalar, or a misaligned "- " entry).
      if (ci > seqIndent) throw fail(idx, 'unexpected indentation inside a sequence');
      const content = line.slice(ci);
      if (!isDash(content)) break; // the parent's next key, checked by the parent
      const itemBody = stripComment(content.slice(1).trim());
      idx++;
      if (isBlockMarker(itemBody)) {
        arr.push(parseBlockScalar(ci, itemBody));
      } else if (itemBody === '') {
        // Nested structure under the dash.
        const nxt = nextSignificant();
        if (nxt && indentOf(nxt) > seqIndent) {
          const ni = indentOf(nxt);
          arr.push(isDash(nxt.slice(ni)) ? parseSequence(ni) : parseMapping(ni));
        } else {
          arr.push(null);
        }
      } else if (!/^[[{]/.test(itemBody) && splitKeyValue(itemBody)) {
        // Inline "- key: value" starts a mapping at the dash's content column.
        // A flow collection ("- { a: 1 }", "- [a, b]") is a scalar to parseScalar.
        idx--; // re-read this line as a mapping, treating the dash area as indent
        const mapIndent = ci + content.indexOf(itemBody); // "-   key: v" aligns with key
        // Rewrite current line so the mapping parser sees plain indentation.
        lines[idx] = ' '.repeat(mapIndent) + itemBody;
        arr.push(parseMapping(mapIndent));
      } else {
        arr.push(scalarAt(idx - 1, /^[[{]/.test(itemBody) ? readFlow(itemBody, ci) : itemBody));
      }
    }
    return arr;
  }

  function parseMapping(mapIndent) {
    const obj = {};
    const firstLine = {}; // key -> line index, for the duplicate-key message
    while (idx < lines.length) {
      const line = lines[idx];
      if (isSkippable(line)) {
        idx++;
        continue;
      }
      const ci = indentOf(line);
      if (ci < mapIndent) break;
      if (ci > mapIndent) throw fail(idx, 'unexpected indentation');
      const content = line.slice(ci);
      // Entries of a sequence under a key are consumed with that key, so a
      // dash reaching this point has no key to belong to.
      if (isDash(content)) throw fail(idx, 'sequence entry where a "key: value" pair was expected');
      const kv = splitKeyValue(content);
      if (!kv || kv.key === '') throw fail(idx, 'expected a "key: value" pair');
      const key = kv.key;
      const rest = stripComment(kv.rest);
      if (Object.prototype.hasOwnProperty.call(firstLine, key)) {
        throw fail(idx, `duplicate key "${key}" (first set on line ${firstLine[key] + 1 + offset})`);
      }
      firstLine[key] = idx;
      idx++;

      if (isBlockMarker(rest)) {
        obj[key] = parseBlockScalar(ci, rest);
        continue;
      }
      if (rest !== '') {
        obj[key] = scalarAt(idx - 1, /^[[{]/.test(rest) ? readFlow(rest, ci) : rest);
        continue;
      }
      // Empty value -> nested mapping, sequence, flow collection, or null.
      const nxt = nextSignificant();
      if (!nxt) {
        obj[key] = null;
        continue;
      }
      const ni = indentOf(nxt);
      const ncontent = stripComment(nxt.slice(ni));
      if (ni > ci && /^[[{]/.test(ncontent)) {
        while (lines[idx] !== nxt) idx++;
        idx++;
        obj[key] = scalarAt(idx - 1, readFlow(ncontent, ci));
      } else if (ni >= ci && isDash(ncontent)) {
        // ni === ci is an "indentless" sequence (`key:\n- a`), as PyYAML writes it.
        obj[key] = parseSequence(ni);
      } else if (ni > ci) {
        obj[key] = parseMapping(ni);
      } else {
        obj[key] = null;
      }
    }
    return obj;
  }

  const start = significantIndex(0);
  if (start === -1) return {};
  const topIndent = indentOf(lines[start]);
  const result = isDash(lines[start].slice(topIndent)) ? parseSequence(topIndent) : parseMapping(topIndent);
  // Anything left over sits outside the top-level collection (e.g. a key
  // indented less than the first one) and would otherwise be dropped.
  const leftover = significantIndex(idx);
  if (leftover !== -1) throw fail(leftover, 'unexpected indentation');
  return result;
}

function needsQuoting(s) {
  if (s === '') return true;
  if (/^[\s]|[\s]$/.test(s)) return true; // leading/trailing whitespace
  if (/[\x00-\x1f\x7f]/.test(s)) return true; // tab, newline, CR, other controls: escaped
  if (/^[-?:,\[\]{}#&*!|>'"%@`]/.test(s)) return true; // reserved leading chars
  if (/:\s|\s#/.test(s)) return true; // ": " or " #" inside
  if (/^(true|false|null|~|yes|no|on|off)$/i.test(s)) return true;
  if (/^-?\d+$/.test(s)) return true; // pure integer string would parse back as a number
  return false;
}

function serializeScalar(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const s = String(value);
  if (needsQuoting(s)) {
    return '"' + escapeDouble(s) + '"';
  }
  return s;
}

function serializeNode(value, indent, lines) {
  const pad = INDENT.repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return; // handled inline by caller
    for (const item of value) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const keys = Object.keys(item);
        if (keys.length === 0) {
          lines.push(`${pad}- {}`);
          continue;
        }
        keys.forEach((k, i) => {
          const prefix = i === 0 ? `${pad}- ` : `${pad}  `;
          appendKey(prefix, k, item[k], indent + 1, lines);
        });
      } else {
        lines.push(`${pad}- ${serializeScalar(item)}`);
      }
    }
    return;
  }

  if (value !== null && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      appendKey(pad, k, value[k], indent, lines);
    }
  }
}

function appendKey(prefix, key, value, childIndent, lines) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${prefix}${key}: []`);
    } else {
      lines.push(`${prefix}${key}:`);
      serializeNode(value, childIndent + 1, lines);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    // An empty mapping must stay a mapping; a bare `key:` would read back as null.
    lines.push(Object.keys(value).length === 0 ? `${prefix}${key}: {}` : `${prefix}${key}:`);
    serializeNode(value, childIndent + 1, lines);
    return;
  }
  const style = typeof value === 'string' ? blockStyle(value) : null;
  if (style) {
    lines.push(`${prefix}${key}: ${style}`);
    const blockPad = INDENT.repeat(childIndent + 1);
    for (const ln of (style === '|' ? value.slice(0, -1) : value).split('\n')) {
      lines.push(ln === '' ? '' : blockPad + ln);
    }
    return;
  }
  lines.push(`${prefix}${key}: ${serializeScalar(value)}`);
}

/**
 * The literal block header that reproduces a multi-line string exactly, or
 * null when no plain `|` / `|-` can (control characters, whitespace-only or
 * trailing blank lines, a first line that starts with whitespace); such a
 * string is written double-quoted with escapes instead.
 */
function blockStyle(s) {
  if (!s.includes('\n') || /[\x00-\x08\x0b-\x1f\x7f]/.test(s)) return null;
  const clip = s.endsWith('\n');
  const blockLines = (clip ? s.slice(0, -1) : s).split('\n');
  if (blockLines[blockLines.length - 1] === '') return null; // more than one trailing newline
  if (blockLines.some((l) => l !== '' && l.trim() === '')) return null; // would read back as empty
  if (/^\s/.test(blockLines.find((l) => l !== ''))) return null; // would need an indentation indicator
  return clip ? '|' : '|-';
}

/** Serialize an object back to YAML text, preserving key insertion order. */
function stringifyYaml(obj) {
  const lines = [];
  serializeNode(obj, 0, lines);
  return lines.join('\n');
}

/**
 * Where two parsed trees first differ, as a path such as `custom.note` or
 * `labels[2]` (`(document)` for the root), or null when they are identical.
 * Key order counts: it is part of what a save must preserve.
 */
function firstDifference(a, b, path = '') {
  const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
  const here = path || '(document)';
  if (kind(a) !== kind(b)) return here;
  if (kind(a) === 'array') {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = i < a.length && i < b.length ? firstDifference(a[i], b[i], `${path}[${i}]`) : `${path}[${i}]`;
      if (d) return d;
    }
    return null;
  }
  if (kind(a) === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const key = ka[i] !== undefined ? ka[i] : kb[i];
      const at = path ? `${path}.${key}` : key;
      if (ka[i] !== kb[i]) return at;
      const d = firstDifference(a[key], b[key], at);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : here;
}

/**
 * Round-trip guard (REVIEW-2026-09 A1): would writing this YAML back through
 * stringifyYaml(parseYaml(text)) change what it says? Returns null when it
 * would not, otherwise the path of the first difference.
 *
 * The comparison is made on the parsed structure, so formatting is tolerated:
 * indentation, comments, blank lines, quote style ('x', "x", x), flow versus
 * block collections, a literal block versus an escaped string, and the
 * spelling of null. Content is not: a dropped or reordered key, a changed
 * string, an integer written differently (007), and text this engine keeps
 * as a plain string although YAML gives it a meaning (&anchor, *alias, !tag,
 * a folded > block). Throws, like parseYaml, when `text` does not parse.
 */
function roundTripDifference(text) {
  const value = parseYaml(text);
  const written = stringifyYaml(value);
  let again;
  let writtenTokens;
  try {
    again = parseYaml(written);
    writtenTokens = parseYaml(written, { fidelity: true });
  } catch (err) {
    return `(document): the re-serialized text does not parse (${err.message})`;
  }
  return firstDifference(parseYaml(text, { fidelity: true }), writtenTokens) || firstDifference(value, again);
}

/**
 * Split a work-item file into { frontMatter, body }.
 * `frontMatter` is the YAML text between the leading `---` fences (without them).
 * Returns frontMatter === null when the file has no front matter.
 */
function splitDocument(text) {
  const normalized = text.replace(/^﻿/, '');
  const m = normalized.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/);
  if (!m) return { frontMatter: null, body: normalized };
  return { frontMatter: m[1], body: m[2] != null ? m[2] : '' };
}

/** Reassemble a file from a (possibly serialized) front matter string and body. */
function joinDocument(frontMatterText, body) {
  const fm = frontMatterText.replace(/\s+$/, '');
  return `---\n${fm}\n---\n\n${body.replace(/^(?:\r?\n)+/, '')}`;
}

/**
 * Rebuild a file with new front-matter text and body, keeping everything else
 * of the original exactly: a BOM, the fences as written, the line ending.
 * This is the verbatim save for items the round-trip guard flags: the text
 * typed in the raw editor is written as is, never re-serialized.
 * `frontMatterText` uses LF or the file's own line ending; in a CRLF file
 * its line breaks are written as CRLF.
 */
function replaceFrontMatter(fileText, frontMatterText, body) {
  const m = String(fileText).match(/^(﻿?---[ \t]*(\r?\n))[\s\S]*?(\r?\n---[ \t]*)(?:(\r?\n)[\s\S]*)?$/);
  if (!m) return `---\n${frontMatterText}\n---\n${body}`;
  const eol = m[2];
  const fm = eol === '\r\n' ? frontMatterText.replace(/\r?\n/g, '\r\n') : frontMatterText;
  const afterFence = m[4] != null ? m[4] : body !== '' ? eol : '';
  return m[1] + fm + m[3] + afterFence + body;
}

/**
 * Minimal, surgical edit: replace the value of a top-level scalar key in raw
 * front-matter text without touching anything else. Used for drag/drop so that
 * "no other changes are allowed" (PROMPT.md §4.5) is honoured literally.
 * Returns the new full file text, or null if the key line was not found.
 *
 * Only a key in the top-level column matches (column 0, or the column of the
 * first key in a uniformly indented front matter), so a nested `agent.status`
 * is never patched instead of `status`. Line endings and a trailing comment
 * on the patched line are kept.
 */
function patchScalarLine(fileText, key, newValue) {
  const { frontMatter } = splitDocument(fileText);
  if (frontMatter === null) return null;
  const parts = fileText.split(/(\r?\n)/); // lines at even indices, their endings at odd ones
  const line = (i) => parts[2 * i];
  const count = (parts.length + 1) / 2;
  // Line 0 is the opening fence (possibly after a BOM); stop at the closing one.
  let end = count;
  for (let i = 1; i < count; i++) {
    if (/^---[ \t]*$/.test(line(i))) {
      end = i;
      break;
    }
  }
  let topIndent = null;
  for (let i = 1; i < end && topIndent === null; i++) {
    if (!isSkippable(line(i))) topIndent = indentOf(line(i));
  }
  if (topIndent === null) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^( {${topIndent}}${escaped}[ \\t]*:)(?=\\s|$)(.*)$`);
  for (let i = 1; i < end; i++) {
    const m = line(i).match(re);
    if (!m) continue;
    const old = m[2].trim();
    const comment = old.slice(stripComment(old).length).trim();
    parts[2 * i] = `${m[1]} ${serializeScalar(newValue)}${comment ? ` ${comment}` : ''}`;
    return parts.join('');
  }
  return null;
}

Object.assign(WS, {
  parseYaml, stringifyYaml, splitDocument, joinDocument, patchScalarLine,
  roundTripDifference, replaceFrontMatter,
});
})(window.WS = window.WS || {});
