// test/tools.test.js — the command-line tools, run as child processes against
// throwaway repositories: exit codes, output and the files they leave behind.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT } = require('./load.js');

const VALIDATE = path.join(ROOT, 'tools', 'validate-workspec.js');
const RENUMBER = path.join(ROOT, 'tools', 'renumber.js');

function run(tool, args, cwd) {
  const r = spawnSync(process.execPath, [tool, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

function item(id, fields = {}, body = '# Summary\n') {
  const lines = ['---', `id: ${id}`, `type: ${id.split('-')[0]}`, `title: "${id}"`, 'status: Backlog'];
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) lines.push(v.length ? `${k}:\n${v.map((x) => `  - ${x}`).join('\n')}` : `${k}: []`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push('created: 2026-09-01', 'updated: 2026-09-01', 'spec_version: 1.0', '---', '', body);
  return lines.join('\n');
}

/** Make a repository root with a .workspec inside; returns { root, ws }. */
function makeRepo(files, { board = 'name: T\nspec_version: 1.0\n' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspec-tools-'));
  const ws = path.join(root, '.workspec');
  const all = { 'config/board.yaml': board, 'config/workflow.yaml': 'columns:\n  - Backlog\n  - Done\n', ...files };
  for (const [rel, text] of Object.entries(all)) {
    const file = path.join(ws, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  }
  return { root, ws };
}

const read = (ws, rel) => fs.readFileSync(path.join(ws, ...rel.split('/')), 'utf8');
const exists = (ws, rel) => fs.existsSync(path.join(ws, ...rel.split('/')));

describe('tools: validate-workspec.js', () => {
  it('passes a clean repository and finds it from the repo root, a subdirectory or an explicit path', () => {
    const { root, ws } = makeRepo({ 'items/STORY-000001.md': item('STORY-000001') });
    const sub = path.join(root, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    for (const [args, cwd] of [[[], root], [[], sub], [[ws], os.tmpdir()], [[root], os.tmpdir()]]) {
      const r = run(VALIDATE, args, cwd);
      assert.equal(r.code, 0, r.all);
      assert.match(r.out, /^OK: 1 item\(s\), 0 error\(s\), 0 warning\(s\)/);
    }
  });

  it('fails with one line per problem on a duplicate ID', () => {
    const { root } = makeRepo({
      'items/STORY-000014.md': item('STORY-000014'),
      'items/STORY-000014-copy.md': item('STORY-000014'),
    });
    const r = run(VALIDATE, [], root);
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /error {4}items\/STORY-000014\.md: Duplicate ID "STORY-000014" is also declared by items\/STORY-000014-copy\.md/);
    assert.match(r.err, /error {4}items\/STORY-000014-copy\.md: Filename "STORY-000014-copy\.md" does not match ID/);
    assert.match(r.err, /FAILED: 2 item\(s\), 3 error\(s\), 0 warning\(s\)/);
    assert.equal((r.err.match(/Duplicate ID/g) || []).length, 2, 'each file reported once');
  });

  it('checks the registry and the block rules', () => {
    const board = 'name: T\nspec_version: 1.0\nid_allocation:\n  strategy: block\n';
    const { root } = makeRepo({
      'config/id-blocks.yaml': 'blocks:\n  - { block: 1, owner: a, label: pc, claimed: 2026-09-04 }\n  - { block: 1, owner: b, label: mac }\n',
      'items/STORY-001001.md': item('STORY-001001'),
    }, { board });
    const r = run(VALIDATE, ['--quiet'], root);
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /config\/id-blocks\.yaml: blocks\[1\]: block 1 is already claimed by a \/ pc/);
    assert.match(r.err, /items\/STORY-001001\.md: STORY-001001 lies in ID block 1 \(a \/ pc\).*allocated by someone else/);
    assert.equal(r.out.trim(), '', '--quiet prints no summary');
  });

  it('turns warnings into failures only with --strict', () => {
    const board = 'name: T\nspec_version: 1.0\nid_allocation:\n  strategy: block\n';
    const { root } = makeRepo({ 'items/STORY-000001.md': item('STORY-000001') }, { board });
    const soft = run(VALIDATE, [], root);
    assert.equal(soft.code, 0, soft.all);
    assert.match(soft.out, /warning {2}config\/id-blocks\.yaml not found/);
    const strict = run(VALIDATE, ['--strict'], root);
    assert.equal(strict.code, 1, strict.all);
  });

  it('exits 2 when the repository cannot be found or loaded', () => {
    assert.equal(run(VALIDATE, [path.join(os.tmpdir(), 'no-such-dir-xyz')], os.tmpdir()).code, 2);
    const { root } = makeRepo({}, { board: 'name: T\nspec_version: 2.0\n' });
    const r = run(VALIDATE, [], root);
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /Unsupported spec_version 2\.0/);
    assert.equal(run(VALIDATE, ['--bogus'], root).code, 2);
  });
});

describe('tools: renumber.js', () => {
  function collisionRepo() {
    return makeRepo({
      'items/STORY-000014.md': item('STORY-000014', { parent: 'EPIC-000001' }, '# Summary\n\nSelf: STORY-000014.\n'),
      'items/STORY-000015.md': item('STORY-000015', { depends_on: ['STORY-000014'], related: ['STORY-000014', 'BUG-000001'] }, 'See STORY-000014.\n'),
      'items/EPIC-000001.md': item('EPIC-000001', { blocks: ['STORY-000014'] }),
      'items/BUG-000001.md': item('BUG-000001'),
    });
  }

  it('renames the file, patches the id and rewrites references; the result validates', () => {
    const { root, ws } = collisionRepo();
    const r = run(RENUMBER, ['STORY-000014', 'STORY-002001'], root);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /renamed {2}items\/STORY-000014\.md -> items\/STORY-002001\.md/);
    assert.match(r.out, /updated {2}items\/STORY-000015\.md \(2 line\(s\)\)/);
    assert.match(r.out, /updated {2}items\/EPIC-000001\.md \(1 line\(s\)\)/);
    assert.match(r.out, /note {5}2 body mention\(s\) of STORY-000014 left as they are; rerun with --body/);
    assert.equal(exists(ws, 'items/STORY-000014.md'), false);
    const moved = read(ws, 'items/STORY-002001.md');
    assert.ok(moved.includes('\nid: STORY-002001\n'));
    assert.ok(moved.includes('parent: EPIC-000001'));
    assert.ok(moved.includes('Self: STORY-000014.'), 'body untouched without --body');
    assert.ok(read(ws, 'items/STORY-000015.md').includes('depends_on:\n  - STORY-002001\nrelated:\n  - STORY-002001\n  - BUG-000001'));
    assert.ok(read(ws, 'items/EPIC-000001.md').includes('blocks:\n  - STORY-002001'));
    assert.equal(read(ws, 'items/BUG-000001.md'), item('BUG-000001'), 'unrelated file untouched');
    const v = run(VALIDATE, [], root);
    assert.equal(v.code, 0, v.all);
  });

  it('rewrites body mentions with --body and accepts lower-case IDs', () => {
    const { root, ws } = collisionRepo();
    const r = run(RENUMBER, ['story-000014', 'story-002001', '--body'], root);
    assert.equal(r.code, 0, r.all);
    assert.doesNotMatch(r.out, /body mention/);
    assert.ok(read(ws, 'items/STORY-002001.md').includes('Self: STORY-002001.'));
    assert.ok(read(ws, 'items/STORY-000015.md').includes('See STORY-002001.'));
  });

  it('--dry-run reports the plan and writes nothing', () => {
    const { root, ws } = collisionRepo();
    const before = read(ws, 'items/STORY-000015.md');
    const r = run(RENUMBER, ['STORY-000014', 'STORY-002001', '--dry-run'], root);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /would rename {2}items\/STORY-000014\.md -> items\/STORY-002001\.md/);
    assert.match(r.out, /would update {2}items\/STORY-000015\.md/);
    assert.equal(exists(ws, 'items/STORY-000014.md'), true);
    assert.equal(exists(ws, 'items/STORY-002001.md'), false);
    assert.equal(read(ws, 'items/STORY-000015.md'), before);
  });

  it('refuses an existing target, a type change or an unknown source without touching files', () => {
    const { root, ws } = collisionRepo();
    const snapshot = () => fs.readdirSync(path.join(ws, 'items')).map((n) => [n, read(ws, `items/${n}`)]);
    const before = snapshot();
    for (const [args, re] of [
      [['STORY-000014', 'STORY-000015'], /refused {2}STORY-000015 already exists/],
      [['STORY-000014', 'BUG-000099'], /refused {2}Cannot change the type/],
      [['STORY-000099', 'STORY-000100'], /refused {2}STORY-000099 was not found/],
      [['STORY-000014', 'STORY-14'], /refused {2}"STORY-14" is not a valid work-item ID/],
    ]) {
      const r = run(RENUMBER, args, root);
      assert.equal(r.code, 1, r.all);
      assert.match(r.err, re);
    }
    assert.deepEqual(snapshot(), before);
    assert.equal(run(RENUMBER, ['STORY-000014'], root).code, 2, 'missing NEW-ID is a usage error');
  });

  it('accepts --dir for a repository elsewhere', () => {
    const { root, ws } = collisionRepo();
    const r = run(RENUMBER, ['STORY-000014', 'STORY-002001', `--dir=${root}`], os.tmpdir());
    assert.equal(r.code, 0, r.all);
    assert.equal(exists(ws, 'items/STORY-002001.md'), true);
  });
});
