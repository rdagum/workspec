#!/usr/bin/env node
// tools/record-usage.js
//
// Append AI-usage runs to a work item (SPEC.md §18.2, README "Tracking AI
// usage"): one run typed in by hand, or one run per model imported from a
// Claude Code session transcript and its subagents (tools/transcript.js).
//
// The append is the line-level edit of core/usage.js appendRunText, so every
// other line of the file stays byte-identical, line endings and a BOM are
// kept, and `updated` is never touched: a run is a fact, not an edit. Only
// when that edit is impossible (agent/runs in flow style, say) is the front
// matter re-serialized, and the tool says so on stderr. A run whose source,
// session and model are already on the item is refused, so importing the same
// session twice cannot double-count it.
//
//   node tools/record-usage.js ID --handle=H --model=M [--input=N] [--output=N]
//        [--cache-read=N] [--cache-write=N] [--cache-write-1h=N] [--cost=USD]
//        [--purpose=P] [--ref=R] [--session=S] [--date=YYYY-MM-DD]
//        [--source=S] [--estimated] [--dry-run] [--force] [--dir=PATH]
//   node tools/record-usage.js [ID] --from-transcript=PATH|SESSION_ID
//        [--no-subagents] [--since=DATE] [--until=DATE] [--branch=NAME]
//        [--item-from-branch] [--handle=H] [--date=DATE] [--purpose=P]
//        [--ref=R] [--estimated] [--dry-run] [--force] [--dir=PATH]
//
// Exit codes: 0 recorded, 1 refused (unknown ID, duplicate run, no usage,
// ambiguous item), 2 usage error or could not load.

'use strict';

const path = require('node:path');
const { resolveWorkspecDir, loadWorkspec, parseArgs } = require('./lib.js');
const transcript = require('./transcript.js');

const VALUE_OPTIONS = [
  'handle', 'model', 'input', 'output', 'cache-read', 'cache-write', 'cache-write-1h', 'cost', 'purpose', 'ref',
  'session', 'date', 'source', 'from-transcript', 'since', 'until', 'branch', 'dir',
];
const FLAG_OPTIONS = ['estimated', 'dry-run', 'force', 'no-subagents', 'item-from-branch', 'help'];

/** Token options and the run field each writes, in run key order. */
const TOKEN_OPTIONS = [
  ['input', 'input_tokens'],
  ['output', 'output_tokens'],
  ['cache-read', 'cache_read_tokens'],
  ['cache-write', 'cache_write_tokens'],
  ['cache-write-1h', 'cache_write_1h_tokens'],
];

/** Options that describe the run's numbers, which a transcript supplies itself. */
const MANUAL_ONLY = ['model', 'input', 'output', 'cache-read', 'cache-write', 'cache-write-1h', 'cost', 'session', 'source'];
const TRANSCRIPT_ONLY = ['no-subagents', 'since', 'until', 'branch', 'item-from-branch'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'];

function usage() {
  return [
    'Usage: node tools/record-usage.js ID --handle=H --model=M [token and run options]',
    '       node tools/record-usage.js [ID] --from-transcript=PATH|SESSION_ID [transcript options]',
    '',
    'Run options (by hand):',
    '  --handle=H            who ran it (a config/users.yaml handle)       required',
    '  --model=M             the model ID, e.g. claude-sonnet-5-5           required',
    '  --input=N --output=N --cache-read=N --cache-write=N --cache-write-1h=N',
    '                        token counts; only the ones given are written',
    '  --cost=USD            cost as reported by the tool (cost_usd)',
    '  --session=S --source=S (default manual) --purpose=P --ref=R',
    '  --date=YYYY-MM-DD     default: today (local time)',
    '  --estimated           mark the numbers as approximate',
    '',
    'From a Claude Code transcript (one run per model, source claude-code):',
    '  --from-transcript=X   a session .jsonl file, or a session ID looked up under',
    '                        $CLAUDE_CONFIG_DIR or ~/.claude, under projects/, for this repository',
    '  --no-subagents        leave out <session>/subagents/agent-*.jsonl',
    '  --since=DATE --until=DATE --branch=NAME',
    '                        keep only those rows; trimming any marks the runs estimated',
    '  --item-from-branch    take ID from a workspec/<id>-... branch in the rows',
    '  --handle=H            override the handle derived from each model',
    '  --date, --purpose, --ref, --estimated as above',
    '',
    'Both:',
    '  --dry-run             print the lines that would be inserted; write nothing',
    '  --force               record even if source, session and model are already on the item',
    '  --dir=PATH            a .workspec directory or a repository that contains one',
    '                        (default: nearest .workspec at or above the current directory)',
    '',
    'Exit codes: 0 recorded, 1 refused, 2 usage error or could not load.',
  ].join('\n');
}

/** Today's local date as YYYY-MM-DD. */
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

class UsageError extends Error {}
class Refusal extends Error {}

/** Check option values; throws UsageError. Returns the options with flags as booleans. */
function checkOptions(o) {
  for (const name of VALUE_OPTIONS) {
    if (o[name] === undefined) continue;
    if (typeof o[name] !== 'string' || o[name] === '') throw new UsageError(`--${name} needs a value (--${name}=VALUE).`);
  }
  for (const name of FLAG_OPTIONS) {
    if (typeof o[name] === 'string') throw new UsageError(`--${name} takes no value.`);
  }
  for (const [name] of TOKEN_OPTIONS) {
    if (o[name] !== undefined && !/^\d+$/.test(o[name])) throw new UsageError(`--${name} must be a non-negative integer, got "${o[name]}".`);
  }
  if (o.cost !== undefined && !/^\d+(\.\d+)?$/.test(o.cost)) throw new UsageError(`--cost must be a non-negative amount, got "${o.cost}".`);
  for (const name of ['date', 'since', 'until']) {
    if (o[name] !== undefined && !DATE_RE.test(o[name])) throw new UsageError(`--${name} must be a YYYY-MM-DD date, got "${o[name]}".`);
  }
  if (o['from-transcript'] !== undefined) {
    const clash = MANUAL_ONLY.filter((n) => o[n] !== undefined);
    if (clash.length) {
      throw new UsageError(`${clash.map((n) => `--${n}`).join(', ')} cannot be combined with --from-transcript, which supplies them.`);
    }
  } else {
    const stray = TRANSCRIPT_ONLY.filter((n) => o[n] !== undefined);
    if (stray.length) throw new UsageError(`${stray.map((n) => `--${n}`).join(', ')} only applies with --from-transcript.`);
    if (o.handle === undefined || o.model === undefined) throw new UsageError('--handle and --model are required (or use --from-transcript).');
  }
}

/** The optional trailing run keys shared by both modes, in run key order. */
function trailing(run, o) {
  if (o.purpose !== undefined) run.purpose = o.purpose;
  if (o.ref !== undefined) run.ref = o.ref;
  return run;
}

/** The one run typed in by hand. */
function manualRun(o) {
  const run = { date: o.date || today(), handle: o.handle, model: o.model };
  for (const [name, field] of TOKEN_OPTIONS) if (o[name] !== undefined) run[field] = Number(o[name]);
  // An integer goes in as a number (a string "2" would be written quoted); a
  // decimal goes in exactly as typed, which the YAML reader keeps as written.
  if (o.cost !== undefined) run.cost_usd = o.cost.includes('.') ? o.cost : Number(o.cost);
  trailing(run, o);
  if (o.session !== undefined) run.session = o.session;
  run.source = o.source || 'manual';
  if (o.estimated) run.estimated = true;
  return run;
}

/**
 * Handle for a run on `modelId`: the users.yaml entry whose `model` is it,
 * else an entry whose handle appears in the model ID, else the capitalised
 * model family (Fable, Opus, Sonnet, Haiku), else null.
 */
function handleFor(modelId, users) {
  const id = String(modelId).toLowerCase();
  const byModel = users.find((u) => u.model != null && String(u.model) === String(modelId));
  if (byModel) return byModel.handle;
  const byName = users.find((u) => u.handle && id.includes(String(u.handle).toLowerCase()));
  if (byName) return byName.handle;
  const family = FAMILIES.find((f) => id.includes(f));
  return family ? family[0].toUpperCase() + family.slice(1) : null;
}

/** One run per model from a transcript aggregate. */
function transcriptRuns(agg, session, o, users) {
  const estimated = !!o.estimated || agg.trimmed > 0;
  return agg.models.map((m) => {
    const handle = o.handle || handleFor(m.model, users);
    if (!handle) throw new Refusal(`No handle for model ${m.model}: no users.yaml entry matches it; pass --handle=H.`);
    const run = {
      date: o.date || agg.lastDate || today(),
      handle,
      model: m.model,
      input_tokens: m.input,
      output_tokens: m.output,
      cache_read_tokens: m.cache_read,
      cache_write_tokens: m.cache_write,
    };
    if (m.cache_write_1h > 0) run.cache_write_1h_tokens = m.cache_write_1h;
    trailing(run, o);
    run.session = session;
    run.source = 'claude-code';
    if (estimated) run.estimated = true;
    return run;
  });
}

/** The item ID a transcript names through its workspec/<id> branches, checked against an explicit one. */
function itemFromBranch(agg, explicit) {
  const ids = agg.itemIds;
  if (ids.length > 1) {
    throw new Refusal(`The transcript rows name several items (${ids.join(', ')}); restrict them with --branch=NAME.`);
  }
  if (!ids.length) {
    if (explicit) return explicit;
    const seen = agg.branches.length ? agg.branches.join(', ') : 'none';
    throw new Refusal(`No workspec/<id>-... branch in the transcript rows (branches: ${seen}); pass the ID or --branch=NAME.`);
  }
  if (explicit && explicit !== ids[0]) {
    throw new Refusal(`The transcript's branch names ${ids[0]}, not ${explicit}; drop one of them or pass --branch=NAME.`);
  }
  return ids[0];
}

const sessionKey = (run) => [run.source, run.session, run.model].map((v) => (v == null ? '' : String(v))).join('\u0000');

/**
 * The new text with every run appended: appendRunText run by run, or, when
 * the line edit is impossible, the front matter re-serialized with the runs
 * added (body, BOM and line endings kept). Returns { text, reserialized }.
 */
function appendAll(WS, record, text, runs) {
  let out = text;
  for (const run of runs) {
    out = WS.appendRunText(out, run);
    if (out == null) break;
  }
  if (out != null) return { text: out, reserialized: false };

  const isMapping = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const blank = (v) => v == null || v === '';
  const meta = record.meta;
  if (record.lossy) {
    throw new Refusal(
      `${record.path}: the line-level append is not possible and the front matter cannot be re-serialized without loss; add the run by hand.`
    );
  }
  if (!blank(meta.agent) && !isMapping(meta.agent)) {
    throw new Refusal(`${record.path}: agent holds a value that is not a mapping; fix it (SPEC.md §18.2) before recording runs.`);
  }
  if (isMapping(meta.agent) && !blank(meta.agent.runs) && !Array.isArray(meta.agent.runs)) {
    throw new Refusal(`${record.path}: agent.runs holds a value that is not a list; fix it (SPEC.md §18.2) before recording runs.`);
  }
  // Spreads keep key order, and reassigning an existing key keeps its place.
  const copy = { ...meta };
  const agent = isMapping(copy.agent) ? { ...copy.agent } : {};
  agent.runs = [...(Array.isArray(agent.runs) ? agent.runs : []), ...runs];
  copy.agent = agent;
  return { text: WS.replaceFrontMatter(text, WS.stringifyYaml(copy), record.body), reserialized: true };
}

/** The lines of `after` that are not in `before` (common prefix and suffix removed), CR stripped. */
function insertedLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return b.slice(start, endB).map((l) => l.replace(/\r$/, ''));
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv, [...VALUE_OPTIONS, ...FLAG_OPTIONS]);
  } catch (err) {
    console.error(`${err.message}\n\n${usage()}`);
    return 2;
  }
  const o = args.options;
  if (o.help) {
    console.log(usage());
    return 0;
  }
  try {
    checkOptions(o);
    if (args._.length > 1) throw new UsageError('Expected at most one ID.');
    if (!args._.length && !o['item-from-branch']) throw new UsageError('Expected an ID (or --item-from-branch with --from-transcript).');
  } catch (err) {
    console.error(`${err.message}\n\n${usage()}`);
    return 2;
  }
  let id = args._.length ? String(args._[0]).trim().toUpperCase() : null;
  const dryRun = !!o['dry-run'];

  let WS;
  let fs;
  let model;
  let workspecDir;
  try {
    workspecDir = resolveWorkspecDir(o.dir);
    ({ WS, fs, model } = await loadWorkspec(workspecDir));
  } catch (err) {
    console.error(`error  ${err.message}`);
    return 2;
  }

  try {
    let runs;
    if (o['from-transcript'] !== undefined) {
      let found;
      let agg;
      try {
        found = transcript.locateSession(o['from-transcript'], path.dirname(workspecDir), { subagents: !o['no-subagents'] });
        agg = transcript.aggregateTranscript(found.files, { since: o.since, until: o.until, branch: o.branch });
      } catch (err) {
        console.error(`error  ${err.message}`);
        return 2;
      }
      const subs = found.files.length - 1;
      console.log(
        `read  ${found.file}${subs ? ` (+${subs} subagent file(s))` : ''}: ${agg.rows} usage row(s), ` +
          `${agg.responses} distinct response(s), ${agg.skipped} skipped, ${agg.trimmed} trimmed by filter`
      );
      if (!agg.models.length) throw new Refusal(`No usage found in session ${found.session}${agg.trimmed ? ' after the filters' : ''}.`);
      if (o['item-from-branch']) id = itemFromBranch(agg, id);
      runs = transcriptRuns(agg, found.session, o, model.users || []);
    } else {
      runs = [manualRun(o)];
    }

    const matches = [...model.items.values()].filter((r) => r.meta && r.meta.id != null && String(r.meta.id) === id);
    if (!matches.length) throw new Refusal(`${id} was not found`);
    if (matches.length > 1) throw new Refusal(`${id} is declared by several files (${matches.map((r) => r.path).join(', ')}); resolve that first.`);
    const record = matches[0];

    // Idempotent import: the same source, session and model never go in twice.
    if (!o.force) {
      const seen = new Set((WS.runsOf(record.meta) || []).filter((r) => r.session != null && r.session !== '').map(sessionKey));
      for (const run of runs) {
        if (run.session == null) continue;
        const key = sessionKey(run);
        if (seen.has(key)) {
          throw new Refusal(
            `${id} already has a run with source ${run.source}, session ${run.session} and model ${run.model}; nothing was written (pass --force to record it again).`
          );
        }
        seen.add(key);
      }
    }

    const before = await fs.readFile(record.path);
    const { text, reserialized } = appendAll(WS, record, before, runs);
    if (reserialized) {
      console.error(
        `note  ${record.path}: agent or agent.runs is written in a form the line-level append cannot extend ` +
          '(flow style, or a sequence at its key\'s indent), so the whole front matter was re-serialized; review the diff.'
      );
    }
    if (!dryRun) await fs.writeFile(record.path, text);
    const n = `${runs.length} run${runs.length === 1 ? '' : 's'}`;
    console.log(`${dryRun ? 'would append' : 'recorded'}  ${record.path} (${n})`);
    for (const line of insertedLines(before, text)) console.log(line);
    return 0;
  } catch (err) {
    if (err instanceof Refusal) {
      console.error(`refused  ${err.message}`);
      return 1;
    }
    throw err;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(2);
  }
);
