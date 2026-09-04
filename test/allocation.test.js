// test/allocation.test.js — core/allocation.js: block configuration, the
// registry, per-clone allocation, cross-file validation and renumbering plans.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadWS } = require('./load.js');

const WS = loadWS();
const {
  parseItem, parseYaml,
  parseIdAllocation, parseIdBlocks, findBlock, describeBlock,
  knownIds, allocationState, allocateId, lowestFreeBlock,
  formatBlockEntry, appendBlockEntry, setLocalKeys,
  validateRepository, rewriteReferences, patchIdLine, renumberPlan,
} = WS;

/** Minimal item file text. */
function itemText(id, extra = {}, body = '# Summary\n\nText.\n') {
  const lines = ['---', `id: ${id}`, `type: ${id.split('-')[0]}`, `title: "${id}"`, 'status: Backlog'];
  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v)) lines.push(v.length ? `${k}:\n${v.map((x) => `  - ${x}`).join('\n')}` : `${k}: []`);
    else lines.push(`${k}: ${v == null ? '' : v}`);
  }
  lines.push('created: 2026-09-01', 'updated: 2026-09-01', 'spec_version: 1.0', '---', '', body);
  return lines.join('\n');
}

/** Build a model the way loadRepository would, from { path: text } and config. */
function modelFrom(files, { allocation = null, blocks = [], local = {} } = {}) {
  const model = {
    items: new Map(),
    itemsById: new Map(),
    idAllocation: (({ strategy, blockSize }) => ({ strategy, blockSize }))(parseIdAllocation(allocation)),
    idBlocks: blocks,
    local,
    loadErrors: [],
    warnings: [],
  };
  for (const [path, text] of Object.entries(files)) model.items.set(path, parseItem(path, text));
  return model;
}

describe('allocation: parseIdAllocation', () => {
  it('defaults to sequential with blocks of 1000', () => {
    for (const raw of [undefined, null, {}]) {
      assert.deepEqual(parseIdAllocation(raw), { strategy: 'sequential', blockSize: 1000, errors: [] });
    }
  });

  it('accepts strategy block and a custom size', () => {
    assert.deepEqual(parseIdAllocation({ strategy: 'block', block_size: 500 }), { strategy: 'block', blockSize: 500, errors: [] });
    assert.equal(parseIdAllocation({ strategy: 'Block' }).strategy, 'block');
    assert.equal(parseIdAllocation({ strategy: 'block', block_size: '250' }).blockSize, 250);
  });

  it('reports an unknown strategy or a bad size and keeps the defaults', () => {
    const r = parseIdAllocation({ strategy: 'random', block_size: 0 });
    assert.equal(r.strategy, 'sequential');
    assert.equal(r.blockSize, 1000);
    assert.equal(r.errors.length, 2);
    assert.match(r.errors[0], /strategy "random"/);
    assert.match(r.errors[1], /block_size "0"/);
    assert.equal(parseIdAllocation('block').errors.length, 1);
  });
});

describe('allocation: parseIdBlocks', () => {
  it('reads the one-line-per-clone registry form', () => {
    const data = parseYaml('blocks:\n  - { block: 1, owner: rdagum, label: windows-pc }\n  - { block: 2, owner: rdagum, label: macbook, claimed: 2026-09-04 }\n');
    const r = parseIdBlocks(data);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.blocks, [
      { block: 1, owner: 'rdagum', label: 'windows-pc', claimed: null },
      { block: 2, owner: 'rdagum', label: 'macbook', claimed: '2026-09-04' },
    ]);
  });

  it('reads the block-sequence form and a bare top-level list too', () => {
    const data = parseYaml('blocks:\n  - block: 3\n    owner: alice\n    label: laptop\n');
    assert.deepEqual(parseIdBlocks(data).blocks, [{ block: 3, owner: 'alice', label: 'laptop', claimed: null }]);
    assert.deepEqual(parseIdBlocks([{ block: 4, owner: 'bob' }]).blocks, [{ block: 4, owner: 'bob', label: '', claimed: null }]);
  });

  it('treats an empty or missing registry as no blocks', () => {
    assert.deepEqual(parseIdBlocks({}), { blocks: [], errors: [] });
    assert.deepEqual(parseIdBlocks({ blocks: [] }), { blocks: [], errors: [] });
    assert.deepEqual(parseIdBlocks({ blocks: null }), { blocks: [], errors: [] });
    assert.deepEqual(parseIdBlocks(null), { blocks: [], errors: [] });
  });

  it('reports a duplicate block number and keeps the first claim', () => {
    const r = parseIdBlocks({ blocks: [{ block: 1, owner: 'a', label: 'x' }, { block: 1, owner: 'b', label: 'y' }] });
    assert.equal(r.blocks.length, 1);
    assert.equal(r.blocks[0].owner, 'a');
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /blocks\[1\]: block 1 is already claimed by a \/ x/);
  });

  it('rejects block 0, out-of-range blocks, missing owners, bad dates and non-mappings', () => {
    const r = parseIdBlocks({
      blocks: [
        { block: 0, owner: 'a' },
        { block: 1000, owner: 'a' },
        { block: 'one', owner: 'a' },
        { block: 5 },
        { block: 6, owner: 'a', claimed: 'yesterday' },
        'block 7',
      ],
    });
    assert.equal(r.blocks.length, 1, 'only block 6 survives (with its date dropped)');
    assert.deepEqual(r.blocks[0], { block: 6, owner: 'a', label: '', claimed: null });
    assert.equal(r.errors.length, 6);
    assert.match(r.errors[0], /block 0 is the legacy sequential range/);
    assert.match(r.errors[1], /outside 1-999/);
    assert.match(r.errors[2], /must be an integer/);
    assert.match(r.errors[3], /no `owner`/);
    assert.match(r.errors[4], /YYYY-MM-DD/);
    assert.match(r.errors[5], /expected a mapping/);
  });

  it('sizes the valid range from block_size', () => {
    assert.deepEqual(parseIdBlocks({ blocks: [{ block: 1500, owner: 'a' }] }, 500).errors, []);
  });

  it('exposes findBlock and describeBlock helpers', () => {
    const blocks = [{ block: 2, owner: 'rdagum', label: 'macbook', claimed: null }, { block: 3, owner: 'ci', label: '', claimed: null }];
    assert.equal(findBlock(blocks, 2).label, 'macbook');
    assert.equal(findBlock(blocks, 9), null);
    assert.equal(describeBlock(blocks[0]), 'rdagum / macbook');
    assert.equal(describeBlock(blocks[1]), 'ci');
    assert.equal(describeBlock(null), '');
  });
});

describe('allocation: knownIds', () => {
  it('unions declared IDs and file stems so a broken file still reserves its number', () => {
    const model = modelFrom({
      'items/STORY-000001.md': itemText('STORY-000001'),
      'items/STORY-000002.md': '# no front matter at all\n',
      'items/notes.md': itemText('STORY-000003'),
    });
    assert.deepEqual([...knownIds(model)].sort(), ['STORY-000001', 'STORY-000002', 'STORY-000003']);
  });
});

describe('allocation: allocationState / allocateId', () => {
  const files = { 'items/STORY-000001.md': itemText('STORY-000001'), 'items/STORY-000005.md': itemText('STORY-000005') };
  const blocks = [{ block: 2, owner: 'rdagum', label: 'macbook', claimed: null }];

  it('is sequential and unblocked when board.yaml says nothing', () => {
    const model = modelFrom(files);
    assert.deepEqual(allocationState(model), { strategy: 'sequential', blockSize: 1000, block: null, entry: null, problem: null });
    assert.equal(allocateId(model, 'STORY'), 'STORY-000006');
    assert.equal(allocateId(model, 'BUG'), 'BUG-000001');
  });

  it('ignores id_block under the sequential strategy', () => {
    const model = modelFrom(files, { local: { id_block: 2 }, blocks });
    assert.equal(allocateId(model, 'STORY'), 'STORY-000006');
  });

  it('allocates inside the configured block under strategy block', () => {
    const model = modelFrom(files, { allocation: { strategy: 'block' }, blocks, local: { id_block: 2 } });
    const state = allocationState(model);
    assert.equal(state.problem, null);
    assert.equal(state.block, 2);
    assert.equal(state.entry.label, 'macbook');
    assert.equal(allocateId(model, 'STORY'), 'STORY-002001');
    model.items.set('items/STORY-002001.md', parseItem('items/STORY-002001.md', itemText('STORY-002001')));
    assert.equal(allocateId(model, 'story'), 'STORY-002002');
  });

  it('accepts id_block written as a string', () => {
    const model = modelFrom(files, { allocation: { strategy: 'block' }, blocks, local: { id_block: '2' } });
    assert.equal(allocateId(model, 'STORY'), 'STORY-002001');
  });

  it('refuses to allocate without a block and says why', () => {
    const noBlock = modelFrom(files, { allocation: { strategy: 'block' }, blocks });
    assert.equal(allocationState(noBlock).problem, 'no-block');
    assert.throws(() => allocateId(noBlock, 'STORY'), (err) => err.code === 'no-block' && /names no id_block/.test(err.message));

    const unregistered = modelFrom(files, { allocation: { strategy: 'block' }, blocks, local: { id_block: 7 } });
    assert.equal(allocationState(unregistered).problem, 'unregistered');
    assert.throws(() => allocateId(unregistered, 'STORY'), (err) => err.code === 'unregistered');

    const invalid = modelFrom(files, { allocation: { strategy: 'block' }, blocks, local: { id_block: 'two' } });
    assert.equal(allocationState(invalid).problem, 'invalid-block');
    assert.throws(() => allocateId(invalid, 'STORY'), (err) => err.code === 'invalid-block');
    assert.equal(allocationState(modelFrom(files, { allocation: { strategy: 'block' }, blocks, local: { id_block: 0 } })).problem, 'invalid-block');
  });

  it('surfaces block exhaustion from nextId', () => {
    const model = modelFrom({ 'items/STORY-002000.md': itemText('STORY-002000') }, {
      allocation: { strategy: 'block' },
      blocks: [{ block: 1, owner: 'a', label: '', claimed: null }],
      local: { id_block: 1 },
    });
    assert.throws(() => allocateId(model, 'STORY'), /block 1 is exhausted/);
  });
});

describe('allocation: lowestFreeBlock', () => {
  it('starts at 1 and skips registered blocks', () => {
    assert.equal(lowestFreeBlock([], []), 1);
    assert.equal(lowestFreeBlock([{ block: 1 }, { block: 2 }], []), 3);
    assert.equal(lowestFreeBlock([{ block: 1 }, { block: 3 }], []), 2);
  });

  it('skips blocks that legacy items already occupy, for any type', () => {
    assert.equal(lowestFreeBlock([], ['STORY-001500']), 2);
    assert.equal(lowestFreeBlock([{ block: 2 }], ['STORY-000010', 'BUG-001001']), 3);
    assert.equal(lowestFreeBlock([], ['TASK-000120'], 100), 2);
  });

  it('throws when nothing is left', () => {
    const all = Array.from({ length: 999 }, (_, i) => ({ block: i + 1 }));
    assert.throws(() => lowestFreeBlock(all, []), /Every ID block is claimed/);
  });
});

describe('allocation: registry and local file edits', () => {
  const entry = { block: 2, owner: 'rdagum', label: 'macbook', claimed: '2026-09-04' };

  it('formats one entry as a single flow-mapping line', () => {
    assert.equal(formatBlockEntry(entry), '  - { block: 2, owner: rdagum, label: macbook, claimed: 2026-09-04 }');
    assert.equal(formatBlockEntry({ block: 3, owner: 'ci' }), '  - { block: 3, owner: ci }');
    assert.equal(formatBlockEntry({ block: 4, owner: 'a b', label: 'x, y' }), '  - { block: 4, owner: "a b", label: "x, y" }');
    assert.equal(formatBlockEntry({ block: 5, owner: '42', label: 'true' }), '  - { block: 5, owner: "42", label: "true" }');
  });

  it('creates the registry with a header when it does not exist', () => {
    const text = appendBlockEntry('', entry);
    assert.match(text, /^# Claimed ID blocks/);
    assert.ok(text.endsWith('blocks:\n  - { block: 2, owner: rdagum, label: macbook, claimed: 2026-09-04 }\n'));
    assert.deepEqual(parseIdBlocks(parseYaml(text)).blocks, [entry]);
    assert.deepEqual(appendBlockEntry(null, entry), text);
  });

  it('appends after the last existing entry and keeps everything else', () => {
    const before = '# header\nblocks:\n  - { block: 1, owner: a, label: x }\n\n# trailing comment\n';
    const after = appendBlockEntry(before, entry);
    assert.equal(after, '# header\nblocks:\n  - { block: 1, owner: a, label: x }\n  - { block: 2, owner: rdagum, label: macbook, claimed: 2026-09-04 }\n\n# trailing comment\n');
    assert.equal(parseIdBlocks(parseYaml(after)).blocks.length, 2);
  });

  it('keeps later top-level keys after the sequence', () => {
    const after = appendBlockEntry('blocks:\n  - { block: 1, owner: a }\nother: value\n', entry);
    assert.equal(after, 'blocks:\n  - { block: 1, owner: a }\n  - { block: 2, owner: rdagum, label: macbook, claimed: 2026-09-04 }\nother: value\n');
    assert.deepEqual(parseYaml(after).other, 'value');
  });

  it('replaces an empty inline list and adds a missing blocks key', () => {
    assert.equal(appendBlockEntry('blocks: []\n', entry), 'blocks:\n  - { block: 2, owner: rdagum, label: macbook, claimed: 2026-09-04 }\n');
    assert.equal(appendBlockEntry('# just a comment\n', entry), '# just a comment\nblocks:\n  - { block: 2, owner: rdagum, label: macbook, claimed: 2026-09-04 }\n');
  });

  it('preserves CRLF line endings', () => {
    const after = appendBlockEntry('blocks:\r\n  - { block: 1, owner: a }\r\n', entry);
    assert.equal(after, 'blocks:\r\n  - { block: 1, owner: a }\r\n  - { block: 2, owner: rdagum, label: macbook, claimed: 2026-09-04 }\r\n');
  });

  it('sets id_block in user.local.yaml in place and appends missing keys', () => {
    const before = 'name: Rodolfo\nemail: r@example.com\ndefault_assignee: rdagum\ntheme: light\n';
    const after = setLocalKeys(before, { handle: 'rdagum', id_block: 2 });
    assert.equal(after, before + 'handle: rdagum\nid_block: 2\n');
    assert.equal(setLocalKeys(after, { id_block: 5 }), before + 'handle: rdagum\nid_block: 5\n');
    assert.deepEqual(parseYaml(setLocalKeys(after, { id_block: 5 })).id_block, 5);
  });

  it('creates the local file from nothing and keeps CRLF', () => {
    assert.equal(setLocalKeys('', { id_block: 1 }), 'id_block: 1\n');
    assert.equal(setLocalKeys('theme: dark\r\n', { id_block: 1 }), 'theme: dark\r\nid_block: 1\r\n');
  });
});

describe('allocation: validateRepository', () => {
  it('indexes items by ID and is silent for a clean sequential repository', () => {
    const model = modelFrom({ 'items/STORY-000001.md': itemText('STORY-000001'), 'items/BUG-000001.md': itemText('BUG-000001') });
    const r = validateRepository(model);
    assert.deepEqual(r, { errors: [], warnings: [] });
    assert.deepEqual([...model.itemsById.keys()], ['STORY-000001', 'BUG-000001']);
    assert.equal(model.itemsById.get('BUG-000001').path, 'items/BUG-000001.md');
  });

  it('reports a duplicate ID on every file involved', () => {
    const model = modelFrom({
      'items/STORY-000014.md': itemText('STORY-000014'),
      'items/STORY-000014 (2).md': itemText('STORY-000014'),
    });
    const r = validateRepository(model);
    assert.equal(r.errors.length, 2);
    assert.equal(r.errors[0].code, 'duplicate-id');
    assert.equal(r.errors[0].file, 'items/STORY-000014.md');
    assert.match(r.errors[0].message, /Duplicate ID "STORY-000014" is also declared by items\/STORY-000014 \(2\)\.md/);
    assert.match(r.errors[1].message, /also declared by items\/STORY-000014\.md/);
    const first = model.items.get('items/STORY-000014.md');
    assert.ok(first.errors.some((e) => e.startsWith('Duplicate ID')));
    const second = model.items.get('items/STORY-000014 (2).md');
    assert.ok(second.errors.some((e) => e.startsWith('Duplicate ID')));
    assert.ok(second.errors.some((e) => /does not match ID/.test(e)), 'the mismatched file name is an error too');
    assert.equal(model.itemsById.get('STORY-000014'), first);
    assert.deepEqual(model.loadErrors, r.errors);
  });

  it('flags an item created before its block was claimed as another allocator\'s', () => {
    const blocks = [{ block: 1, owner: 'rdagum', label: 'windows-pc', claimed: '2026-09-04' }];
    const model = modelFrom({
      'items/STORY-001001.md': itemText('STORY-001001'), // created 2026-09-01
      'items/STORY-001002.md': itemText('STORY-001002').replace('created: 2026-09-01', 'created: 2026-09-04'),
      'items/STORY-001003.md': itemText('STORY-001003').replace('created: 2026-09-01', 'created: 2026-09-10'),
    }, { allocation: { strategy: 'block' }, blocks, local: { id_block: 1 } });
    const r = validateRepository(model);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].code, 'foreign-item');
    assert.equal(r.errors[0].file, 'items/STORY-001001.md');
    assert.match(r.errors[0].message, /STORY-001001 lies in ID block 1 \(rdagum \/ windows-pc\).*created on 2026-09-01.*claimed on 2026-09-04/);
    assert.equal(model.items.get('items/STORY-001001.md').errors.length, 1);
    assert.equal(model.items.get('items/STORY-001002.md').errors.length, 0);
  });

  it('skips the claim-date check when the entry has no date or the item has no valid date', () => {
    const model = modelFrom({
      'items/STORY-001001.md': itemText('STORY-001001'),
      'items/STORY-002001.md': itemText('STORY-002001').replace('created: 2026-09-01', 'created: soon'),
    }, {
      allocation: { strategy: 'block' },
      blocks: [{ block: 1, owner: 'a', label: '', claimed: null }, { block: 2, owner: 'b', label: '', claimed: '2026-09-04' }],
      local: { id_block: 1 },
    });
    assert.deepEqual(validateRepository(model).errors, []);
  });

  it('reports a local id_block that is not in the registry (strategy block only)', () => {
    const files = { 'items/STORY-000001.md': itemText('STORY-000001') };
    const blocks = [{ block: 1, owner: 'a', label: '', claimed: null }];
    const bad = modelFrom(files, { allocation: { strategy: 'block' }, blocks, local: { id_block: 2 } });
    const r = validateRepository(bad);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].file, 'config/user.local.yaml');
    assert.equal(r.errors[0].code, 'unregistered-local-block');
    assert.match(r.errors[0].message, /id_block 2 is not claimed in config\/id-blocks\.yaml/);

    const good = modelFrom(files, { allocation: { strategy: 'block' }, blocks, local: { id_block: 1 } });
    assert.deepEqual(validateRepository(good).errors, []);

    const sequential = modelFrom(files, { blocks, local: { id_block: 2 } });
    const s = validateRepository(sequential);
    assert.deepEqual(s.errors, []);
    assert.equal(s.warnings.length, 1);
    assert.match(s.warnings[0], /id_block 2.*ignored/);
  });

  it('reports an id_block that is not a usable number regardless of strategy', () => {
    for (const id_block of ['two', 0, -1, 1000, 1.5]) {
      const model = modelFrom({}, { local: { id_block } });
      const r = validateRepository(model);
      assert.equal(r.errors.length, 1, String(id_block));
      assert.equal(r.errors[0].code, 'invalid-local-block');
    }
  });

  it('does not complain about an absent id_block', () => {
    for (const local of [{}, { id_block: null }, { id_block: '' }]) {
      assert.deepEqual(validateRepository(modelFrom({}, { local })).errors, []);
    }
  });
});

describe('allocation: rewriteReferences', () => {
  const doc = [
    '---',
    'id: STORY-000020',
    'title: "Mentions STORY-000014 in the title"',
    'parent: STORY-000014',
    'depends_on:',
    '  - STORY-000014',
    '  - STORY-000141',
    'blocks: [STORY-000014, BUG-000014]',
    'related: []',
    'labels:',
    '  - STORY-000014',
    'custom:',
    '  note: STORY-000014',
    '---',
    '',
    'See STORY-000014 and STORY-000014.md, not STORY-0000140 or XSTORY-000014.',
    '',
  ].join('\n');

  it('rewrites only the relationship fields by default', () => {
    const { text, changed } = rewriteReferences(doc, 'STORY-000014', 'STORY-002001');
    assert.equal(changed, 3);
    assert.equal(text, doc
      .replace('parent: STORY-000014', 'parent: STORY-002001')
      .replace('  - STORY-000014\n  - STORY-000141', '  - STORY-002001\n  - STORY-000141')
      .replace('blocks: [STORY-000014, BUG-000014]', 'blocks: [STORY-002001, BUG-000014]'));
  });

  it('rewrites whole-word body mentions with body: true', () => {
    const { text, changed } = rewriteReferences(doc, 'STORY-000014', 'STORY-002001', { body: true });
    assert.equal(changed, 4);
    assert.ok(text.endsWith('See STORY-002001 and STORY-002001.md, not STORY-0000140 or XSTORY-000014.\n'));
    assert.ok(text.includes('title: "Mentions STORY-000014 in the title"'), 'non-relationship fields stay');
    assert.ok(text.includes('  note: STORY-000014'));
  });

  it('returns the text unchanged when nothing references the ID', () => {
    const { text, changed } = rewriteReferences(doc, 'STORY-000099', 'STORY-000100', { body: true });
    assert.equal(changed, 0);
    assert.equal(text, doc);
  });

  it('preserves CRLF line endings and a BOM', () => {
    const crlf = '﻿' + doc.replace(/\n/g, '\r\n');
    const { text, changed } = rewriteReferences(crlf, 'STORY-000014', 'STORY-002001', { body: true });
    assert.equal(changed, 4);
    assert.ok(text.startsWith('﻿---\r\n'));
    assert.equal(text.includes('\n') && !text.includes('\r\n'), false);
    assert.equal(text.split('\r\n').length, crlf.split('\r\n').length);
    assert.ok(text.includes('parent: STORY-002001\r\n'));
  });

  it('never touches a file without front matter unless body rewriting is requested', () => {
    const plain = 'depends_on: STORY-000014\n';
    assert.equal(rewriteReferences(plain, 'STORY-000014', 'X-000001').changed, 0);
    assert.equal(rewriteReferences(plain, 'STORY-000014', 'X-000001', { body: true }).changed, 1);
  });
});

describe('allocation: patchIdLine', () => {
  it('rewrites the id line and nothing else', () => {
    const text = '---\nid: STORY-000014\ntitle: x\n---\n\nid: STORY-000014 (body)\n';
    assert.equal(patchIdLine(text, 'STORY-002001'), '---\nid: STORY-002001\ntitle: x\n---\n\nid: STORY-000014 (body)\n');
    assert.equal(patchIdLine('---\r\nid: A-000001\r\n---\r\n', 'A-000002'), '---\r\nid: A-000002\r\n---\r\n');
  });

  it('returns null when there is no id line in the front matter', () => {
    assert.equal(patchIdLine('---\ntitle: x\n---\n', 'A-000001'), null);
    assert.equal(patchIdLine('id: A-000001\n', 'A-000002'), null);
  });
});

describe('allocation: renumberPlan', () => {
  function repo() {
    return modelFrom({
      'items/STORY-000014.md': itemText('STORY-000014', { parent: 'EPIC-000001' }, '# Summary\n\nI am STORY-000014.\n'),
      'items/STORY-000015.md': itemText('STORY-000015', { depends_on: ['STORY-000014'], related: ['STORY-000014', 'BUG-000001'] }, 'Follows STORY-000014.\n'),
      'items/EPIC-000001.md': itemText('EPIC-000001', { blocks: ['STORY-000014'] }),
      'items/BUG-000001.md': itemText('BUG-000001'),
    });
  }

  it('renames the file, patches its id and rewrites every reference', () => {
    const plan = renumberPlan(repo(), 'STORY-000014', 'STORY-002001');
    assert.equal(plan.rename.from, 'items/STORY-000014.md');
    assert.equal(plan.rename.to, 'items/STORY-002001.md');
    assert.ok(plan.rename.text.includes('\nid: STORY-002001\n'));
    assert.ok(plan.rename.text.includes('I am STORY-000014.'), 'body untouched without --body');
    assert.deepEqual(plan.updates.map((u) => [u.path, u.changed]), [['items/STORY-000015.md', 2], ['items/EPIC-000001.md', 1]]);
    const s15 = plan.updates[0].text;
    assert.ok(s15.includes('depends_on:\n  - STORY-002001'));
    assert.ok(s15.includes('related:\n  - STORY-002001\n  - BUG-000001'));
    assert.ok(s15.includes('Follows STORY-000014.'));
  });

  it('rewrites body mentions, including the item\'s own, with body: true', () => {
    const plan = renumberPlan(repo(), 'STORY-000014', 'STORY-002001', { body: true });
    assert.ok(plan.rename.text.includes('I am STORY-002001.'));
    assert.ok(plan.updates[0].text.includes('Follows STORY-002001.'));
    assert.equal(plan.updates[0].changed, 3);
  });

  it('refuses unsafe requests without touching anything', () => {
    assert.throws(() => renumberPlan(repo(), 'STORY-14', 'STORY-002001'), /not a valid work-item ID/);
    assert.throws(() => renumberPlan(repo(), 'STORY-000014', 'story-2001'), /not a valid work-item ID/);
    assert.throws(() => renumberPlan(repo(), 'STORY-000014', 'STORY-000014'), /same/);
    assert.throws(() => renumberPlan(repo(), 'STORY-000014', 'BUG-002001'), /Cannot change the type/);
    assert.throws(() => renumberPlan(repo(), 'STORY-000014', 'STORY-000015'), /already exists/);
    assert.throws(() => renumberPlan(repo(), 'STORY-000099', 'STORY-002001'), /was not found/);
  });

  it('finds the source by declared id even when the file name is wrong, and keeps its directory', () => {
    const model = modelFrom({ 'items/misnamed.md': itemText('STORY-000014') });
    const plan = renumberPlan(model, 'STORY-000014', 'STORY-000030');
    assert.equal(plan.rename.from, 'items/misnamed.md');
    assert.equal(plan.rename.to, 'items/STORY-000030.md');
  });
});
