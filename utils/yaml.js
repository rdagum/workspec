// utils/yaml.js
//
// A small, order-preserving YAML engine purpose-built for WorkSpec front matter.
//
// It is deliberately NOT a full YAML 1.2 implementation. It supports the subset
// that WorkSpec work items use:
//   - scalar values (strings, numbers, booleans, null, dates-as-strings)
//   - quoted scalars (single/double)
//   - block sequences ("- item")
//   - inline flow sequences ("[a, b, c]" and "[]")
//   - nested mappings (for reserved namespaces: extensions / custom / agent)
//   - block scalars ("|" and ">")
//
// Design goals (see SPEC.md §15 and PROMPT.md §5):
//   - preserve field order              -> objects keep insertion order
//   - preserve unknown fields           -> nothing is dropped
//   - avoid unnecessary normalization   -> values round-trip as written
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

  // Integers become numbers; decimals stay strings so values like "1.0"
  // (e.g. spec_version) round-trip exactly instead of collapsing to "1".
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);

  return s;
}

// Split a flow-sequence body on commas that are not inside quotes.
function splitFlow(inner) {
  const out = [];
  let buf = '';
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      buf += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === ',') {
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

/**
 * Parse a YAML document (the front-matter block, without the `---` fences)
 * into a plain object whose key order matches the source.
 */
function parseYaml(text) {
  const lines = text.split(/\r?\n/);
  let idx = 0;

  function nextSignificant() {
    let j = idx;
    while (j < lines.length) {
      const l = lines[j];
      if (l.trim() === '' || l.trimStart().startsWith('#')) {
        j++;
        continue;
      }
      return l;
    }
    return null;
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
      if (line.trim() === '' || line.trimStart().startsWith('#')) {
        idx++;
        continue;
      }
      const ci = indentOf(line);
      if (ci < seqIndent) break;
      const content = line.slice(ci);
      if (!content.startsWith('- ') && content !== '-') break;
      const itemBody = content.slice(1).trim();
      idx++;
      if (itemBody === '') {
        // Nested structure under the dash.
        const nxt = nextSignificant();
        if (nxt && indentOf(nxt) > seqIndent) {
          arr.push(parseMapping(indentOf(nxt)));
        } else {
          arr.push(null);
        }
      } else if (splitKeyValue(itemBody)) {
        // Inline "- key: value" starts a mapping at the dash's content column.
        idx--; // re-read this line as a mapping, treating the dash area as indent
        const mapIndent = ci + 2;
        // Rewrite current line so the mapping parser sees plain indentation.
        lines[idx] = ' '.repeat(mapIndent) + content.slice(2);
        arr.push(parseMapping(mapIndent));
      } else {
        arr.push(parseScalar(itemBody));
      }
    }
    return arr;
  }

  function parseMapping(mapIndent) {
    const obj = {};
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.trim() === '' || line.trimStart().startsWith('#')) {
        idx++;
        continue;
      }
      const ci = indentOf(line);
      if (ci < mapIndent) break;
      if (ci > mapIndent) break; // malformed; let caller handle
      const content = line.slice(ci);
      if (content.startsWith('- ')) break; // sequence belongs to a parent key
      const kv = splitKeyValue(content);
      if (!kv) {
        idx++;
        continue;
      }
      const { key, rest } = kv;
      idx++;

      if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-' || rest === '|+' || rest === '>+') {
        obj[key] = parseBlockScalar(ci, rest);
        continue;
      }
      if (rest !== '') {
        obj[key] = parseScalar(rest);
        continue;
      }
      // Empty value -> nested mapping, sequence, or null.
      const nxt = nextSignificant();
      if (!nxt) {
        obj[key] = null;
        continue;
      }
      const ni = indentOf(nxt);
      const ncontent = nxt.slice(ni);
      if (ni > ci && (ncontent.startsWith('- ') || ncontent === '-')) {
        obj[key] = parseSequence(ni);
      } else if (ni > ci) {
        obj[key] = parseMapping(ni);
      } else {
        obj[key] = null;
      }
    }
    return obj;
  }

  const first = nextSignificant();
  if (!first) return {};
  return parseMapping(indentOf(first));
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
    lines.push(`${prefix}${key}:`);
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
  return `---\n${fm}\n---\n\n${body.replace(/^\n+/, '')}`;
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
