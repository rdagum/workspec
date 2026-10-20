// test/transcript.test.js — tools/transcript.js: the Claude Code transcript
// adapter behind record-usage.js --from-transcript, called directly.
//
// The fixture corpus is test/fixtures/transcripts/ (synthetic; .jsonl cannot
// hold comments, so its expected totals are documented here). Session
// 11111111-1111-4111-8111-111111111111:
//
//   main file, model claude-sonnet-5-5
//     msg_A  3 rows, branch main, 2026-09-10; the third row's output grew to
//            120, so the largest value wins: in 10, out 120, read 1000, write 500
//     msg_B  2 rows, branch workspec/story-000007-sample-feature, 2026-09-11:
//            in 20, out 200, read 2000, write 5m 1000 + 1h 2000
//     msg_D  1 row, same branch, 2026-09-12, no cache_creation split:
//            in 5, out 50, write 400 (all 5-minute)
//     skipped: a <synthetic> row, an assistant row without usage, one line
//            that is not valid JSON; user and summary rows are not usage rows
//   subagents/agent-aaaa.jsonl, model claude-haiku-5-5, same branch, 2026-09-11
//     msg_H1 2 rows: in 1, out 10, read 100, write 50
//     msg_H2 1 row:  in 2, out 20, read 200
//
//   sonnet  in 35, out 370, read 3000, write 1900, write 1h 2000
//   haiku   in 3,  out 30,  read 300,  write 50,   write 1h 0
//   9 usage rows, 5 distinct responses, 3 skipped, last date 2026-09-12
//
// Timestamps are at 12:00 UTC so the local date is the same in the usual
// time zones; the date filters compare local dates.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const T = require('../tools/transcript.js');

const SESSION = '11111111-1111-4111-8111-111111111111';
const DIR = path.join(__dirname, 'fixtures', 'transcripts');
const MAIN = path.join(DIR, `${SESSION}.jsonl`);
const SUB = path.join(DIR, SESSION, 'subagents', 'agent-aaaa.jsonl');

const SONNET = { model: 'claude-sonnet-5-5', input: 35, output: 370, cache_read: 3000, cache_write: 1900, cache_write_1h: 2000 };
const HAIKU = { model: 'claude-haiku-5-5', input: 3, output: 30, cache_read: 300, cache_write: 50, cache_write_1h: 0 };

/** Run `fn` with CLAUDE_CONFIG_DIR pointing at a throwaway directory. */
function withConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspec-claude-'));
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
}

describe('transcript: paths', () => {
  it('encodes a project path the way Claude Code names its directory', () => {
    assert.equal(T.encodeProjectDir('C:\\Users\\rdagum\\Code\\workspec'), 'C--Users-rdagum-Code-workspec');
    assert.equal(
      T.encodeProjectDir('C:\\Users\\rdagum\\Code\\workspec\\.claude\\worktrees\\abc'),
      'C--Users-rdagum-Code-workspec--claude-worktrees-abc'
    );
    assert.equal(T.encodeProjectDir('/home/me/my_repo.git'), '-home-me-my-repo-git');
  });

  it('finds projects under CLAUDE_CONFIG_DIR, else ~/.claude', () => {
    withConfigDir((dir) => assert.equal(T.projectsDir(), path.join(dir, 'projects')));
  });

  it('locates a session by path, with its subagent files unless asked not to', () => {
    const s = T.locateSession(MAIN, os.tmpdir());
    assert.equal(s.session, SESSION);
    assert.deepEqual(s.files, [MAIN, SUB]);
    assert.deepEqual(T.locateSession(MAIN, os.tmpdir(), { subagents: false }).files, [MAIN]);
    assert.throws(() => T.locateSession(path.join(DIR, 'nope.jsonl'), os.tmpdir()), /Transcript file .*nope\.jsonl not found/);
  });

  it('locates a session ID in every project directory that starts with the repository path, case-insensitively', () => {
    withConfigDir((dir) => {
      const repo = path.join(os.tmpdir(), 'Some Repo');
      const enc = T.encodeProjectDir(path.resolve(repo));
      const other = path.join(dir, 'projects', 'unrelated');
      const worktree = path.join(dir, 'projects', `${enc.toLowerCase()}--claude-worktrees-x`);
      fs.mkdirSync(other, { recursive: true });
      fs.copyFileSync(MAIN, path.join(other, 'elsewhere.jsonl'));
      fs.mkdirSync(path.join(worktree, SESSION, 'subagents'), { recursive: true });
      fs.copyFileSync(MAIN, path.join(worktree, `${SESSION}.jsonl`));
      fs.copyFileSync(SUB, path.join(worktree, SESSION, 'subagents', 'agent-aaaa.jsonl'));
      const s = T.locateSession(SESSION, repo);
      assert.equal(s.file, path.join(worktree, `${SESSION}.jsonl`));
      assert.equal(s.files.length, 2);
      assert.throws(() => T.locateSession('elsewhere', repo), new RegExp(`Session elsewhere not found: searched 1 project directory .*${enc}`));
    });
  });
});

describe('transcript: rows', () => {
  it('reads usage, splitting cache writes into 5-minute and 1-hour', () => {
    const row = (usage, extra = {}) => ({ type: 'assistant', message: { id: 'm', model: 'x', usage }, ...extra });
    const split = T.usageOf(row({ cache_creation_input_tokens: 30, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 } }));
    assert.deepEqual(split.tokens, { input: 0, output: 0, cache_read: 0, cache_write: 10, cache_write_1h: 20 });
    assert.equal(T.usageOf(row({ cache_creation_input_tokens: 30 })).tokens.cache_write, 30);
    assert.equal(T.usageOf(row({ cache_creation_input_tokens: 30, cache_creation: { ephemeral_1h_input_tokens: 20 } })).tokens.cache_write, 10);
    assert.equal(T.usageOf(row({ input_tokens: -5, output_tokens: 'many' })).tokens.input, 0);
  });

  it('keys a response by message.id, else requestId, else uuid', () => {
    const u = { output_tokens: 1 };
    assert.equal(T.usageOf({ type: 'assistant', message: { id: 'm1', model: 'x', usage: u }, requestId: 'r1' }).key, 'm1');
    assert.equal(T.usageOf({ type: 'assistant', message: { model: 'x', usage: u }, requestId: 'r1', uuid: 'u1' }).key, 'r1');
    assert.equal(T.usageOf({ type: 'assistant', message: { model: 'x', usage: u }, uuid: 'u1' }).key, 'u1');
    assert.equal(T.usageOf({ type: 'assistant', message: { model: 'x', usage: u } }).key, null);
  });

  it('skips synthetic, model-less and usage-less assistant rows and ignores other rows', () => {
    assert.deepEqual(T.usageOf({ type: 'assistant', message: { model: '<synthetic>', usage: { output_tokens: 1 } } }), { skip: true });
    assert.deepEqual(T.usageOf({ type: 'assistant', message: { model: '', usage: { output_tokens: 1 } } }), { skip: true });
    assert.deepEqual(T.usageOf({ type: 'assistant', message: { model: 'x' } }), { skip: true });
    assert.deepEqual(T.usageOf({ type: 'assistant' }), { skip: true });
    assert.deepEqual(T.usageOf(42), { skip: true });
    assert.equal(T.usageOf({ type: 'user', message: { usage: { output_tokens: 1 } } }), null);
  });

  it('parses .jsonl with CRLF, a BOM and a broken line', () => {
    assert.deepEqual(T.parseJsonl('\uFEFF{"a":1}\r\n\r\n{oops\n[2]\n'), [{ a: 1 }, undefined, [2]]);
  });
});

describe('transcript: aggregateTranscript', () => {
  it('counts each response once across the session and its subagents', () => {
    const a = T.aggregateTranscript([MAIN, SUB]);
    assert.deepEqual(a.models, [HAIKU, SONNET]);
    assert.equal(a.rows, 9);
    assert.equal(a.responses, 5);
    assert.equal(a.skipped, 3);
    assert.equal(a.trimmed, 0);
    assert.equal(a.lastDate, '2026-09-12');
    assert.deepEqual(a.branches, ['main', 'workspec/story-000007-sample-feature']);
    assert.deepEqual(a.itemIds, ['STORY-000007']);
  });

  it('dedupes a response that repeats in a second file', () => {
    assert.deepEqual(T.aggregateTranscript([MAIN, MAIN]).models, [SONNET]);
  });

  it('restricts to one branch and counts what the filter trimmed', () => {
    const a = T.aggregateTranscript([MAIN, SUB], { branch: 'workspec/story-000007-sample-feature' });
    assert.deepEqual(a.models, [HAIKU, { ...SONNET, input: 25, output: 250, cache_read: 2000, cache_write: 1400 }]);
    assert.equal(a.trimmed, 3);
    assert.equal(a.rows, 6);
    assert.deepEqual(a.branches, ['workspec/story-000007-sample-feature']);
  });

  it('restricts to a local-date range', () => {
    const a = T.aggregateTranscript([MAIN, SUB], { since: '2026-09-11', until: '2026-09-11' });
    assert.deepEqual(a.models, [HAIKU, { ...SONNET, input: 20, output: 200, cache_read: 2000, cache_write: 1000 }]);
    assert.equal(a.trimmed, 4);
    assert.equal(a.lastDate, '2026-09-11');
    const none = T.aggregateTranscript([MAIN], { since: '2027-01-01' });
    assert.deepEqual(none.models, []);
    assert.equal(none.lastDate, null);
    assert.deepEqual(none.itemIds, []);
  });

  it('excludes rows without a timestamp only when a date filter is set, and drops all-zero models', () => {
    const rows = [
      { type: 'assistant', message: { id: 'a', model: 'm', usage: { output_tokens: 5 } } },
      { type: 'assistant', message: { id: 'b', model: 'zero', usage: { output_tokens: 0 } }, timestamp: '2026-09-11T12:00:00Z' },
    ];
    assert.deepEqual(T.aggregateRows(rows).models.map((m) => m.model), ['m']);
    const dated = T.aggregateRows(rows, { since: '2026-09-01' });
    assert.deepEqual(dated.models, []);
    assert.equal(dated.trimmed, 1);
    assert.equal(dated.responses, 1);
  });

  it('derives item IDs only from workspec/<id> branches', () => {
    const row = (gitBranch, id) => ({ type: 'assistant', message: { id, model: 'm', usage: { output_tokens: 1 } }, gitBranch });
    const a = T.aggregateRows([
      row('workspec/bug-000003', '1'),
      row('workspec/story-001002-usage-cli-tools', '2'),
      row('workspec/story-1002', '3'),
      row('feature/STORY-000004-x', '4'),
    ]);
    assert.deepEqual(a.itemIds, ['BUG-000003', 'STORY-001002']);
  });
});
