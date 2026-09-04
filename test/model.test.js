// test/model.test.js — core/model.js loadRepository and the store's block claim,
// driven through an in-memory filesystem that implements the WorkspecFS
// interface (exists / readFile / writeFile / deleteFile / listFiles).

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadWS, PURE_MODULES } = require('./load.js');

const WS = loadWS([...PURE_MODULES, 'state/store.js']);
const { loadRepository, allocateId, allocationState, Store } = WS;

class MemFS {
  constructor(files = {}, name = 'repo') {
    this.name = name;
    this.files = new Map(Object.entries(files));
    this.writes = [];
  }
  async exists(p) {
    return this.files.has(p);
  }
  async readFile(p) {
    if (!this.files.has(p)) throw new Error(`ENOENT ${p}`);
    return this.files.get(p);
  }
  async writeFile(p, text) {
    this.files.set(p, text);
    this.writes.push(p);
  }
  async deleteFile(p) {
    this.files.delete(p);
  }
  async listFiles(dir, { ext = null } = {}) {
    return [...this.files.keys()]
      .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
      .filter((p) => !ext || p.toLowerCase().endsWith(ext))
      .sort()
      .map((p) => ({ name: p.split('/').pop(), path: p }));
  }
}

function item(id, { created = '2026-09-01', status = 'Backlog', extra = '' } = {}) {
  return `---\nid: ${id}\ntype: ${id.split('-')[0]}\ntitle: "${id}"\nstatus: ${status}\ncreated: ${created}\nupdated: ${created}\n${extra}spec_version: 1.0\n---\n\n# Summary\n`;
}

const WORKFLOW = 'columns:\n  - Backlog\n  - Done\n';
const BOARD_SEQ = 'name: Test\nspec_version: 1.0\n';
const BOARD_BLOCK = 'name: Test\nspec_version: 1.0\nid_allocation:\n  strategy: block\n  block_size: 1000\n';
const REGISTRY = 'blocks:\n  - { block: 1, owner: rdagum, label: windows-pc, claimed: 2026-09-04 }\n  - { block: 2, owner: rdagum, label: macbook }\n';

const baseFiles = (board, extra = {}) => ({
  'config/workflow.yaml': WORKFLOW,
  'config/board.yaml': board,
  'items/STORY-000001.md': item('STORY-000001'),
  'items/STORY-000002.md': item('STORY-000002'),
  ...extra,
});

describe('model: loadRepository without id_allocation (1.0 behaviour)', () => {
  it('is sequential, has no blocks and reports nothing', async () => {
    const model = await loadRepository(new MemFS(baseFiles(BOARD_SEQ)));
    assert.deepEqual(model.idAllocation, { strategy: 'sequential', blockSize: 1000 });
    assert.deepEqual(model.idBlocks, []);
    assert.deepEqual(model.loadErrors, []);
    assert.deepEqual(model.warnings, []);
    assert.deepEqual([...model.itemsById.keys()], ['STORY-000001', 'STORY-000002']);
    assert.equal(allocateId(model, 'STORY'), 'STORY-000003');
    assert.equal(allocationState(model).problem, null);
  });

  it('still reports duplicate IDs and file-name mismatches', async () => {
    const fs = new MemFS(baseFiles(BOARD_SEQ, { 'items/copy.md': item('STORY-000002') }));
    const model = await loadRepository(fs);
    const copy = model.items.get('items/copy.md');
    const orig = model.items.get('items/STORY-000002.md');
    assert.ok(copy.errors.some((e) => /does not match ID/.test(e)));
    assert.ok(copy.errors.some((e) => /Duplicate ID "STORY-000002"/.test(e)));
    assert.ok(orig.errors.some((e) => /Duplicate ID "STORY-000002" is also declared by items\/copy\.md/.test(e)));
    assert.equal(model.loadErrors.filter((e) => e.code === 'duplicate-id').length, 2);
    assert.equal(model.itemsById.get('STORY-000002'), orig, 'first file in listing order wins the index');
    assert.equal(allocateId(model, 'STORY'), 'STORY-000003');
  });

  it('ignores a stray id_block with a warning', async () => {
    const fs = new MemFS(baseFiles(BOARD_SEQ, { 'config/user.local.yaml': 'id_block: 3\n' }));
    const model = await loadRepository(fs);
    assert.deepEqual(model.loadErrors, []);
    assert.equal(model.warnings.length, 1);
    assert.match(model.warnings[0], /id_block 3.*ignored/);
    assert.equal(allocateId(model, 'STORY'), 'STORY-000003');
  });
});

describe('model: loadRepository with id_allocation.strategy block', () => {
  it('reads the registry and the local block and allocates inside it', async () => {
    const fs = new MemFS(baseFiles(BOARD_BLOCK, {
      'config/id-blocks.yaml': REGISTRY,
      'config/user.local.yaml': 'name: Rodolfo\nhandle: rdagum\nid_block: 2\n',
    }));
    const model = await loadRepository(fs);
    assert.deepEqual(model.loadErrors, []);
    assert.deepEqual(model.warnings, []);
    assert.deepEqual(model.idAllocation, { strategy: 'block', blockSize: 1000 });
    assert.equal(model.idBlocks.length, 2);
    assert.equal(model.idBlocks[0].claimed, '2026-09-04');
    const state = allocationState(model);
    assert.equal(state.problem, null);
    assert.equal(state.entry.label, 'macbook');
    assert.equal(allocateId(model, 'STORY'), 'STORY-002001');
    assert.equal(allocateId(model, 'BUG'), 'BUG-002001');
  });

  it('warns when no registry exists yet and refuses to allocate without a block', async () => {
    const model = await loadRepository(new MemFS(baseFiles(BOARD_BLOCK)));
    assert.deepEqual(model.loadErrors, []);
    assert.equal(model.warnings.length, 1);
    assert.match(model.warnings[0], /id-blocks\.yaml not found/);
    assert.equal(allocationState(model).problem, 'no-block');
    assert.throws(() => allocateId(model, 'STORY'), (e) => e.code === 'no-block');
  });

  it('reports a local block that the registry does not know', async () => {
    const fs = new MemFS(baseFiles(BOARD_BLOCK, {
      'config/id-blocks.yaml': REGISTRY,
      'config/user.local.yaml': 'id_block: 7\n',
    }));
    const model = await loadRepository(fs);
    assert.equal(model.loadErrors.length, 1);
    assert.equal(model.loadErrors[0].file, 'config/user.local.yaml');
    assert.equal(model.loadErrors[0].code, 'unregistered-local-block');
    assert.throws(() => allocateId(model, 'STORY'), (e) => e.code === 'unregistered');
  });

  it('reports registry problems against the registry file and keeps the good entries', async () => {
    const registry = 'blocks:\n  - { block: 1, owner: a, label: x }\n  - { block: 1, owner: b, label: y }\n  - { block: 0, owner: c }\n';
    const fs = new MemFS(baseFiles(BOARD_BLOCK, { 'config/id-blocks.yaml': registry, 'config/user.local.yaml': 'id_block: 1\n' }));
    const model = await loadRepository(fs);
    assert.equal(model.idBlocks.length, 1);
    assert.equal(model.loadErrors.length, 2);
    for (const e of model.loadErrors) assert.equal(e.file, 'config/id-blocks.yaml');
    assert.match(model.loadErrors[0].message, /block 1 is already claimed by a \/ x/);
    assert.match(model.loadErrors[1].message, /block 0 is the legacy sequential range/);
    assert.equal(allocateId(model, 'STORY'), 'STORY-001001', 'a broken registry line does not stop the valid block');
  });

  it('flags an item inside a claimed block that predates the claim', async () => {
    const fs = new MemFS(baseFiles(BOARD_BLOCK, {
      'config/id-blocks.yaml': REGISTRY,
      'config/user.local.yaml': 'id_block: 1\n',
      'items/STORY-001001.md': item('STORY-001001', { created: '2026-08-30' }),
      'items/STORY-001002.md': item('STORY-001002', { created: '2026-09-05' }),
    }));
    const model = await loadRepository(fs);
    assert.equal(model.loadErrors.length, 1);
    assert.equal(model.loadErrors[0].code, 'foreign-item');
    assert.equal(model.loadErrors[0].file, 'items/STORY-001001.md');
    assert.equal(model.items.get('items/STORY-001001.md').errors.length, 1);
    assert.equal(model.items.get('items/STORY-001002.md').errors.length, 0);
    assert.equal(allocateId(model, 'STORY'), 'STORY-001003');
  });

  it('falls back to sequential and reports a bad id_allocation', async () => {
    const board = 'name: Test\nspec_version: 1.0\nid_allocation:\n  strategy: random\n';
    const model = await loadRepository(new MemFS(baseFiles(board)));
    assert.equal(model.loadErrors.length, 1);
    assert.equal(model.loadErrors[0].file, 'config/board.yaml');
    assert.match(model.loadErrors[0].message, /strategy "random"/);
    assert.equal(model.idAllocation.strategy, 'sequential');
    assert.equal(allocateId(model, 'STORY'), 'STORY-000003');
  });
});

describe('store: claimIdBlock', () => {
  async function storeFor(files) {
    const fs = new MemFS(files);
    const model = await loadRepository(fs);
    const store = new Store();
    store.state.fs = fs;
    store.state.model = model;
    return { fs, model, store };
  }

  it('creates the registry and local file, registers the block and unblocks allocation', async () => {
    const { fs, model, store } = await storeFor(baseFiles(BOARD_BLOCK));
    let emitted = 0;
    store.subscribe(() => emitted++);
    assert.equal(allocationState(model).problem, 'no-block');

    const entry = await store.claimIdBlock({ owner: 'rdagum', label: 'windows-pc' });
    assert.equal(entry.block, 1);
    assert.match(entry.claimed, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(fs.writes, ['config/id-blocks.yaml', 'config/user.local.yaml']);
    assert.match(fs.files.get('config/id-blocks.yaml'), /^# Claimed ID blocks[\s\S]*blocks:\n  - \{ block: 1, owner: rdagum, label: windows-pc, claimed: \d{4}-\d{2}-\d{2} \}\n$/);
    assert.equal(fs.files.get('config/user.local.yaml'), 'handle: rdagum\nid_block: 1\n');
    assert.deepEqual(model.idBlocks, [entry]);
    assert.equal(model.local.id_block, 1);
    assert.equal(model.local.handle, 'rdagum');
    assert.equal(emitted, 1);
    assert.equal(allocationState(model).problem, null);
    assert.equal(allocateId(model, 'STORY'), 'STORY-001001');

    // A reload sees exactly what the store wrote.
    const reloaded = await loadRepository(fs);
    assert.deepEqual(reloaded.loadErrors, []);
    assert.equal(allocateId(reloaded, 'STORY'), 'STORY-001001');
  });

  it('appends to an existing registry, keeps the local file and clears the stale notice', async () => {
    const { fs, model, store } = await storeFor(baseFiles(BOARD_BLOCK, {
      'config/id-blocks.yaml': REGISTRY,
      'config/user.local.yaml': 'name: Rodolfo\nhandle: rdagum\ntheme: light\nid_block: 9\n',
      'items/STORY-003004.md': item('STORY-003004'),
    }));
    assert.equal(model.loadErrors[0].code, 'unregistered-local-block');
    const entry = await store.claimIdBlock({ owner: 'rdagum', label: 'ci-agent' });
    assert.equal(entry.block, 4, 'blocks 1-2 are registered and 3 holds an item');
    assert.equal(fs.files.get('config/user.local.yaml'), 'name: Rodolfo\nhandle: rdagum\ntheme: light\nid_block: 4\n');
    assert.ok(fs.files.get('config/id-blocks.yaml').endsWith('  - { block: 4, owner: rdagum, label: ci-agent, claimed: ' + entry.claimed + ' }\n'));
    assert.deepEqual(model.loadErrors, []);
    assert.equal(allocateId(model, 'STORY'), 'STORY-004001');
  });
});

describe('store: addItem / deleteItem keep the ID index current', () => {
  it('indexes a created item and drops a deleted one', async () => {
    const fs = new MemFS(baseFiles(BOARD_SEQ));
    const model = await loadRepository(fs);
    const store = new Store();
    store.state.fs = fs;
    store.state.model = model;
    const meta = { id: 'STORY-000003', type: 'STORY', title: 't', status: 'Backlog', created: '2026-09-04', updated: '2026-09-04', spec_version: '1.0' };
    const record = await store.addItem('items/STORY-000003.md', meta, '# Summary\n');
    assert.equal(model.itemsById.get('STORY-000003'), record);
    assert.equal(allocateId(model, 'STORY'), 'STORY-000004');
    await store.deleteItem('items/STORY-000003.md');
    assert.equal(model.itemsById.has('STORY-000003'), false);
    assert.equal(allocateId(model, 'STORY'), 'STORY-000003');
  });
});

describe('model: half-merged files never load as valid', () => {
  it('reports conflict markers in the registry and in an item', async () => {
    const fs = new MemFS(baseFiles(BOARD_BLOCK, {
      'config/id-blocks.yaml': 'blocks:\n<<<<<<< HEAD\n  - { block: 3, owner: a }\n=======\n  - { block: 3, owner: b }\n>>>>>>> origin/feat-c\n',
      'config/user.local.yaml': 'id_block: 3\n',
      'items/STORY-000003.md': item('STORY-000003').replace('status: Backlog', '<<<<<<< HEAD\nstatus: Backlog\n=======\nstatus: Done\n>>>>>>> theirs'),
    }));
    const model = await loadRepository(fs);
    const registry = model.loadErrors.filter((e) => e.file === 'config/id-blocks.yaml');
    assert.ok(registry.length >= 1, JSON.stringify(model.loadErrors));
    assert.match(registry[0].message, /Unresolved Git conflict markers/);
    assert.ok(model.items.get('items/STORY-000003.md').errors.some((e) => /conflict markers/.test(e)));
  });
});
