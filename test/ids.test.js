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
