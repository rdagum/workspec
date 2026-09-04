// test/ids.test.js — utils/ids.js: ID format, parsing, formatting and next-id rules.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadWS } = require('./load.js');

const { ID_PAD, ID_RE, isValidId, formatId, parseId, nextId } = loadWS(['utils/ids.js']);

describe('ids: constants', () => {
  it('pads to six digits and exposes the matching regex', () => {
    assert.equal(ID_PAD, 6);
    assert.ok(ID_RE instanceof RegExp);
    assert.ok(ID_RE.test('STORY-000001'));
  });
});

describe('ids: isValidId', () => {
  it('accepts TYPE-000000 for every spec type', () => {
    for (const id of ['EPIC-000001', 'STORY-000123', 'TASK-000045', 'BUG-000010', 'SPIKE-000003']) {
      assert.equal(isValidId(id), true, id);
    }
  });

  it('accepts the boundaries of the six-digit range', () => {
    assert.equal(isValidId('TASK-000000'), true);
    assert.equal(isValidId('TASK-999999'), true);
  });

  it('accepts any upper-case alphabetic type', () => {
    assert.equal(isValidId('CUSTOMTYPE-000001'), true);
    assert.equal(isValidId('X-000001'), true);
  });

  it('rejects the wrong number of digits', () => {
    assert.equal(isValidId('STORY-00001'), false);
    assert.equal(isValidId('STORY-0000001'), false);
    assert.equal(isValidId('STORY-1'), false);
  });

  it('rejects lower-case, digits or separators in the type', () => {
    assert.equal(isValidId('story-000001'), false);
    assert.equal(isValidId('Story-000001'), false);
    assert.equal(isValidId('ST0RY-000001'), false);
    assert.equal(isValidId('MY_TYPE-000001'), false);
    assert.equal(isValidId('MY-TYPE-000001'), false);
  });

  it('rejects surrounding whitespace, suffixes and non-strings', () => {
    assert.equal(isValidId(' STORY-000001'), false);
    assert.equal(isValidId('STORY-000001 '), false);
    assert.equal(isValidId('STORY-000001.md'), false);
    assert.equal(isValidId('STORY-000001rd1'), false);
    assert.equal(isValidId(''), false);
    assert.equal(isValidId(null), false);
    assert.equal(isValidId(undefined), false);
    assert.equal(isValidId(1), false);
    assert.equal(isValidId({}), false);
  });
});

describe('ids: parseId', () => {
  it('splits a valid ID into type and numeric sequence', () => {
    assert.deepEqual(parseId('STORY-000123'), { type: 'STORY', number: 123 });
  });

  it('drops leading zeros from the number', () => {
    assert.deepEqual(parseId('BUG-000001'), { type: 'BUG', number: 1 });
    assert.deepEqual(parseId('BUG-000000'), { type: 'BUG', number: 0 });
    assert.deepEqual(parseId('BUG-999999'), { type: 'BUG', number: 999999 });
  });

  it('returns null for malformed input', () => {
    for (const bad of ['story-000001', 'STORY-1', 'STORY-000001.md', '', 'STORY', '-000001']) {
      assert.equal(parseId(bad), null, JSON.stringify(bad));
    }
  });

  it('coerces non-strings instead of throwing', () => {
    assert.equal(parseId(null), null);
    assert.equal(parseId(undefined), null);
    assert.equal(parseId(42), null);
  });

  it('is the inverse of formatId', () => {
    for (const n of [0, 1, 42, 999, 123456, 999999]) {
      const id = formatId('SPIKE', n);
      assert.deepEqual(parseId(id), { type: 'SPIKE', number: n });
    }
  });
});

describe('ids: formatId', () => {
  it('zero-pads the sequence to six digits', () => {
    assert.equal(formatId('STORY', 1), 'STORY-000001');
    assert.equal(formatId('STORY', 123), 'STORY-000123');
    assert.equal(formatId('STORY', 123456), 'STORY-123456');
  });

  it('upper-cases the type', () => {
    assert.equal(formatId('story', 7), 'STORY-000007');
    assert.equal(formatId('Bug', 7), 'BUG-000007');
  });

  it('accepts a numeric string for the sequence', () => {
    assert.equal(formatId('TASK', '12'), 'TASK-000012');
  });

  it('produces IDs that isValidId accepts across the whole range', () => {
    for (const n of [0, 1, 99999, 999999]) {
      assert.equal(isValidId(formatId('EPIC', n)), true, String(n));
    }
  });
});

describe('ids: nextId', () => {
  it('starts at 000001 when nothing exists', () => {
    assert.equal(nextId('STORY', []), 'STORY-000001');
  });

  it('starts at 000001 when only other types exist', () => {
    assert.equal(nextId('BUG', ['STORY-000001', 'TASK-000009']), 'BUG-000001');
  });

  it('returns max + 1 for the type, ignoring other types', () => {
    const ids = ['STORY-000001', 'STORY-000007', 'STORY-000003', 'BUG-000050'];
    assert.equal(nextId('STORY', ids), 'STORY-000008');
    assert.equal(nextId('BUG', ids), 'BUG-000051');
  });

  it('does not reuse gaps left by deleted items', () => {
    assert.equal(nextId('TASK', ['TASK-000005']), 'TASK-000006');
  });

  it('ignores malformed IDs in the input', () => {
    const ids = ['STORY-000002', 'story-000099', 'STORY-99', 'STORY-000004.md', 'garbage', ''];
    assert.equal(nextId('STORY', ids), 'STORY-000003');
  });

  it('matches the type case-insensitively and emits it upper-case', () => {
    assert.equal(nextId('story', ['STORY-000010']), 'STORY-000011');
  });

  it('accepts any iterable of IDs, not only arrays', () => {
    const set = new Set(['EPIC-000001', 'EPIC-000002']);
    assert.equal(nextId('EPIC', set), 'EPIC-000003');
    const map = new Map([['EPIC-000005', {}]]);
    assert.equal(nextId('EPIC', map.keys()), 'EPIC-000006');
  });

  it('never returns an ID that is already in the input', () => {
    const ids = ['SPIKE-000001', 'SPIKE-000002', 'SPIKE-000003'];
    const next = nextId('SPIKE', ids);
    assert.ok(!ids.includes(next));
    assert.equal(isValidId(next), true);
  });
});

describe('ids: blocks', () => {
  const { DEFAULT_BLOCK_SIZE, MAX_NUMBER, blockRange, blockOf, maxBlock } = loadWS(['utils/ids.js']);

  it('defaults to blocks of 1000 inside the six-digit range', () => {
    assert.equal(DEFAULT_BLOCK_SIZE, 1000);
    assert.equal(MAX_NUMBER, 999999);
    assert.equal(maxBlock(), 999);
    assert.equal(maxBlock(500), 1999);
  });

  it('block N covers N*size+1 … (N+1)*size, so block 0 is the legacy range', () => {
    assert.deepEqual(blockRange(0), { lo: 1, hi: 1000 });
    assert.deepEqual(blockRange(1), { lo: 1001, hi: 2000 });
    assert.deepEqual(blockRange(2, 500), { lo: 1001, hi: 1500 });
  });

  it('clips the last block to 999999', () => {
    assert.deepEqual(blockRange(999), { lo: 999001, hi: 999999 });
  });

  it('rejects blocks and sizes outside the range', () => {
    assert.throws(() => blockRange(-1), RangeError);
    assert.throws(() => blockRange(1000), RangeError);
    assert.throws(() => blockRange(1.5), RangeError);
    assert.throws(() => blockRange('1'), RangeError);
    assert.throws(() => blockRange(1, 0), RangeError);
    assert.throws(() => blockRange(1, 1000000), RangeError);
  });

  it('maps a sequence number to its block (0 counts as block 0)', () => {
    assert.equal(blockOf(0), 0);
    assert.equal(blockOf(1), 0);
    assert.equal(blockOf(1000), 0);
    assert.equal(blockOf(1001), 1);
    assert.equal(blockOf(2000), 1);
    assert.equal(blockOf(2001), 2);
    assert.equal(blockOf(999999), 999);
    assert.equal(blockOf(750, 500), 1);
  });
});

describe('ids: nextId with a block', () => {
  it('starts at the first number of an empty block', () => {
    assert.equal(nextId('STORY', [], { block: 2 }), 'STORY-002001');
    assert.equal(nextId('STORY', ['STORY-000001', 'STORY-000999'], { block: 2 }), 'STORY-002001');
  });

  it('continues after the highest ID inside the block only', () => {
    const ids = ['STORY-000010', 'STORY-002003', 'STORY-002001', 'STORY-003500', 'BUG-002007'];
    assert.equal(nextId('STORY', ids, { block: 2 }), 'STORY-002004');
    assert.equal(nextId('BUG', ids, { block: 2 }), 'BUG-002008');
    assert.equal(nextId('STORY', ids, { block: 3 }), 'STORY-003501');
  });

  it('ignores IDs from other blocks even when they are higher', () => {
    assert.equal(nextId('TASK', ['TASK-005000'], { block: 1 }), 'TASK-001001');
  });

  it('honours a custom block size', () => {
    assert.equal(nextId('TASK', ['TASK-000120'], { block: 1, blockSize: 100 }), 'TASK-000121');
    assert.equal(nextId('TASK', [], { block: 3, blockSize: 100 }), 'TASK-000301');
  });

  it('throws when the block is exhausted instead of spilling into the next one', () => {
    assert.throws(() => nextId('STORY', ['STORY-002000'], { block: 1 }), /block 1 is exhausted for STORY/);
    assert.throws(() => nextId('STORY', ['STORY-000200'], { block: 1, blockSize: 100 }), /exhausted/);
    assert.throws(() => nextId('STORY', ['STORY-999999'], { block: 999 }), /exhausted/);
  });

  it('throws when the whole six-digit range is used up', () => {
    assert.throws(() => nextId('STORY', ['STORY-999999']), /six-digit ID range is exhausted/);
  });

  it('behaves exactly like the sequential form when block is null or undefined', () => {
    const ids = ['STORY-000001', 'STORY-000007', 'STORY-002003'];
    assert.equal(nextId('STORY', ids, {}), nextId('STORY', ids));
    assert.equal(nextId('STORY', ids, { block: null }), 'STORY-002004');
    assert.equal(nextId('STORY', ids, { block: undefined }), 'STORY-002004');
  });

  it('rejects a malformed block option', () => {
    assert.throws(() => nextId('STORY', [], { block: -1 }), RangeError);
    assert.throws(() => nextId('STORY', [], { block: '2' }), RangeError);
    assert.throws(() => nextId('STORY', [], { block: 1, blockSize: 0 }), RangeError);
  });
});
