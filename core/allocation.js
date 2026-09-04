// core/allocation.js
//
// ID allocation across working copies (SPEC.md §18.1, a 1.1 extension; the
// design is docs/REVIEW-2026-09.md §3). Three layers, all pure functions so the
// board, the tests and the command-line tools share one implementation:
//
//   prevention  — every clone owns a block of numbers per type. The block is
//                 named in the git-ignored config/user.local.yaml and recorded
//                 in the committed registry config/id-blocks.yaml, so two
//                 clones can never mint the same ID however their branches
//                 diverge. Block 0 is the legacy sequential range.
//   detection   — validateRepository() finds duplicate IDs, registry problems
//                 and items that sit in someone else's block.
//   repair      — renumberPlan() computes the file rewrites that move one item
//                 to a new ID and fix every reference to it.
//
// Nothing here touches the filesystem: callers (state/store.js, tools/) read
// and write the text this module hands back.

(function (WS) {
'use strict';

const { parseId, formatId, isValidId, nextId, blockOf, blockRange, maxBlock, MAX_NUMBER, DEFAULT_BLOCK_SIZE } = WS;

const STRATEGIES = ['sequential', 'block'];
const REGISTRY_PATH = 'config/id-blocks.yaml';
const LOCAL_PATH = 'config/user.local.yaml';
// Metadata fields whose values are work-item IDs (SPEC.md §10).
const REFERENCE_FIELDS = ['parent', 'depends_on', 'blocks', 'related'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const REGISTRY_HEADER = [
  '# Claimed ID blocks (SPEC.md §18.1). One line per working copy; commit this file.',
  '# Block N covers TYPE-N001 … TYPE-(N+1)000 for every type when block_size is 1000.',
  '# Never edit or reuse a block that has been claimed by someone else.',
];

// --- Configuration ---------------------------------------------------------

/** Coerce a YAML scalar to an integer, or NaN. */
function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return parseInt(v, 10);
  return NaN;
}

/**
 * Normalise board.yaml `id_allocation` into { strategy, blockSize, errors }.
 * Absent or empty config means `sequential`, the 1.0 behaviour.
 */
function parseIdAllocation(raw) {
  const out = { strategy: 'sequential', blockSize: DEFAULT_BLOCK_SIZE, errors: [] };
  if (raw == null) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    out.errors.push('id_allocation must be a mapping with `strategy` and optional `block_size`.');
    return out;
  }
  if (raw.strategy != null && raw.strategy !== '') {
    const s = String(raw.strategy).toLowerCase();
    if (STRATEGIES.includes(s)) out.strategy = s;
    else out.errors.push(`id_allocation.strategy "${raw.strategy}" is not one of: ${STRATEGIES.join(', ')}.`);
  }
  if (raw.block_size != null && raw.block_size !== '') {
    const n = toInt(raw.block_size);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_NUMBER) out.blockSize = n;
    else out.errors.push(`id_allocation.block_size "${raw.block_size}" must be an integer between 1 and ${MAX_NUMBER}.`);
  }
  return out;
}

/**
 * Parse the registry (`config/id-blocks.yaml`, already YAML-parsed) into
 * { blocks: [{ block, owner, label, claimed }], errors[] }. Entries that
 * cannot be understood are reported and skipped; a duplicate block number is
 * an error on the later entry, since the earlier claim wins.
 */
function parseIdBlocks(data, blockSize = DEFAULT_BLOCK_SIZE) {
  const out = { blocks: [], errors: [] };
  const list = Array.isArray(data) ? data : data && Array.isArray(data.blocks) ? data.blocks : null;
  if (list === null) {
    if (data && Object.keys(data).length && data.blocks != null) out.errors.push('`blocks` must be a sequence of { block, owner, label } entries.');
    return out;
  }
  const seen = new Map();
  const top = maxBlock(blockSize);
  list.forEach((entry, i) => {
    const where = `blocks[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      out.errors.push(`${where}: expected a mapping like { block: 1, owner: name, label: machine }.`);
      return;
    }
    const block = toInt(entry.block);
    if (!Number.isInteger(block)) {
      out.errors.push(`${where}: \`block\` must be an integer.`);
      return;
    }
    if (block === 0) {
      out.errors.push(`${where}: block 0 is the legacy sequential range and cannot be claimed.`);
      return;
    }
    if (block < 0 || block > top) {
      out.errors.push(`${where}: block ${block} is outside 1-${top} for block_size ${blockSize}.`);
      return;
    }
    const owner = entry.owner == null ? '' : String(entry.owner).trim();
    if (!owner) {
      out.errors.push(`${where}: block ${block} has no \`owner\`.`);
      return;
    }
    const label = entry.label == null ? '' : String(entry.label).trim();
    let claimed = null;
    if (entry.claimed != null && entry.claimed !== '') {
      claimed = String(entry.claimed).trim();
      if (!DATE_RE.test(claimed)) {
        out.errors.push(`${where}: \`claimed\` must be a YYYY-MM-DD date, got "${entry.claimed}".`);
        claimed = null;
      }
    }
    if (seen.has(block)) {
      const first = seen.get(block);
      out.errors.push(`${where}: block ${block} is already claimed by ${first.owner}${first.label ? ` / ${first.label}` : ''}; two clones sharing a block will collide.`);
      return;
    }
    const rec = { block, owner, label, claimed };
    seen.set(block, rec);
    out.blocks.push(rec);
  });
  return out;
}

/** Registry entry for a block number, or null. */
function findBlock(blocks, block) {
  return (blocks || []).find((b) => b.block === block) || null;
}

/** Human label for a registry entry: "rdagum / macbook". */
function describeBlock(entry) {
  if (!entry) return '';
  return entry.label ? `${entry.owner} / ${entry.label}` : entry.owner;
}

// --- Allocation ------------------------------------------------------------

/**
 * Every ID the repository already uses: declared `id:` values plus the file
 * stems, so a file whose front matter failed to parse still reserves its
 * number. Both sources must agree for a clean repository; the union is what
 * keeps allocation safe when they do not.
 */
function knownIds(model) {
  const ids = new Set();
  for (const record of model.items.values()) {
    const declared = record.meta && record.meta.id;
    if (declared != null && isValidId(String(declared))) ids.add(String(declared));
    const stem = String(record.fileName || '').replace(/\.md$/i, '');
    if (isValidId(stem)) ids.add(stem);
  }
  return ids;
}

/**
 * What the current clone may allocate:
 *   { strategy, blockSize, block, entry, problem }
 * `problem` is null when allocation can proceed, otherwise one of
 * 'no-block' (strategy block, user.local.yaml has no id_block),
 * 'invalid-block' (id_block is not a usable number) or
 * 'unregistered' (id_block is not in the registry).
 */
function allocationState(model) {
  const { strategy, blockSize } = model.idAllocation || parseIdAllocation(null);
  const state = { strategy, blockSize, block: null, entry: null, problem: null };
  if (strategy !== 'block') return state;
  const raw = model.local ? model.local.id_block : undefined;
  if (raw == null || raw === '') {
    state.problem = 'no-block';
    return state;
  }
  const block = toInt(raw);
  if (!Number.isInteger(block) || block < 1 || block > maxBlock(blockSize)) {
    state.problem = 'invalid-block';
    return state;
  }
  state.block = block;
  state.entry = findBlock(model.idBlocks, block);
  if (!state.entry) state.problem = 'unregistered';
  return state;
}

/** Message explaining why allocation is blocked for a given `problem`. */
function allocationProblemMessage(state) {
  switch (state.problem) {
    case 'no-block':
      return `This repository allocates IDs in blocks, but ${LOCAL_PATH} names no id_block for this clone.`;
    case 'invalid-block':
      return `id_block in ${LOCAL_PATH} is not a block number between 1 and ${maxBlock(state.blockSize)}.`;
    case 'unregistered':
      return `id_block ${state.block} in ${LOCAL_PATH} is not claimed in ${REGISTRY_PATH}.`;
    default:
      return '';
  }
}

/**
 * Next ID for `type` under the repository's allocation rules. Throws with
 * `err.code` set to the allocation problem when a block is required but not
 * configured, and with the message from nextId when the block is exhausted.
 */
function allocateId(model, type) {
  const state = allocationState(model);
  if (state.problem) {
    const err = new Error(allocationProblemMessage(state));
    err.code = state.problem;
    throw err;
  }
  const ids = knownIds(model);
  if (state.strategy !== 'block') return nextId(type, ids);
  return nextId(type, ids, { block: state.block, blockSize: state.blockSize });
}

/**
 * Lowest block number (from 1) that is neither in the registry nor already
 * populated by items of any type. Legacy repositories with more than one
 * block of sequential items therefore skip past blocks 0..k automatically.
 */
function lowestFreeBlock(blocks, ids, blockSize = DEFAULT_BLOCK_SIZE) {
  const taken = new Set((blocks || []).map((b) => b.block));
  for (const id of ids) {
    const p = parseId(id);
    if (p) taken.add(blockOf(p.number, blockSize));
  }
  const top = maxBlock(blockSize);
  for (let n = 1; n <= top; n++) if (!taken.has(n)) return n;
  throw new Error(`Every ID block is claimed or occupied (block_size ${blockSize}).`);
}

// --- Config file text edits ------------------------------------------------

function eolOf(text) {
  return /\r\n/.test(text) ? '\r\n' : '\n';
}

/** Quote a config scalar only when it would otherwise be misread; numbers stay bare. */
function flowScalar(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  const s = String(v);
  if (/^[A-Za-z0-9_.@+\/-]+$/.test(s) && !/^(true|false|null|~)$/i.test(s) && !/^-?\d+$/.test(s)) return s;
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** One registry line: `  - { block: 2, owner: rdagum, label: macbook, claimed: 2026-09-04 }`. */
function formatBlockEntry(entry) {
  const parts = [`block: ${entry.block}`, `owner: ${flowScalar(entry.owner)}`];
  if (entry.label) parts.push(`label: ${flowScalar(entry.label)}`);
  if (entry.claimed) parts.push(`claimed: ${entry.claimed}`);
  return `  - { ${parts.join(', ')} }`;
}

/**
 * Append a claim to the registry text, creating the file content when empty.
 * The new line goes at the end of the `blocks:` sequence so the result stays
 * valid YAML even if other keys follow. Comments and existing lines are untouched.
 */
function appendBlockEntry(text, entry) {
  const src = text == null ? '' : String(text);
  const eol = eolOf(src);
  if (src.trim() === '') {
    return [...REGISTRY_HEADER, 'blocks:', formatBlockEntry(entry)].join(eol) + eol;
  }
  const lines = src.replace(/\r?\n$/, '').split(/\r?\n/);
  let keyIdx = lines.findIndex((l) => /^blocks\s*:/.test(l));
  if (keyIdx === -1) {
    lines.push('blocks:');
    keyIdx = lines.length - 1;
  } else if (/^blocks\s*:\s*\[\s*\]\s*$/.test(lines[keyIdx])) {
    lines[keyIdx] = 'blocks:';
  }
  let insertAt = keyIdx + 1;
  for (let j = keyIdx + 1; j < lines.length; j++) {
    const l = lines[j];
    if (l.trim() === '' || l.trimStart().startsWith('#')) continue;
    if (/^\s/.test(l)) insertAt = j + 1;
    else break;
  }
  lines.splice(insertAt, 0, formatBlockEntry(entry));
  return lines.join(eol) + eol;
}

/**
 * Set top-level scalar keys in a plain YAML config (no front matter), replacing
 * existing lines in place and appending missing ones. Everything else is kept.
 */
function setLocalKeys(text, patch) {
  const src = text == null ? '' : String(text);
  const eol = eolOf(src);
  const lines = src.trim() === '' ? [] : src.replace(/\r?\n$/, '').split(/\r?\n/);
  for (const [key, value] of Object.entries(patch)) {
    const re = new RegExp(`^${key}\\s*:(\\s.*)?$`);
    const idx = lines.findIndex((l) => re.test(l));
    const line = `${key}: ${flowScalar(value)}`;
    if (idx === -1) lines.push(line);
    else lines[idx] = line;
  }
  return lines.join(eol) + eol;
}

// --- Repository-wide validation -------------------------------------------

/**
 * Cross-file checks that a single item cannot make on its own. Builds
 * `model.itemsById`, appends to `model.loadErrors` / `model.warnings`, and
 * marks offending records so the board shows them. Returns what it added.
 *
 * Checks:
 *   - duplicate IDs across files (error on every file involved)
 *   - an item inside a claimed block but created before the claim date
 *     (it was allocated by someone else; error)
 *   - user.local.yaml id_block that is invalid or not in the registry (error
 *     under strategy block; a warning that it is ignored under sequential)
 * Registry-internal problems (duplicates, block 0, bad entries) are reported
 * by parseIdBlocks when the file is read.
 */
function validateRepository(model) {
  const errors = [];
  const warnings = [];
  const { strategy, blockSize } = model.idAllocation || parseIdAllocation(null);
  const blocks = model.idBlocks || [];

  // Index by declared ID and find duplicates.
  const groups = new Map();
  for (const record of model.items.values()) {
    const id = record.meta && record.meta.id;
    if (id == null || !isValidId(String(id))) continue;
    const key = String(id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  model.itemsById = new Map();
  for (const [id, records] of groups) {
    model.itemsById.set(id, records[0]);
    if (records.length < 2) continue;
    for (const record of records) {
      const others = records.filter((r) => r !== record).map((r) => r.path).join(', ');
      const message = `Duplicate ID "${id}" is also declared by ${others}. Renumber the copy that has not been merged (tools/renumber.js).`;
      record.errors.push(message);
      errors.push({ file: record.path, message, code: 'duplicate-id' });
    }
  }

  // Items created before their block was claimed came from another allocator.
  for (const record of model.items.values()) {
    const parsed = record.meta && record.meta.id != null ? parseId(String(record.meta.id)) : null;
    if (!parsed) continue;
    const entry = findBlock(blocks, blockOf(parsed.number, blockSize));
    if (!entry || !entry.claimed) continue;
    const created = record.meta.created;
    if (typeof created !== 'string' || !DATE_RE.test(created) || created >= entry.claimed) continue;
    const message =
      `${record.meta.id} lies in ID block ${entry.block} (${describeBlock(entry)}) but was created on ${created}, ` +
      `before that block was claimed on ${entry.claimed}; it was allocated by someone else.`;
    record.errors.push(message);
    errors.push({ file: record.path, message, code: 'foreign-item' });
  }

  // Local block versus registry.
  const rawBlock = model.local ? model.local.id_block : undefined;
  if (rawBlock != null && rawBlock !== '') {
    const block = toInt(rawBlock);
    if (!Number.isInteger(block) || block < 1 || block > maxBlock(blockSize)) {
      errors.push({
        file: LOCAL_PATH,
        message: `id_block "${rawBlock}" is not a block number between 1 and ${maxBlock(blockSize)}.`,
        code: 'invalid-local-block',
      });
    } else if (strategy === 'block' && !findBlock(blocks, block)) {
      errors.push({
        file: LOCAL_PATH,
        message: `id_block ${block} is not claimed in ${REGISTRY_PATH}. Claim it (and commit the registry) before creating items.`,
        code: 'unregistered-local-block',
      });
    } else if (strategy !== 'block') {
      warnings.push(`${LOCAL_PATH} sets id_block ${block}, but board.yaml has no id_allocation.strategy: block, so it is ignored.`);
    }
  }

  model.loadErrors.push(...errors);
  model.warnings.push(...warnings);
  return { errors, warnings };
}

// --- Repair: renumbering ---------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-ID match: not glued to a preceding ID character, not followed by more digits/letters. */
function idPattern(id) {
  return new RegExp(`(?<![A-Za-z0-9-])${escapeRegExp(id)}(?![A-Za-z0-9])`, 'g');
}

/** Index of the closing front-matter fence in `lines`, or -1. Lines keep their `\r`. */
function closingFence(lines) {
  if (!lines.length || !/^﻿?---[ \t]*\r?$/.test(lines[0])) return -1;
  for (let i = 1; i < lines.length; i++) if (/^---[ \t]*\r?$/.test(lines[i])) return i;
  return -1;
}

/**
 * Replace references to `oldId` with `newId` in one file's text, touching only
 * the relationship fields of the front matter (parent, depends_on, blocks,
 * related) and, with `body: true`, whole-word mentions in the Markdown body.
 * Line endings, comments and every other line are preserved byte for byte.
 * Returns { text, changed } where `changed` counts rewritten lines.
 */
function rewriteReferences(text, oldId, newId, { body = false } = {}) {
  const re = idPattern(oldId);
  const lines = String(text).split('\n');
  const end = closingFence(lines);
  let changed = 0;
  const swap = (i) => {
    const next = lines[i].replace(re, newId);
    if (next !== lines[i]) {
      lines[i] = next;
      changed++;
    }
  };
  let key = null;
  for (let i = 1; i < (end === -1 ? 0 : end); i++) {
    const line = lines[i];
    const km = line.match(/^([A-Za-z_][\w-]*)\s*:/);
    if (km) key = km[1];
    else if (/^[^\s#]/.test(line)) key = null;
    if (REFERENCE_FIELDS.includes(key)) swap(i);
  }
  if (body) for (let i = end + 1; i < lines.length; i++) swap(i);
  return { text: lines.join('\n'), changed };
}

/**
 * Surgically rewrite the `id:` line of an item to `newId`. Returns the new
 * text, or null when there is no such line in the front matter.
 */
function patchIdLine(text, newId) {
  const lines = String(text).split('\n');
  const end = closingFence(lines);
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^(id\s*:)(\s.*?)?(\r?)$/);
    if (m) {
      lines[i] = `${m[1]} ${newId}${m[3]}`;
      return lines.join('\n');
    }
  }
  return null;
}

/**
 * Plan the file changes that move `oldId` to `newId`:
 *   { rename: { from, to, text }, updates: [{ path, text, changed }] }
 * Throws when the request is unsafe: malformed or mismatched IDs, an unknown
 * source item, or a target that already exists. Nothing is written.
 */
function renumberPlan(model, oldId, newId, { body = false } = {}) {
  if (!isValidId(oldId)) throw new Error(`"${oldId}" is not a valid work-item ID.`);
  if (!isValidId(newId)) throw new Error(`"${newId}" is not a valid work-item ID (expected TYPE-000000).`);
  if (oldId === newId) throw new Error('Old and new IDs are the same.');
  if (parseId(oldId).type !== parseId(newId).type) {
    throw new Error(`Cannot change the type: ${oldId} → ${newId}. Renumbering keeps the TYPE prefix.`);
  }
  const ids = knownIds(model);
  if (ids.has(newId)) throw new Error(`${newId} already exists in this repository.`);
  const source =
    [...model.items.values()].find((r) => r.meta && String(r.meta.id) === oldId) ||
    model.items.get(`items/${oldId}.md`) ||
    null;
  if (!source) throw new Error(`${oldId} was not found under items/.`);

  const dir = source.path.includes('/') ? source.path.slice(0, source.path.lastIndexOf('/') + 1) : '';
  const patched = patchIdLine(source.raw, newId);
  if (patched === null) throw new Error(`${source.path} has no id: line in its front matter.`);
  // The item may mention itself in its own body; rewrite that too.
  const self = rewriteReferences(patched, oldId, newId, { body });
  const plan = { rename: { from: source.path, to: `${dir}${newId}.md`, text: self.text }, updates: [] };

  for (const record of model.items.values()) {
    if (record === source) continue;
    const { text, changed } = rewriteReferences(record.raw, oldId, newId, { body });
    if (changed) plan.updates.push({ path: record.path, text, changed });
  }
  return plan;
}

Object.assign(WS, {
  REGISTRY_PATH, LOCAL_PATH, REFERENCE_FIELDS, STRATEGIES,
  parseIdAllocation, parseIdBlocks, findBlock, describeBlock,
  knownIds, allocationState, allocationProblemMessage, allocateId, lowestFreeBlock,
  formatBlockEntry, appendBlockEntry, setLocalKeys,
  validateRepository,
  rewriteReferences, patchIdLine, renumberPlan,
});
})(window.WS = window.WS || {});
