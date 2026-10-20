// tools/transcript.js
//
// Reads Claude Code session transcripts for tools/record-usage.js. The format
// is Claude Code's, not WorkSpec's, and may change, so every field name it
// relies on is in FIELDS below and anything unexpected in a row is a skip, never
// a crash. Node-only (it reads files); the browser never loads it.
//
// Layout (verified on a real transcript, README "Tracking AI usage"):
//   <projects>/<encoded cwd>/<session id>.jsonl                 the session
//   <projects>/<encoded cwd>/<session id>/subagents/agent-*.jsonl  its subagents
// One JSON object per line. An assistant row carries `message.id`,
// `message.model` and `message.usage`, plus `gitBranch` and `timestamp`. One
// API response is logged as several rows that repeat the same `message.id` and
// usage block, so usage is counted once per distinct `message.id` across the
// session and its subagents together; summing rows over-reports several-fold.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Every Claude Code field name this adapter reads, in one place. */
const FIELDS = {
  type: 'type', // row kind
  assistant: 'assistant', // the row kind that carries usage
  message: 'message',
  messageId: 'id', // message.id: one per API response
  model: 'model', // message.model
  usage: 'usage', // message.usage
  requestId: 'requestId', // row-level fallbacks for a usage row without message.id
  uuid: 'uuid',
  branch: 'gitBranch',
  timestamp: 'timestamp', // ISO 8601, UTC
  input: 'input_tokens',
  output: 'output_tokens',
  cacheRead: 'cache_read_input_tokens',
  cacheWrite: 'cache_creation_input_tokens', // 5-minute + 1-hour writes together
  cacheCreation: 'cache_creation', // the split, when present
  cacheWrite5m: 'ephemeral_5m_input_tokens',
  cacheWrite1h: 'ephemeral_1h_input_tokens',
  syntheticModel: '<synthetic>', // client-made rows; no real usage
  subagentsDir: 'subagents',
  subagentPrefix: 'agent-',
};

/** Token kinds in the order of a WorkSpec run (core/usage.js TOKEN_KINDS). */
const KINDS = ['input', 'output', 'cache_read', 'cache_write', 'cache_write_1h'];

const ITEM_BRANCH_RE = /^workspec\/([a-z]+-\d{6})(?:-|$)/i;

/** Where Claude Code keeps its per-project transcripts. */
function projectsDir() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

/** Claude Code's directory name for a project path: every non-alphanumeric character becomes '-'. */
function encodeProjectDir(absPath) {
  return String(absPath).replace(/[^A-Za-z0-9]/g, '-');
}

/** `<session>/subagents/agent-*.jsonl` next to a session file, sorted. */
function subagentFiles(sessionFile) {
  const session = path.basename(sessionFile, '.jsonl');
  const dir = path.join(path.dirname(sessionFile), session, FIELDS.subagentsDir);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.startsWith(FIELDS.subagentPrefix) && n.endsWith('.jsonl'))
    .sort()
    .map((n) => path.join(dir, n));
}

/**
 * Resolve `arg` — a path to a session `.jsonl` file, or a bare session ID — to
 * { session, file, files }, where `files` is the session file followed by its
 * subagent files (unless `subagents: false`). A session ID is looked up in
 * every project directory whose name starts with the repository's encoded
 * path, case-insensitively: Windows drive letters vary in case, and worktree
 * runs write to `<encoded repo>--claude-worktrees-<name>`. Throws when nothing
 * is found, saying where it looked.
 */
function locateSession(arg, repoRoot, { subagents = true } = {}) {
  const text = String(arg);
  let file = null;
  if (fs.existsSync(text) && fs.statSync(text).isFile()) {
    file = path.resolve(text);
  } else if (/[\\/]/.test(text) || text.toLowerCase().endsWith('.jsonl')) {
    throw new Error(`Transcript file ${text} not found.`);
  } else {
    const root = projectsDir();
    const prefix = encodeProjectDir(path.resolve(repoRoot)).toLowerCase();
    let dirs = [];
    try {
      dirs = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name.toLowerCase().startsWith(prefix))
        .map((d) => d.name)
        .sort();
    } catch {
      // No projects directory: reported below like an empty one.
    }
    for (const d of dirs) {
      const candidate = path.join(root, d, `${text}.jsonl`);
      if (fs.existsSync(candidate)) {
        file = candidate;
        break;
      }
    }
    if (!file) {
      throw new Error(
        `Session ${text} not found: searched ${dirs.length} project director${dirs.length === 1 ? 'y' : 'ies'} ` +
          `under ${root} whose name starts with ${encodeProjectDir(path.resolve(repoRoot))} (case-insensitive).`
      );
    }
  }
  const files = [file, ...(subagents ? subagentFiles(file) : [])];
  return { session: path.basename(file, '.jsonl'), file, files };
}

/** A non-negative finite count, else 0. */
function count(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * What one parsed transcript row contributes:
 *   null                 not a usage row (a user message, a summary, …)
 *   { skip: true }       an assistant row that cannot be counted: no usage,
 *                        no model, or the `<synthetic>` model
 *   { key, model, tokens: {kind: n}, branch, timestamp }
 * `key` is message.id, else requestId, else uuid, else null (counted alone).
 * Cache writes are split into 5-minute and 1-hour from `usage.cache_creation`;
 * without that split the whole write counts as 5-minute.
 */
function usageOf(row) {
  if (!isObject(row)) return { skip: true };
  const message = row[FIELDS.message];
  if (row[FIELDS.type] !== FIELDS.assistant) return null;
  if (!isObject(message) || !isObject(message[FIELDS.usage])) return { skip: true };
  const model = message[FIELDS.model];
  if (typeof model !== 'string' || model === '' || model === FIELDS.syntheticModel) return { skip: true };

  const u = message[FIELDS.usage];
  const write = count(u[FIELDS.cacheWrite]);
  const split = u[FIELDS.cacheCreation];
  let write5m = write;
  let write1h = 0;
  if (isObject(split)) {
    write1h = count(split[FIELDS.cacheWrite1h]);
    write5m = split[FIELDS.cacheWrite5m] != null ? count(split[FIELDS.cacheWrite5m]) : Math.max(0, write - write1h);
  }
  const key = [message[FIELDS.messageId], row[FIELDS.requestId], row[FIELDS.uuid]].find((v) => typeof v === 'string' && v !== '');
  return {
    key: key || null,
    model,
    tokens: {
      input: count(u[FIELDS.input]),
      output: count(u[FIELDS.output]),
      cache_read: count(u[FIELDS.cacheRead]),
      cache_write: write5m,
      cache_write_1h: write1h,
    },
    branch: typeof row[FIELDS.branch] === 'string' && row[FIELDS.branch] !== '' ? row[FIELDS.branch] : null,
    timestamp: typeof row[FIELDS.timestamp] === 'string' ? row[FIELDS.timestamp] : null,
  };
}

/** Rows of a .jsonl text: parsed objects, or `undefined` for a line that is not valid JSON. Blank lines are dropped. */
function parseJsonl(text) {
  return String(text)
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return undefined;
      }
    });
}

/** Local calendar date (YYYY-MM-DD) of an ISO timestamp, or null. */
function localDate(timestamp) {
  const d = new Date(timestamp);
  if (timestamp == null || Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Aggregate parsed rows (from parseJsonl, possibly several files) into usage
 * per model. `since` / `until` (YYYY-MM-DD, inclusive) compare the row's local
 * date, and with either set a row without a valid timestamp is excluded;
 * `branch` keeps only rows whose gitBranch is exactly that. Returns
 *   { models: [{ model, input, output, cache_read, cache_write, cache_write_1h }],
 *     rows, responses, skipped, trimmed, lastDate, branches, itemIds }
 * rows       usage rows that passed the checks (before de-duplication)
 * responses  distinct responses counted
 * skipped    invalid JSON lines and assistant rows without usable usage
 * trimmed    usage rows a filter excluded
 * Models whose tokens are all zero are dropped.
 */
function aggregateRows(rows, { since = null, until = null, branch = null } = {}) {
  const out = { rows: 0, responses: 0, skipped: 0, trimmed: 0, lastDate: null, branches: [], itemIds: [] };
  const responses = new Map();
  const branches = new Set();
  let latest = null;
  let anonymous = 0;

  for (const row of rows) {
    if (row === undefined) {
      out.skipped++;
      continue;
    }
    const entry = usageOf(row);
    if (entry === null) continue;
    if (entry.skip) {
      out.skipped++;
      continue;
    }
    if (since != null || until != null) {
      const date = localDate(entry.timestamp);
      if (date == null || (since != null && date < since) || (until != null && date > until)) {
        out.trimmed++;
        continue;
      }
    }
    if (branch != null && entry.branch !== branch) {
      out.trimmed++;
      continue;
    }
    out.rows++;
    if (entry.branch) branches.add(entry.branch);
    const time = entry.timestamp == null ? NaN : new Date(entry.timestamp).getTime();
    if (!Number.isNaN(time) && (latest == null || time > latest.time)) latest = { time, ts: entry.timestamp };

    // Repeated rows of one response carry the same usage; if they ever
    // differ (a streamed total growing), the largest value per kind wins.
    const key = entry.key != null ? `k:${entry.key}` : `n:${anonymous++}`;
    const seen = responses.get(key);
    if (!seen) responses.set(key, { model: entry.model, tokens: { ...entry.tokens } });
    else for (const kind of KINDS) seen.tokens[kind] = Math.max(seen.tokens[kind], entry.tokens[kind]);
  }

  const byModel = new Map();
  for (const { model, tokens } of responses.values()) {
    if (!byModel.has(model)) byModel.set(model, Object.fromEntries(KINDS.map((k) => [k, 0])));
    const sum = byModel.get(model);
    for (const kind of KINDS) sum[kind] += tokens[kind];
  }
  out.models = [...byModel.entries()]
    .filter(([, sum]) => KINDS.some((k) => sum[k] > 0))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([model, sum]) => ({ model, ...sum }));
  out.responses = responses.size;
  out.lastDate = latest ? localDate(latest.ts) : null;
  out.branches = [...branches].sort();
  out.itemIds = [
    ...new Set(out.branches.map((b) => b.match(ITEM_BRANCH_RE)).filter(Boolean).map((m) => m[1].toUpperCase())),
  ].sort();
  return out;
}

/** aggregateRows over the rows of every file, read as UTF-8. */
function aggregateTranscript(files, options = {}) {
  const rows = [];
  for (const file of files) rows.push(...parseJsonl(fs.readFileSync(file, 'utf8')));
  return aggregateRows(rows, options);
}

module.exports = {
  FIELDS,
  projectsDir,
  encodeProjectDir,
  subagentFiles,
  locateSession,
  usageOf,
  parseJsonl,
  localDate,
  aggregateRows,
  aggregateTranscript,
};
