// test/tools.test.js — the command-line tools, run as child processes against
// throwaway repositories: exit codes, output and the files they leave behind.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, loadWS } = require('./load.js');
const { encodeProjectDir } = require('../tools/transcript.js');

const VALIDATE = path.join(ROOT, 'tools', 'validate-workspec.js');
const RENUMBER = path.join(ROOT, 'tools', 'renumber.js');
const RECORD = path.join(ROOT, 'tools', 'record-usage.js');
const REPORT = path.join(ROOT, 'tools', 'usage-report.js');

/** Run a tool; `env` adds to (or overrides) the inherited environment. */
function run(tool, args, cwd, env = {}) {
  const r = spawnSync(process.execPath, [tool, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
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

// --- AI usage tools (STORY-001002) -------------------------------------------------

const WS = loadWS();

/** Today's local date, the default run date. */
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** An item with `agent` front matter (YAML text, newline-terminated) before the closing fence. */
function itemWithAgent(id, fields, agentYaml, body) {
  return item(id, fields, body).replace('spec_version: 1.0\n---', `spec_version: 1.0\n${agentYaml}---`);
}

/** The block of YAML lines one run is appended as, at the given indent. */
function runBlock(run, pad = '    ') {
  return Object.entries(run).map(([k, v], i) => `${pad}${i === 0 ? '- ' : '  '}${k}: ${v}`);
}

/** The runs of an item file as the loader reads them. */
const runsIn = (ws, id) => WS.parseItem(`items/${id}.md`, read(ws, `items/${id}.md`)).meta.agent.runs;

/** record-usage.js with CLAUDE_CONFIG_DIR at an empty throwaway directory unless `env` says otherwise. */
function record(args, cwd, env = {}) {
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'workspec-claude-'));
  return run(RECORD, args, cwd, { CLAUDE_CONFIG_DIR: claude, ...env });
}

describe('tools: record-usage.js by hand', () => {
  // A CRLF file with comments around the runs and a key after `agent`.
  const CRLF_ITEM = [
    '---',
    'id: STORY-000001',
    'type: STORY',
    'title: "Quoted: title"',
    'status: Backlog',
    '# usage below',
    'agent:',
    '  budget_usd: 7.5',
    '  # recorded by tools',
    '  runs:',
    '    - date: 2026-09-10',
    '      handle: Opus',
    '      model: claude-opus-5-5',
    '      output_tokens: 100',
    '  # after the runs',
    'labels:',
    '  - ui',
    'created: 2026-09-01',
    'updated: 2026-09-01',
    'spec_version: 1.0',
    '---',
    '',
    '# Summary',
    '',
    'Body text.',
    '',
  ].join('\r\n');

  it('appends one run after the existing ones; every other line is byte-identical and the new lines use CRLF', () => {
    const { root, ws } = makeRepo({ 'items/STORY-000001.md': CRLF_ITEM });
    const r = record(
      [
        'story-000001', '--handle=Opus', '--model=claude-opus-5-5', '--input=10', '--output=20', '--cache-read=30',
        '--cache-write=40', '--cache-write-1h=5', '--cost=0.42', '--purpose=implement', '--ref=abc123',
        '--session=s-1', '--date=2026-09-11', '--estimated',
      ],
      root
    );
    assert.equal(r.code, 0, r.all);
    const block = runBlock({
      date: '2026-09-11', handle: 'Opus', model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 20,
      cache_read_tokens: 30, cache_write_tokens: 40, cache_write_1h_tokens: 5, cost_usd: '0.42',
      purpose: 'implement', ref: 'abc123', session: 's-1', source: 'manual', estimated: true,
    });
    const before = CRLF_ITEM.split('\n');
    const after = read(ws, 'items/STORY-000001.md').split('\n');
    const expected = [...before];
    expected.splice(14, 0, ...block.map((l) => l + '\r'));
    assert.deepEqual(after, expected);
    assert.ok(after.includes('updated: 2026-09-01\r'), 'updated is not touched');
    assert.equal(r.out, ['recorded  items/STORY-000001.md (1 run)', ...block, ''].join('\n'));
    assert.equal(runsIn(ws, 'STORY-000001').length, 2);
    const v = run(VALIDATE, [], root);
    assert.equal(v.code, 0, v.all);
  });

  it('creates agent and runs on an item that has neither, dated today by default', () => {
    const { root, ws } = makeRepo({ 'items/STORY-000002.md': item('STORY-000002') });
    const r = record(['STORY-000002', '--handle=Fable', '--model=m', '--output=7', '--cost=3'], root);
    assert.equal(r.code, 0, r.all);
    const expected = item('STORY-000002').split('\n');
    const at = expected.indexOf('---', 1);
    const block = runBlock({ date: today(), handle: 'Fable', model: 'm', output_tokens: 7, cost_usd: 3, source: 'manual' });
    expected.splice(at, 0, 'agent:', '  runs:', ...block);
    assert.equal(read(ws, 'items/STORY-000002.md'), expected.join('\n'));
  });

  it('--dry-run prints the exact lines and writes nothing', () => {
    const { root, ws } = makeRepo({ 'items/STORY-000002.md': item('STORY-000002') });
    const r = record(['STORY-000002', '--handle=Fable', '--model=m', '--date=2026-09-03', '--dry-run'], root);
    assert.equal(r.code, 0, r.all);
    const block = runBlock({ date: '2026-09-03', handle: 'Fable', model: 'm', source: 'manual' });
    assert.equal(r.out, ['would append  items/STORY-000002.md (1 run)', 'agent:', '  runs:', ...block, ''].join('\n'));
    assert.equal(read(ws, 'items/STORY-000002.md'), item('STORY-000002'));
  });

  it('refuses an unknown ID with exit 1 and bad arguments with exit 2, writing nothing', () => {
    const { root, ws } = makeRepo({ 'items/STORY-000002.md': item('STORY-000002') });
    const unknown = record(['STORY-000099', '--handle=Fable', '--model=m'], root);
    assert.equal(unknown.code, 1, unknown.all);
    assert.match(unknown.err, /refused {2}STORY-000099 was not found/);
    for (const args of [
      ['STORY-000002', '--model=m'],
      ['STORY-000002', '--handle=Fable'],
      ['STORY-000002', '--handle=Fable', '--model'],
      ['STORY-000002', '--handle=Fable', '--model=m', '--output=12k'],
      ['STORY-000002', '--handle=Fable', '--model=m', '--input=-1'],
      ['STORY-000002', '--handle=Fable', '--model=m', '--cost=$1'],
      ['STORY-000002', '--handle=Fable', '--model=m', '--date=2026-9-1'],
      ['STORY-000002', '--handle=Fable', '--model=m', '--bogus'],
      ['STORY-000002', '--handle=Fable', '--model=m', '--force=yes'],
      ['STORY-000002', '--handle=Fable', '--model=m', '--branch=main'],
      ['--handle=Fable', '--model=m'],
      ['STORY-000002', 'STORY-000003', '--handle=Fable', '--model=m'],
    ]) {
      const r = record(args, root);
      assert.equal(r.code, 2, `${args.join(' ')}\n${r.all}`);
    }
    assert.equal(read(ws, 'items/STORY-000002.md'), item('STORY-000002'));
    assert.equal(record(['STORY-000002', '--handle=Fable', '--model=m', path.join(os.tmpdir(), 'no-such-dir-xyz')], root).code, 2);
    assert.equal(record(['STORY-000002', '--handle=Fable', '--model=m', `--dir=${path.join(os.tmpdir(), 'no-such-dir-xyz')}`], root).code, 2);
  });

  it('refuses a second run with the same source, session and model unless --force', () => {
    const { root, ws } = makeRepo({ 'items/STORY-000002.md': item('STORY-000002') });
    const args = ['STORY-000002', '--handle=Fable', '--model=m', '--session=s-9', '--date=2026-09-03'];
    assert.equal(record(args, root).code, 0);
    const once = read(ws, 'items/STORY-000002.md');
    const again = record(args, root);
    assert.equal(again.code, 1, again.all);
    assert.match(again.err, /refused {2}STORY-000002 already has a run with source manual, session s-9 and model m; nothing was written/);
    assert.equal(read(ws, 'items/STORY-000002.md'), once);
    // Another model or source in the same session is a different run.
    assert.equal(record(['STORY-000002', '--handle=Fable', '--model=m2', '--session=s-9'], root).code, 0);
    const forced = record([...args, '--force'], root);
    assert.equal(forced.code, 0, forced.all);
    assert.equal(runsIn(ws, 'STORY-000002').length, 3);
  });

  it('falls back to re-serializing the front matter for a flow-style agent, and says so', () => {
    const flow = itemWithAgent('STORY-000003', {}, 'agent: { budget_usd: 5, runs: [ { date: 2026-09-01, handle: Opus, model: m } ] }\n', '# Summary\r\n\r\nKept as is.\r\n');
    const { root, ws } = makeRepo({ 'items/STORY-000003.md': flow });
    const r = record(['STORY-000003', '--handle=Fable', '--model=m2', '--date=2026-09-02'], root);
    assert.equal(r.code, 0, r.all);
    assert.match(r.err, /note {2}items\/STORY-000003\.md: .* the whole front matter was re-serialized/);
    const text = read(ws, 'items/STORY-000003.md');
    assert.ok(text.endsWith('---\n\n# Summary\r\n\r\nKept as is.\r\n'), 'body kept byte for byte');
    const meta = WS.parseItem('items/STORY-000003.md', text).meta;
    assert.equal(meta.agent.budget_usd, 5);
    assert.deepEqual(meta.agent.runs, [
      { date: '2026-09-01', handle: 'Opus', model: 'm' },
      { date: '2026-09-02', handle: 'Fable', model: 'm2', source: 'manual' },
    ]);
    assert.equal(meta.updated, '2026-09-01');
    assert.equal(run(VALIDATE, [], root).code, 0);
  });

  it('refuses when neither the line edit nor a lossless re-serialize is possible', () => {
    const lossy = itemWithAgent('STORY-000004', { owner: '&owner rdagum' }, 'agent: { runs: [ { date: 2026-09-01, handle: Opus, model: m } ] }\n');
    const scalar = itemWithAgent('STORY-000005', {}, 'agent: busy\n');
    const { root, ws } = makeRepo({ 'items/STORY-000004.md': lossy, 'items/STORY-000005.md': scalar });
    const a = record(['STORY-000004', '--handle=Fable', '--model=m'], root);
    assert.equal(a.code, 1, a.all);
    assert.match(a.err, /refused {2}items\/STORY-000004\.md: .*cannot be re-serialized without loss/);
    const b = record(['STORY-000005', '--handle=Fable', '--model=m'], root);
    assert.equal(b.code, 1, b.all);
    assert.match(b.err, /refused {2}items\/STORY-000005\.md: agent holds a value that is not a mapping/);
    assert.equal(read(ws, 'items/STORY-000004.md'), lossy);
    assert.equal(read(ws, 'items/STORY-000005.md'), scalar);
  });
});

describe('tools: record-usage.js --from-transcript', () => {
  // test/transcript.test.js documents the fixture's totals.
  const SESSION = '11111111-1111-4111-8111-111111111111';
  const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'transcripts');
  const TRANSCRIPT = path.join(FIXTURES, `${SESSION}.jsonl`);
  const HAIKU = {
    date: '2026-09-12', handle: 'Haiku', model: 'claude-haiku-5-5', input_tokens: 3, output_tokens: 30,
    cache_read_tokens: 300, cache_write_tokens: 50, session: SESSION, source: 'claude-code',
  };
  const SONNET = {
    date: '2026-09-12', handle: 'Sonnet', model: 'claude-sonnet-5-5', input_tokens: 35, output_tokens: 370,
    cache_read_tokens: 3000, cache_write_tokens: 1900, cache_write_1h_tokens: 2000, session: SESSION, source: 'claude-code',
  };
  const repo = (files = {}) => makeRepo({ 'items/STORY-000007.md': item('STORY-000007'), 'items/STORY-000001.md': item('STORY-000001'), ...files });

  it('records one run per model, counting each response once and including subagents', () => {
    const { root, ws } = repo();
    const r = record(['STORY-000007', `--from-transcript=${TRANSCRIPT}`], root);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /\(\+1 subagent file\(s\)\): 9 usage row\(s\), 5 distinct response\(s\), 3 skipped, 0 trimmed by filter/);
    assert.ok(r.out.includes(['recorded  items/STORY-000007.md (2 runs)', 'agent:', '  runs:', ...runBlock(HAIKU), ...runBlock(SONNET), ''].join('\n')));
    assert.deepEqual(runsIn(ws, 'STORY-000007'), [HAIKU, SONNET]);
    assert.equal(run(VALIDATE, [], root).code, 0);

    const again = record(['STORY-000007', `--from-transcript=${TRANSCRIPT}`], root);
    assert.equal(again.code, 1, again.all);
    assert.match(again.err, /already has a run with source claude-code, session 11111111-1111-4111-8111-111111111111 and model claude-haiku-5-5/);
    assert.equal(runsIn(ws, 'STORY-000007').length, 2);
  });

  it('--no-subagents leaves the subagent out; handles come from users.yaml, else --handle', () => {
    const users = 'users:\n  - name: S\n    handle: Sonny\n    kind: agent\n    model: claude-sonnet-5-5\n';
    const { root, ws } = repo({ 'config/users.yaml': users });
    const r = record(['STORY-000007', `--from-transcript=${TRANSCRIPT}`, '--no-subagents', '--purpose=implement'], root);
    assert.equal(r.code, 0, r.all);
    const { session, source, ...head } = SONNET;
    assert.deepEqual(runsIn(ws, 'STORY-000007'), [{ ...head, handle: 'Sonny', purpose: 'implement', session, source }]);
    const h = record(['STORY-000001', `--from-transcript=${TRANSCRIPT}`, '--handle=Opus', '--date=2026-09-20'], root);
    assert.equal(h.code, 0, h.all);
    assert.deepEqual(runsIn(ws, 'STORY-000001').map((x) => [x.handle, x.date]), [['Opus', '2026-09-20'], ['Opus', '2026-09-20']]);
  });

  it('finds a bare session ID through CLAUDE_CONFIG_DIR, in a worktree-named project directory', () => {
    const { root, ws } = repo();
    const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'workspec-claude-'));
    const enc = encodeProjectDir(path.resolve(root));
    fs.mkdirSync(path.join(claude, 'projects', enc), { recursive: true });
    const project = path.join(claude, 'projects', `${enc.toLowerCase()}--claude-worktrees-daily`);
    fs.mkdirSync(path.join(project, SESSION, 'subagents'), { recursive: true });
    fs.copyFileSync(TRANSCRIPT, path.join(project, `${SESSION}.jsonl`));
    fs.copyFileSync(path.join(FIXTURES, SESSION, 'subagents', 'agent-aaaa.jsonl'), path.join(project, SESSION, 'subagents', 'agent-aaaa.jsonl'));
    const r = record(['STORY-000007', `--from-transcript=${SESSION}`], root, { CLAUDE_CONFIG_DIR: claude });
    assert.equal(r.code, 0, r.all);
    assert.deepEqual(runsIn(ws, 'STORY-000007'), [HAIKU, SONNET]);
    const missing = record(['STORY-000007', '--from-transcript=22222222-2222-4222-8222-222222222222'], root, { CLAUDE_CONFIG_DIR: claude });
    assert.equal(missing.code, 2, missing.all);
    assert.match(missing.err, /Session 22222222-2222-4222-8222-222222222222 not found: searched 2 project directories/);
  });

  it('--branch keeps that branch\'s rows and marks the runs estimated', () => {
    const { root, ws } = repo();
    const r = record(['STORY-000007', `--from-transcript=${TRANSCRIPT}`, '--branch=workspec/story-000007-sample-feature'], root);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /6 usage row\(s\), 4 distinct response\(s\), 3 skipped, 3 trimmed by filter/);
    assert.deepEqual(runsIn(ws, 'STORY-000007'), [
      { ...HAIKU, estimated: true },
      { ...SONNET, input_tokens: 25, output_tokens: 250, cache_read_tokens: 2000, cache_write_tokens: 1400, estimated: true },
    ]);
  });

  it('--item-from-branch takes the ID from a workspec/<id> branch and refuses when it cannot', () => {
    const { root, ws } = repo();
    const r = record([`--from-transcript=${TRANSCRIPT}`, '--item-from-branch', '--dry-run'], root);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /would append {2}items\/STORY-000007\.md \(2 runs\)/);
    const differ = record(['STORY-000001', `--from-transcript=${TRANSCRIPT}`, '--item-from-branch'], root);
    assert.equal(differ.code, 1, differ.all);
    assert.match(differ.err, /refused {2}The transcript's branch names STORY-000007, not STORY-000001/);
    const none = record([`--from-transcript=${TRANSCRIPT}`, '--item-from-branch', '--branch=main'], root);
    assert.equal(none.code, 1, none.all);
    assert.match(none.err, /No workspec\/<id>-\.\.\. branch in the transcript rows \(branches: main\)/);
    assert.equal(read(ws, 'items/STORY-000007.md'), item('STORY-000007'));
    assert.equal(read(ws, 'items/STORY-000001.md'), item('STORY-000001'));
  });

  it('refuses a transcript without usage, and rejects run options the transcript supplies', () => {
    const { root, ws } = repo();
    const empty = record(['STORY-000007', `--from-transcript=${TRANSCRIPT}`, '--since=2027-01-01'], root);
    assert.equal(empty.code, 1, empty.all);
    assert.match(empty.err, /refused {2}No usage found in session 11111111-1111-4111-8111-111111111111 after the filters/);
    for (const extra of ['--model=m', '--output=5', '--session=x', '--source=manual', '--cost=1']) {
      const r = record(['STORY-000007', `--from-transcript=${TRANSCRIPT}`, extra], root);
      assert.equal(r.code, 2, `${extra}\n${r.all}`);
    }
    assert.equal(record(['STORY-000007', `--from-transcript=${path.join(FIXTURES, 'nope.jsonl')}`], root).code, 2);
    assert.equal(read(ws, 'items/STORY-000007.md'), item('STORY-000007'));
  });
});

describe('tools: usage-report.js', () => {
  // model-a: $50 per million output; model-b: $1 in, $5 out per million; model-z unpriced.
  const AI_YAML = 'pricing:\n  model-a: { input: 10, output: 50 }\n  model-b: { input: 1, output: 5 }\ndefaults:\n  budget_usd: { STORY: 10, BUG: 5 }\n';
  const runYaml = (date, handle, modelId, tokens) =>
    `    - date: ${date}\n      handle: ${handle}\n      model: ${modelId}\n${Object.entries(tokens).map(([k, v]) => `      ${k}: ${v}\n`).join('')}`;
  const agent = (runs, budget) => `agent:\n${budget != null ? `  budget_usd: ${budget}\n` : ''}  runs:\n${runs.join('')}`;

  //   EPIC-000001   Backlog                 own run $5, budget 20
  //   STORY-000001  Done, Opus, [ui, cli]   $5 + $10 = $15 > type default 10: over budget
  //   STORY-000002  Backlog                 no runs, under the epic
  //   TASK-000001   Backlog, Sonnet         one unpriced run, under STORY-000001
  //   BUG-000001    Backlog, [cli]          $1 of 5
  function usageRepo(extra = {}) {
    return makeRepo({
      'config/ai.yaml': AI_YAML,
      'items/EPIC-000001.md': itemWithAgent('EPIC-000001', {}, agent([runYaml('2026-09-01', 'Opus', 'model-b', { output_tokens: 1000000 })], 20)),
      'items/STORY-000001.md': itemWithAgent(
        'STORY-000001',
        { status: 'Done', parent: 'EPIC-000001', assignee: 'Opus', labels: ['ui', 'cli'] },
        agent([
          runYaml('2026-09-02', 'Opus', 'model-a', { output_tokens: 100000 }),
          runYaml('2026-09-10', 'Sonnet', 'model-b', { output_tokens: 2000000 }),
        ])
      ).replace('status: Backlog\n', ''),
      'items/STORY-000002.md': item('STORY-000002', { parent: 'EPIC-000001' }),
      'items/TASK-000001.md': itemWithAgent('TASK-000001', { parent: 'STORY-000001', assignee: 'Sonnet' }, agent([runYaml('2026-09-03', 'Opus', 'model-z', { output_tokens: 10 })])),
      'items/BUG-000001.md': itemWithAgent('BUG-000001', { labels: ['cli'] }, agent([runYaml('2026-09-05', 'Sonnet', 'model-b', { input_tokens: 1000000 })])),
      ...extra,
    });
  }
  const json = (r) => JSON.parse(r.out);
  const TOTAL_KEYS = ['items', 'runs', 'tokens', 'totalTokens', 'cost', 'knownCost', 'priced', 'unpricedRuns'];
  const TOKEN_KEYS = ['input', 'output', 'cache_read', 'cache_write', 'cache_write_1h'];
  const groupRows = (r) => json(r).groups.map((g) => [g.key, g.items, g.runs, g.cost, g.knownCost]);

  it('the fixture repository is valid apart from its budget and pricing warnings', () => {
    const { root } = usageRepo();
    const v = run(VALIDATE, [], root);
    assert.equal(v.code, 0, v.all);
    assert.match(v.out, /OK: 5 item\(s\), 0 error\(s\), 2 warning\(s\)/);
  });

  it('prints repository totals as text, unpriced with its known part, and lists over-budget items', () => {
    const { root } = usageRepo();
    const r = run(REPORT, [], root);
    assert.equal(r.code, 0, r.all);
    assert.equal(
      r.out,
      [
        'AI usage: 4 item(s) with runs, 5 run(s)',
        'Cost:    unpriced ($21.00 known, 1 unpriced run)',
        'Tokens:  in 1M · out 3.1M',
        'Over budget: STORY-000001',
        '',
      ].join('\n')
    );
    const by = run(REPORT, ['--by=status'], root);
    assert.equal(by.code, 0, by.all);
    assert.match(by.out, /\n\nstatus +items +runs +tokens +cost\nDone +1 +2 +2\.1M +\$15\.00\nBacklog +3 +3 +2M +\$6\.00\+ unpriced\n$/);
    assert.match(run(REPORT, ['--by=assignee'], root).out, /\n\(unassigned\) +2 +2 +2M +\$6\.00\n/);
  });

  it('--json has a stable shape with exact totals', () => {
    const { root, ws } = usageRepo();
    const r = run(REPORT, ['--json', ws], os.tmpdir());
    assert.equal(r.code, 0, r.all);
    const out = json(r);
    assert.deepEqual(Object.keys(out), ['scope', 'since', 'until', 'totals', 'by', 'groups', 'overBudget']);
    assert.deepEqual(Object.keys(out.totals), TOTAL_KEYS);
    assert.deepEqual(Object.keys(out.totals.tokens), TOKEN_KEYS);
    assert.deepEqual(out, {
      scope: 'repository',
      since: null,
      until: null,
      totals: {
        items: 4,
        runs: 5,
        tokens: { input: 1000000, output: 3100010, cache_read: 0, cache_write: 0, cache_write_1h: 0 },
        totalTokens: 4100010,
        cost: null,
        knownCost: 21,
        priced: false,
        unpricedRuns: 1,
      },
      by: null,
      groups: [],
      overBudget: ['STORY-000001'],
    });
  });

  it('--by groups by each dimension', () => {
    const { root } = usageRepo();
    const by = (dim) => run(REPORT, ['--json', `--by=${dim}`], root);
    const status = by('status');
    assert.equal(json(status).by, 'status');
    assert.deepEqual(Object.keys(json(status).groups[0]), ['key', ...TOTAL_KEYS]);
    assert.deepEqual(groupRows(status), [['Done', 1, 2, 15, 15], ['Backlog', 3, 3, null, 6]]);
    assert.deepEqual(groupRows(by('label')), [['cli', 2, 3, 16, 16], ['ui', 1, 2, 15, 15], ['', 2, 2, null, 5]]);
    assert.deepEqual(groupRows(by('epic')), [['EPIC-000001', 3, 4, null, 20], ['', 1, 1, 1, 1]]);
    assert.deepEqual(groupRows(by('model')), [['model-b', 3, 3, 16, 16], ['model-a', 1, 1, 5, 5], ['model-z', 1, 1, null, 0]]);
    assert.deepEqual(groupRows(by('assignee')), [['Opus', 1, 2, 15, 15], ['', 2, 2, 6, 6], ['Sonnet', 1, 1, null, 0]]);
    assert.deepEqual(groupRows(by('type')), [['STORY', 1, 2, 15, 15], ['EPIC', 1, 1, 5, 5], ['BUG', 1, 1, 1, 1], ['TASK', 1, 1, null, 0]]);
    const text = run(REPORT, ['--by=epic'], root);
    assert.match(text.out, /\nEPIC-000001 +3 +4 +3\.1M +\$20\.00\+ unpriced\n\(none\) +1 +1 +1M +\$1\.00\n$/);
  });

  it('--since / --until restrict the runs by date', () => {
    const { root } = usageRepo();
    const r = run(REPORT, ['--json', '--since=2026-09-05', '--by=model'], root);
    const out = json(r);
    assert.equal(out.since, '2026-09-05');
    assert.equal(out.totals.runs, 2);
    assert.equal(out.totals.cost, 11);
    assert.deepEqual(groupRows(r), [['model-b', 2, 2, 11, 11]]);
    assert.equal(json(run(REPORT, ['--json', '--until=2026-09-01'], root)).totals.cost, 5);
    assert.match(run(REPORT, ['--since=2026-09-05'], root).out, /^AI usage: 4 item\(s\) with runs, 2 run\(s\), runs dated 2026-09-05 to …\nCost: {4}\$11\.00/);
  });

  it('--strict exits 1 when any item is over budget, 0 otherwise', () => {
    const over = usageRepo();
    const r = run(REPORT, ['--strict'], over.root);
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /over budget {2}STORY-000001: spent \$15\.00 of \$10\.00/);
    const fine = makeRepo({ 'config/ai.yaml': AI_YAML, 'items/BUG-000001.md': itemWithAgent('BUG-000001', {}, agent([runYaml('2026-09-05', 'Sonnet', 'model-b', { input_tokens: 1000000 })])) });
    const ok = run(REPORT, ['--strict', '--json'], fine.root);
    assert.equal(ok.code, 0, ok.all);
    assert.deepEqual(json(ok).overBudget, []);
  });

  it('reports one item: spent, budget and remaining, with --json for a script and --strict for the gate', () => {
    const { root } = usageRepo();
    const bug = run(REPORT, ['BUG-000001'], root);
    assert.equal(bug.code, 0, bug.all);
    assert.equal(
      bug.out,
      [
        'BUG-000001 — BUG-000001 (Backlog)',
        '  spent      $1.00 (list-price equivalent)',
        '  budget     $5.00',
        '  remaining  $4.00',
        '  runs       1 (model-b)',
        '  tokens     in 1M',
        '',
      ].join('\n')
    );
    const story = run(REPORT, ['story-000001', '--json', '--strict'], root);
    assert.equal(story.code, 1, story.all);
    assert.match(story.err, /over budget {2}STORY-000001: spent \$15\.00 of \$10\.00/);
    assert.deepEqual(json(story), {
      scope: 'item',
      id: 'STORY-000001',
      title: 'STORY-000001',
      status: 'Done',
      assignee: 'Opus',
      runs: 2,
      tokens: { input: 0, output: 2100000, cache_read: 0, cache_write: 0, cache_write_1h: 0 },
      totalTokens: 2100000,
      spent: 15,
      budget: 10,
      remaining: -5,
      overBudget: true,
      priced: true,
      models: ['model-a', 'model-b'],
      handles: ['Opus', 'Sonnet'],
    });
    assert.match(run(REPORT, ['STORY-000001'], root).out, /\n {2}remaining {2}-\$5\.00 \(over budget\)\n/);
    assert.equal(run(REPORT, ['BUG-000001', '--strict'], root).code, 0);
  });

  it('reports an item without runs as nothing spent of its type default', () => {
    const { root, ws } = usageRepo();
    const r = run(REPORT, ['STORY-000002', ws, '--json'], os.tmpdir());
    assert.equal(r.code, 0, r.all);
    const out = json(r);
    assert.deepEqual(Object.keys(out), [
      'scope', 'id', 'title', 'status', 'assignee', 'runs', 'tokens', 'totalTokens', 'spent', 'budget', 'remaining',
      'overBudget', 'priced', 'models', 'handles',
    ]);
    assert.deepEqual([out.runs, out.spent, out.budget, out.remaining, out.overBudget, out.assignee], [0, 0, 10, 10, false, null]);
    assert.match(run(REPORT, ['STORY-000002'], root).out, /spent {6}\$0\.00 .*\n {2}budget {5}\$10\.00\n {2}remaining {2}\$10\.00\n {2}runs {7}0\n {2}tokens {5}none recorded\n$/);
  });

  it('reports an EPIC as the roll-up of its subtree against its own budget', () => {
    const priced = usageRepo({ 'items/TASK-000001.md': item('TASK-000001', { parent: 'STORY-000001' }) });
    const out = json(run(REPORT, ['EPIC-000001', '--json'], priced.root));
    assert.equal(out.scope, 'rollup');
    assert.deepEqual(Object.keys(out).slice(0, 7), ['scope', 'id', 'title', 'status', 'assignee', 'runs', 'members']);
    assert.deepEqual(
      [out.members, out.runs, out.spent, out.budget, out.remaining, out.overBudget, out.priced],
      [4, 3, 20, 20, 0, false, true]
    );
    assert.deepEqual([...out.models].sort(), ['model-a', 'model-b']);
    const unpriced = usageRepo();
    const text = run(REPORT, ['EPIC-000001'], unpriced.root);
    assert.equal(text.code, 0, text.all);
    assert.match(text.out, /^EPIC-000001 — EPIC-000001 \(Backlog\), roll-up\n {2}spent {6}unpriced .*\n {2}budget {5}\$20\.00\n {2}remaining {2}—\n {2}runs {7}4 /);
    assert.match(text.out, /\n {2}members {4}4 item\(s\) in the roll-up\n/);
  });

  it('refuses an unknown ID, and exits 2 on bad arguments or an unloadable repository', () => {
    const { root } = usageRepo();
    const unknown = run(REPORT, ['STORY-000099'], root);
    assert.equal(unknown.code, 1, unknown.all);
    assert.match(unknown.err, /refused {2}STORY-000099 was not found/);
    for (const args of [['--by=handle'], ['--by'], ['--since=yesterday'], ['STORY-000001', '--by=status'], ['STORY-000001', '--since=2026-09-01'], ['--bogus'], [root, root]]) {
      const r = run(REPORT, args, root);
      assert.equal(r.code, 2, `${args.join(' ')}\n${r.all}`);
    }
    assert.match(run(REPORT, ['--by=handle'], root).err, /--by must be one of status, assignee, model, type, label, epic/);
    assert.equal(run(REPORT, [path.join(os.tmpdir(), 'no-such-dir-xyz')], os.tmpdir()).code, 2);
    const broken = makeRepo({}, { board: 'name: T\nspec_version: 2.0\n' });
    assert.equal(run(REPORT, [], broken.root).code, 2);
  });
});
