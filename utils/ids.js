// utils/ids.js
//
// Work-item identity rules (SPEC.md §7.2, PROMPT.md §5.3):
//   - format: TYPE-000123
//   - zero-padded to six digits
//   - unique within a project
//   - immutable once assigned
//
// Allocator blocks (SPEC.md §18.1, a 1.1 extension): the six-digit space of
// each type can be divided into blocks of `blockSize` numbers. Block N covers
// N*blockSize+1 … (N+1)*blockSize, so block 0 is the legacy sequential range
// and existing items never move. A working copy that owns a block allocates
// only inside it, which is what keeps two clones from ever minting the same ID.

(function (WS) {
'use strict';

const ID_PAD = 6;
const ID_RE = /^([A-Z]+)-(\d{6})$/;
const MAX_NUMBER = 999999; // largest sequence a six-digit ID can hold
const DEFAULT_BLOCK_SIZE = 1000;

/** Validate a fully-formed work-item ID. */
function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

/** Build an ID from a type and a numeric sequence, e.g. ("STORY", 1) -> STORY-000001. */
function formatId(type, n) {
  return `${String(type).toUpperCase()}-${String(n).padStart(ID_PAD, '0')}`;
}

/** Pull the { type, number } out of an ID, or null when malformed. */
function parseId(id) {
  const m = String(id).match(ID_RE);
  if (!m) return null;
  return { type: m[1], number: parseInt(m[2], 10) };
}

function assertBlockSize(blockSize) {
  if (!Number.isInteger(blockSize) || blockSize < 1 || blockSize > MAX_NUMBER) {
    throw new RangeError(`Invalid block size ${blockSize}; expected an integer between 1 and ${MAX_NUMBER}.`);
  }
}

/** Highest block number that still starts inside the six-digit range. */
function maxBlock(blockSize = DEFAULT_BLOCK_SIZE) {
  assertBlockSize(blockSize);
  return Math.floor((MAX_NUMBER - 1) / blockSize);
}

/**
 * Inclusive numeric range { lo, hi } covered by a block. The last block is
 * clipped to 999999 so every ID it can produce stays six digits.
 */
function blockRange(block, blockSize = DEFAULT_BLOCK_SIZE) {
  assertBlockSize(blockSize);
  if (!Number.isInteger(block) || block < 0 || block > maxBlock(blockSize)) {
    throw new RangeError(`Invalid ID block ${block}; expected an integer between 0 and ${maxBlock(blockSize)}.`);
  }
  return { lo: block * blockSize + 1, hi: Math.min((block + 1) * blockSize, MAX_NUMBER) };
}

/** Block number that a sequence number falls in (number 0 counts as block 0). */
function blockOf(number, blockSize = DEFAULT_BLOCK_SIZE) {
  assertBlockSize(blockSize);
  return Math.max(0, Math.floor((number - 1) / blockSize));
}

/**
 * Compute the next available padded ID for a given type.
 *
 * Without options the whole 000001–999999 range is scanned and the result is
 * max + 1, exactly the sequential behaviour every 1.0 repository relies on.
 * With `block` set only IDs inside that block count and the result never
 * leaves it; an exhausted block throws instead of spilling into a neighbour.
 */
function nextId(type, existingIds, { block = null, blockSize = DEFAULT_BLOCK_SIZE } = {}) {
  const upper = String(type).toUpperCase();
  const range = block == null ? { lo: 1, hi: MAX_NUMBER } : blockRange(block, blockSize);
  let max = range.lo - 1;
  for (const id of existingIds) {
    const parsed = parseId(id);
    if (parsed && parsed.type === upper && parsed.number >= range.lo && parsed.number <= range.hi && parsed.number > max) {
      max = parsed.number;
    }
  }
  if (max + 1 > range.hi) {
    const where = block == null ? 'The six-digit ID range' : `ID block ${block}`;
    throw new Error(`${where} is exhausted for ${upper} (last ID ${formatId(upper, max)}); claim a new block in config/id-blocks.yaml.`);
  }
  return formatId(upper, max + 1);
}

Object.assign(WS, {
  ID_PAD, ID_RE, MAX_NUMBER, DEFAULT_BLOCK_SIZE,
  isValidId, formatId, parseId, nextId, blockRange, blockOf, maxBlock,
});
})(window.WS = window.WS || {});
