// test/yaml.test.js — utils/yaml.js: the order-preserving YAML subset engine.
//
// These are unit tests for the individual functions. Whole-file round trips
// over the fixture corpus live in roundtrip.test.js.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadWS } = require('./load.js');

const { parseYaml, stringifyYaml, splitDocument, joinDocument, patchScalarLine } = loadWS(['utils/yaml.js']);

/** parse -> stringify -> parse must be a fixed point for anything the serializer emits. */
function assertStable(obj) {
  const text = stringifyYaml(obj);
  assert.deepEqual(parseYaml(text), obj, `unstable: ${JSON.stringify(text)}`);
}

describe('yaml: parseYaml scalars', () => {
  it('reads null in every spelling', () => {
    assert.deepEqual(parseYaml('a:\nb: ~\nc: null\nd:   '), { a: null, b: null, c: null, d: null });
  });

  it('reads booleans only as bare true/false', () => {
    assert.deepEqual(parseYaml('a: true\nb: false'), { a: true, b: false });
    // yes/no/on/off are strings in this subset, never booleans.
    assert.deepEqual(parseYaml('a: yes\nb: no\nc: on\nd: off'), { a: 'yes', b: 'no', c: 'on', d: 'off' });
    assert.deepEqual(parseYaml('a: True\nb: FALSE'), { a: 'True', b: 'FALSE' });
  });

  it('reads integers as numbers and everything else numeric as strings', () => {
    assert.deepEqual(parseYaml('a: 0\nb: 42\nc: -7\nd: 123456789'), { a: 0, b: 42, c: -7, d: 123456789 });
    assert.deepEqual(parseYaml('a: 1.0\nb: 2.10\nc: 1.2.3\nd: 1e3\ne: 0x10'), {
      a: '1.0', b: '2.10', c: '1.2.3', d: '1e3', e: '0x10',
    });
  });

  it('keeps dates and timestamps as strings', () => {
    assert.deepEqual(parseYaml('a: 2026-09-04\nb: 2026-09-04T10:15:00Z'), {
      a: '2026-09-04', b: '2026-09-04T10:15:00Z',
    });
  });

  it('reads plain strings, trimming surrounding whitespace only', () => {
    assert.deepEqual(parseYaml('a:    spaced out   \nb: has, commas and \'quotes\''), {
      a: 'spaced out', b: "has, commas and 'quotes'",
    });
  });

  it('does not split on a colon that is not followed by a space', () => {
    assert.deepEqual(parseYaml('url: https://example.com/a?b=1\ntime: 10:15'), {
      url: 'https://example.com/a?b=1', time: '10:15',
    });
  });

  it('unwraps double-quoted strings and their escapes', () => {
    assert.deepEqual(parseYaml('a: "plain"\nb: ""\nc: " padded "\nd: "x: y"\ne: "say \\"hi\\""\nf: "line\\nbreak"'), {
      a: 'plain', b: '', c: ' padded ', d: 'x: y', e: 'say "hi"', f: 'line\nbreak',
    });
  });

  it('keeps quoted values that look like other types as strings', () => {
    assert.deepEqual(parseYaml('a: "true"\nb: "null"\nc: "42"\nd: "~"\ne: "007"\nf: "[]"'), {
      a: 'true', b: 'null', c: '42', d: '~', e: '007', f: '[]',
    });
  });

  it('unwraps single-quoted strings and doubled single quotes', () => {
    assert.deepEqual(parseYaml("a: 'plain'\nb: ''\nc: 'it''s'\nd: 'x: y'\ne: 'back\\slash'"), {
      a: 'plain', b: '', c: "it's", d: 'x: y', e: 'back\\slash',
    });
  });

  it('reads flow sequences, including quoted items with commas', () => {
    assert.deepEqual(parseYaml('a: []\nb: [ ]\nc: [x]\nd: [x, y, z]\ne: [1, true, ~]\nf: ["a, b", \'c, d\', e]'), {
      a: [], b: [], c: ['x'], d: ['x', 'y', 'z'], e: [1, true, null], f: ['a, b', 'c, d', 'e'],
    });
  });
});

describe('yaml: parseYaml structure', () => {
  it('preserves key order exactly as written', () => {
    const obj = parseYaml('z: 1\na: 2\nm: 3\nb: 4');
    assert.deepEqual(Object.keys(obj), ['z', 'a', 'm', 'b']);
  });

  it('returns an empty object for empty, blank or comment-only input', () => {
    assert.deepEqual(parseYaml(''), {});
    assert.deepEqual(parseYaml('\n\n   \n'), {});
    assert.deepEqual(parseYaml('# only\n# comments'), {});
  });

  it('skips blank lines and full-line comments at any depth', () => {
    const text = [
      '# top',
      'a: 1',
      '',
      '# between',
      'seq:',
      '  # inside a sequence',
      '  - x',
      '',
      '  - y',
      'map:',
      '  # inside a mapping',
      '  k: v',
      '# trailing',
    ].join('\n');
    assert.deepEqual(parseYaml(text), { a: 1, seq: ['x', 'y'], map: { k: 'v' } });
  });

  it('reads block sequences of scalars', () => {
    assert.deepEqual(parseYaml('labels:\n  - a\n  - "b: c"\n  - 3\n  - true\n  -\n  - ~'), {
      labels: ['a', 'b: c', 3, true, null, null],
    });
  });

  it('reads sequences of mappings with nested content', () => {
    const text = [
      'steps:',
      '  - name: first',
      '    done: true',
      '  - name: second',
      '    tags:',
      '      - a',
      '      - b',
      '    owner:',
      '      team: platform',
      '  - name: third',
    ].join('\n');
    assert.deepEqual(parseYaml(text), {
      steps: [
        { name: 'first', done: true },
        { name: 'second', tags: ['a', 'b'], owner: { team: 'platform' } },
        { name: 'third' },
      ],
    });
  });

  it('reads a mapping under a bare dash', () => {
    assert.deepEqual(parseYaml('items:\n  -\n    a: 1\n    b: 2\n  -\n    a: 3'), {
      items: [{ a: 1, b: 2 }, { a: 3 }],
    });
  });

  it('reads nested mappings several levels deep', () => {
    const text = 'extensions:\n  vendor:\n    name: acme\n    meta:\n      tier: 2\n  flag: true\ncustom:\n  k: v';
    assert.deepEqual(parseYaml(text), {
      extensions: { vendor: { name: 'acme', meta: { tier: 2 } }, flag: true },
      custom: { k: 'v' },
    });
  });

  it('tolerates a uniformly indented document', () => {
    assert.deepEqual(parseYaml('  a: 1\n  b:\n    - x'), { a: 1, b: ['x'] });
  });

  it('reads a key whose value is on the next line as null when nothing is nested', () => {
    assert.deepEqual(parseYaml('a:\nb: 1'), { a: null, b: 1 });
    assert.deepEqual(parseYaml('a:'), { a: null });
  });
});

describe('yaml: parseYaml block scalars', () => {
  it('reads a literal block with a single trailing newline (clip)', () => {
    assert.deepEqual(parseYaml('a: |\n  one\n  two\nb: 1'), { a: 'one\ntwo\n', b: 1 });
  });

  it('reads a literal block without a trailing newline (strip)', () => {
    assert.deepEqual(parseYaml('a: |-\n  one\n  two\nb: 1'), { a: 'one\ntwo', b: 1 });
  });

  it('keeps blank lines and deeper indentation inside a literal block', () => {
    const text = 'a: |\n  one\n\n  three\n    indented\n  - dash\nb: 1';
    assert.deepEqual(parseYaml(text), { a: 'one\n\nthree\n  indented\n- dash\n', b: 1 });
  });

  it('drops trailing blank lines from a block', () => {
    assert.deepEqual(parseYaml('a: |\n  one\n\n\nb: 1'), { a: 'one\n', b: 1 });
  });

  it('folds a > block into a single line', () => {
    assert.deepEqual(parseYaml('a: >\n  one\n  two\nb: 1'), { a: 'one two\n', b: 1 });
    assert.deepEqual(parseYaml('a: >-\n  one\n  two'), { a: 'one two' });
  });

  it('reads a block scalar nested inside a mapping', () => {
    assert.deepEqual(parseYaml('custom:\n  note: |\n    deep\n    text\n  after: 1'), {
      custom: { note: 'deep\ntext\n', after: 1 },
    });
  });

  it('treats lines starting with # inside a block as content, not comments', () => {
    assert.deepEqual(parseYaml('a: |\n  # heading\n  text'), { a: '# heading\ntext\n' });
  });

  it('does not strip CR from block scalar lines in a CRLF document', () => {
    assert.deepEqual(parseYaml('a: |\r\n  one\r\n  two\r\nb: 1\r\n'), { a: 'one\ntwo\n', b: 1 });
  });
});

describe('yaml: stringifyYaml', () => {
  it('emits keys in insertion order with two-space indentation', () => {
    const text = stringifyYaml({ z: 1, a: 'x', nested: { k: 'v', deeper: { n: 2 } } });
    assert.equal(text, 'z: 1\na: x\nnested:\n  k: v\n  deeper:\n    n: 2');
  });

  it('emits booleans, numbers and null', () => {
    assert.equal(stringifyYaml({ t: true, f: false, n: 0, m: -3 }), 't: true\nf: false\nn: 0\nm: -3');
    assert.equal(stringifyYaml({ a: null, b: undefined }).replace(/ +$/gm, ''), 'a:\nb:');
  });

  it('emits empty arrays inline and others as block sequences', () => {
    assert.equal(stringifyYaml({ a: [], b: ['x', 2, true, null] }).replace(/ +$/gm, ''), 'a: []\nb:\n  - x\n  - 2\n  - true\n  -');
  });

  it('emits sequences of mappings with the first key on the dash line', () => {
    const text = stringifyYaml({ s: [{ a: 1, b: 2 }, { c: ['x'] }, {}] });
    assert.equal(text, 's:\n  - a: 1\n    b: 2\n  - c:\n      - x\n  - {}');
  });

  it('quotes strings that would otherwise change type or structure', () => {
    const cases = {
      empty: '',
      lead: ' x',
      trail: 'x ',
      t: 'true',
      f: 'False',
      n: 'null',
      tilde: '~',
      yes: 'yes',
      int: '42',
      neg: '-1',
      zeros: '007',
      dash: '- x',
      hash: '# x',
      bracket: '[x',
      brace: '{x}',
      colon: 'a: b',
      spacehash: 'a # b',
      amp: '&x',
      star: '*x',
      bang: '!x',
      pipe: '|x',
      gt: '>x',
      pct: '%x',
      at: '@x',
      tick: '`x',
      dq: '"x',
      sq: "'x",
      qmark: '?x',
      comma: ',x',
    };
    const lines = stringifyYaml(cases).split('\n');
    for (const line of lines) {
      assert.match(line, /^[a-z]+: "/, `should be quoted: ${line}`);
    }
    assertStable(cases);
  });

  it('leaves ordinary strings bare', () => {
    const obj = {
      a: 'plain text',
      b: 'has, commas',
      c: "it's",
      d: 'a "quoted" word',
      e: 'https://example.com/x?y=1',
      f: '1.0',
      g: '2026-09-04',
      h: 'key:value',
      i: 'ends with colon:',
      j: 'C:/path/to',
    };
    for (const line of stringifyYaml(obj).split('\n')) {
      assert.doesNotMatch(line, /^[a-z]+: "/, `should be bare: ${line}`);
    }
    assertStable(obj);
  });

  it('escapes double quotes inside quoted strings', () => {
    assert.equal(stringifyYaml({ a: 'say: "hi"' }), 'a: "say: \\"hi\\""');
    assertStable({ a: 'say: "hi"' });
  });

  it('emits multi-line strings as literal blocks', () => {
    assert.equal(stringifyYaml({ a: 'one\ntwo\n' }), 'a: |\n  one\n  two');
    assert.equal(stringifyYaml({ a: 'one\n\nthree\n' }), 'a: |\n  one\n\n  three');
    assert.equal(stringifyYaml({ m: { a: 'deep\ntext\n' } }), 'm:\n  a: |\n    deep\n    text');
    assertStable({ a: 'one\ntwo\n', m: { b: 'deep\n\ntext\n' } });
  });

  it('is stable for a representative item', () => {
    assertStable({
      id: 'STORY-000001',
      type: 'STORY',
      title: 'A: colon title',
      status: 'In Progress',
      assignee: null,
      labels: ['a', 'b'],
      depends_on: [],
      extensions: { vendor: { name: 'acme', tier: 2 }, flags: ['x'] },
      history: [{ run: 1, ok: true }, { run: 2, ok: false, note: 'flaky: retry' }],
      description: 'line one\nline two\n',
      spec_version: '1.0',
    });
  });
});

describe('yaml: splitDocument / joinDocument', () => {
  it('splits front matter and body', () => {
    assert.deepEqual(splitDocument('---\na: 1\nb: 2\n---\n\n# Body\n'), { frontMatter: 'a: 1\nb: 2', body: '\n# Body\n' });
  });

  it('returns an empty body when the file ends at the closing fence', () => {
    assert.deepEqual(splitDocument('---\na: 1\n---'), { frontMatter: 'a: 1', body: '' });
    assert.deepEqual(splitDocument('---\na: 1\n---\n'), { frontMatter: 'a: 1', body: '' });
  });

  it('returns null front matter when there is none', () => {
    assert.deepEqual(splitDocument('# Just markdown\n'), { frontMatter: null, body: '# Just markdown\n' });
    assert.deepEqual(splitDocument(''), { frontMatter: null, body: '' });
    assert.deepEqual(splitDocument('---\nunterminated: 1\n'), { frontMatter: null, body: '---\nunterminated: 1\n' });
  });

  it('stops at the first closing fence and leaves later rules in the body', () => {
    const { frontMatter, body } = splitDocument('---\na: 1\n---\ntext\n---\nmore\n');
    assert.equal(frontMatter, 'a: 1');
    assert.equal(body, 'text\n---\nmore\n');
  });

  it('tolerates trailing spaces or tabs on the fences', () => {
    assert.deepEqual(splitDocument('---  \na: 1\n---\t\nbody'), { frontMatter: 'a: 1', body: 'body' });
  });

  it('strips a leading BOM', () => {
    const { frontMatter, body } = splitDocument('﻿---\na: 1\n---\nbody');
    assert.equal(frontMatter, 'a: 1');
    assert.equal(body, 'body');
    assert.deepEqual(splitDocument('﻿no front matter'), { frontMatter: null, body: 'no front matter' });
  });

  it('recognises CRLF fences and parses the front matter cleanly', () => {
    const { frontMatter, body } = splitDocument('---\r\na: 1\r\nb: x\r\n---\r\n\r\nbody\r\n');
    assert.deepEqual(parseYaml(frontMatter), { a: 1, b: 'x' });
    assert.equal(body, '\r\nbody\r\n');
  });

  it('joins with a blank line after the closing fence and no leading blank lines in the body', () => {
    assert.equal(joinDocument('a: 1\n\n', '\n\n# Body\n'), '---\na: 1\n---\n\n# Body\n');
    assert.equal(joinDocument('a: 1', ''), '---\na: 1\n---\n\n');
  });

  it('strips leading CRLF blank lines from the body too, so a CRLF file does not grow a blank line', () => {
    assert.equal(joinDocument('a: 1', '\r\n\r\n# Body\r\n'), '---\na: 1\n---\n\n# Body\r\n');
    assert.equal(joinDocument('a: 1', '\n\r\n# Body'), '---\na: 1\n---\n\n# Body');
  });

  it('split and join are inverse for a canonical file', () => {
    const file = '---\na: 1\nb: x\n---\n\n# Body\n\ntext\n';
    const { frontMatter, body } = splitDocument(file);
    assert.equal(joinDocument(frontMatter, body), file);
  });
});

describe('yaml: patchScalarLine', () => {
  const file = [
    '---',
    'id: STORY-000001',
    'status: Backlog',
    'title: "Keep: me"',
    'labels:',
    '  - a',
    '---',
    '',
    '# Body',
    '',
    'status: not front matter',
    '',
  ].join('\n');

  it('rewrites only the requested line', () => {
    const out = patchScalarLine(file, 'status', 'In Progress');
    const before = file.split('\n');
    const after = out.split('\n');
    assert.equal(after.length, before.length);
    for (let i = 0; i < before.length; i++) {
      if (i === 2) assert.equal(after[i], 'status: In Progress');
      else assert.equal(after[i], before[i], `line ${i + 1} changed`);
    }
  });

  it('quotes the new value when the scalar rules require it', () => {
    assert.match(patchScalarLine(file, 'status', 'yes'), /^status: "yes"$/m);
    assert.match(patchScalarLine(file, 'status', '# odd'), /^status: "# odd"$/m);
    assert.match(patchScalarLine(file, 'status', 42), /^status: 42$/m);
  });

  it('fills in a key that currently has no value', () => {
    const out = patchScalarLine('---\nassignee:\nstatus: Backlog\n---\n', 'assignee', 'rdagum');
    assert.equal(out, '---\nassignee: rdagum\nstatus: Backlog\n---\n');
  });

  it('never touches a matching line in the body', () => {
    const out = patchScalarLine(file, 'status', 'Done');
    assert.ok(out.includes('status: not front matter'));
    assert.equal((out.match(/^status: Done$/gm) || []).length, 1);
  });

  it('returns null when the key is absent or there is no front matter', () => {
    assert.equal(patchScalarLine(file, 'priority', 'high'), null);
    assert.equal(patchScalarLine('# no front matter\nstatus: x\n', 'status', 'y'), null);
  });

  it('does not match keys that merely start with the same letters', () => {
    const out = patchScalarLine('---\nstatus_note: x\nstatus: Backlog\n---\n', 'status', 'Done');
    assert.equal(out, '---\nstatus_note: x\nstatus: Done\n---\n');
  });

  it('round-trips through the parser with the new value', () => {
    const out = patchScalarLine(file, 'status', 'Review');
    const { frontMatter } = splitDocument(out);
    assert.equal(parseYaml(frontMatter).status, 'Review');
  });
});

describe('yaml: flow mappings', () => {
  it('reads an inline mapping into an ordered object', () => {
    assert.deepEqual(parseYaml('a: { block: 1, owner: rdagum, label: windows-pc }'), {
      a: { block: 1, owner: 'rdagum', label: 'windows-pc' },
    });
  });

  it('reads a sequence of inline mappings, as used by the ID block registry', () => {
    const text = 'blocks:\n  - { block: 1, owner: rdagum, label: windows-pc }\n  - { block: 2, owner: rdagum, label: macbook, claimed: 2026-09-04 }\n';
    assert.deepEqual(parseYaml(text), {
      blocks: [
        { block: 1, owner: 'rdagum', label: 'windows-pc' },
        { block: 2, owner: 'rdagum', label: 'macbook', claimed: '2026-09-04' },
      ],
    });
  });

  it('parses the values inside like any other scalar', () => {
    assert.deepEqual(parseYaml('a: { n: 42, s: "x, y", q: \'it\'\'s\', t: true, z: ~, d: 1.0 }'), {
      a: { n: 42, s: 'x, y', q: "it's", t: true, z: null, d: '1.0' },
    });
  });

  it('reads {} as an empty mapping and writes it back the same way', () => {
    assert.deepEqual(parseYaml('a: {}\nb:\n  - {}'), { a: {}, b: [{}] });
    assert.equal(stringifyYaml({ a: {}, b: [{}] }), 'a: {}\nb:\n  - {}');
    assertStable({ a: {}, b: [{}] });
  });

  it('keeps braces that are not a mapping as a literal string', () => {
    assert.deepEqual(parseYaml('a: {not a mapping}'), { a: '{not a mapping}' });
    assert.deepEqual(parseYaml('a: "{ quoted: text }"'), { a: '{ quoted: text }' });
  });

  it('serializes a flow mapping as a block mapping (like flow sequences)', () => {
    const obj = parseYaml('blocks:\n  - { block: 1, owner: rdagum }');
    assert.equal(stringifyYaml(obj), 'blocks:\n  - block: 1\n    owner: rdagum');
    assertStable(obj);
  });
});
