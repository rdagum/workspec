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

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;

  // Quoted strings — strip the quotes, keep the literal contents.
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }

  // Inline flow sequence: [], [a, b, c]
  if (s[0] === '[' && s[s.length - 1] === ']') {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return splitFlow(inner).map((part) => parseScalar(part));
  }

  // Inline flow mapping: {}, { block: 1, owner: rdagum }. The ID block registry
  // uses this form so one clone is one line. Anything that does not split
  // cleanly into "key: value" pairs is kept as the literal string it was.
  if (s[0] === '{' && s[s.length - 1] === '}') {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return {};
    const obj = {};
    for (const part of splitFlow(inner)) {
      const kv = splitKeyValue(part);
      if (!kv || kv.key === '') return s;
      obj[kv.key] = parseScalar(kv.rest);
    }
    return obj;
  }

  // Integers become numbers; decimals stay strings so values like "1.0"
  // (e.g. spec_version) round-trip exactly instead of collapsing to "1".
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);

  return s;
}

// Split a flow-collection body on commas that are not inside quotes or a
// nested collection.
function splitFlow(inner) {
  const out = [];
  let buf = '';
  let quote = null;
  let depth = 0;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      buf += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
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
  // Find the first ": " or trailing ":" that is not inside quotes.
  let quote = null;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
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
  let quote = null;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
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
  const lines = text.split(/\r?\n/);
  const source = lines.slice(); // parseSequence rewrites lines; errors quote the original
  let idx = 0;

  function fail(i, message) {
    const shown = source[i].trim();
    const snippet = shown.length > 60 ? `${shown.slice(0, 57)}...` : shown;
    const err = new Error(`line ${i + 1 + offset}: ${message}: "${snippet}"`);
    err.line = i + 1 + offset;
    return err;
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
      joined += ' ' + line.trim();
      idx++;
      if (flowDepth(joined) <= 0) return joined;
    }
    idx = start;
    return first;
  }

  function parseBlockScalar(parentIndent, marker) {
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
    // Trim trailing blank lines.
    while (collected.length && collected[collected.length - 1] === '') collected.pop();
    let value = collected.join('\n');
    const folded = marker[0] === '>';
    if (folded) value = value.replace(/\n(?!\n)/g, ' ');
    if (marker.length === 1) value += '\n'; // clip: keep single trailing newline
    return value;
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
      const itemBody = content.slice(1).trim();
      idx++;
      if (itemBody === '') {
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
        arr.push(parseScalar(itemBody));
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
      const { key, rest } = kv;
      if (Object.prototype.hasOwnProperty.call(firstLine, key)) {
        throw fail(idx, `duplicate key "${key}" (first set on line ${firstLine[key] + 1 + offset})`);
      }
      firstLine[key] = idx;
      idx++;

      if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-' || rest === '|+' || rest === '>+') {
        obj[key] = parseBlockScalar(ci, rest);
        continue;
      }
      if (rest !== '') {
        obj[key] = parseScalar(/^[[{]/.test(rest) ? readFlow(rest, ci) : rest);
        continue;
      }
      // Empty value -> nested mapping, sequence, flow collection, or null.
      const nxt = nextSignificant();
      if (!nxt) {
        obj[key] = null;
        continue;
      }
      const ni = indentOf(nxt);
      const ncontent = nxt.slice(ni);
      if (ni > ci && /^[[{]/.test(ncontent)) {
        while (lines[idx] !== nxt) idx++;
        idx++;
        obj[key] = parseScalar(readFlow(ncontent, ci));
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
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
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
  if (typeof value === 'string' && value.includes('\n')) {
    lines.push(`${prefix}${key}: |`);
    const blockPad = INDENT.repeat(childIndent + 1);
    for (const ln of value.replace(/\n$/, '').split('\n')) {
      lines.push(ln === '' ? '' : blockPad + ln);
    }
    return;
  }
  lines.push(`${prefix}${key}: ${serializeScalar(value)}`);
}

/** Serialize an object back to YAML text, preserving key insertion order. */
function stringifyYaml(obj) {
  const lines = [];
  serializeNode(obj, 0, lines);
  return lines.join('\n');
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
 * Minimal, surgical edit: replace the value of a top-level scalar key in raw
 * front-matter text without touching anything else. Used for drag/drop so that
 * "no other changes are allowed" (PROMPT.md §4.5) is honoured literally.
 * Returns the new full file text, or null if the key line was not found.
 */
function patchScalarLine(fileText, key, newValue) {
  const { frontMatter } = splitDocument(fileText);
  if (frontMatter === null) return null;
  const lines = fileText.split(/\r?\n/);
  // Locate the closing fence so we only touch the front matter region.
  let fenceCount = 0;
  let endFence = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i])) {
      fenceCount++;
      if (fenceCount === 2) {
        endFence = i;
        break;
      }
    }
  }
  const limit = endFence === -1 ? lines.length : endFence;
  const re = new RegExp(`^(\\s*${key}\\s*:)(\\s.*)?$`);
  for (let i = 1; i < limit; i++) {
    if (re.test(lines[i])) {
      const m = lines[i].match(re);
      lines[i] = `${m[1]} ${serializeScalar(newValue)}`;
      return lines.join('\n');
    }
  }
  return null;
}

Object.assign(WS, { parseYaml, stringifyYaml, splitDocument, joinDocument, patchScalarLine });
})(window.WS = window.WS || {});
