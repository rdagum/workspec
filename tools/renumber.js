#!/usr/bin/env node
// tools/renumber.js
//
// Move one work item to a new ID: rename its file, patch its `id:` line
// surgically and rewrite every reference to it in the other items' parent,
// depends_on, blocks and related fields (and, with --body, whole-word mentions
// in Markdown bodies). Nothing else in any file changes, so the result is one
// focused, reviewable commit.
//
// This is the sanctioned exception to "never renumber" (SKILL.md): use it
// only on the side of a collision that has not reached main. IDs already on
// main are immutable; the branch adapts.
//
//   node tools/renumber.js OLD-ID NEW-ID [--body] [--dry-run] [--dir PATH]
//
// Exit codes: 0 done, 1 refused (unsafe request), 2 could not load.

'use strict';

const { resolveWorkspecDir, loadWorkspec, parseArgs } = require('./lib.js');

function usage() {
  return [
    'Usage: node tools/renumber.js OLD-ID NEW-ID [--body] [--dry-run] [--dir PATH]',
    '',
    '  --body      also rewrite whole-word mentions of OLD-ID in Markdown bodies',
    '  --dry-run   print what would change without writing anything',
    '  --dir PATH  a .workspec directory or a repository that contains one',
    '              (default: nearest .workspec at or above the current directory)',
    '',
    'Only items/ is touched; archived items and files outside .workspec are not rewritten.',
    'Policy: renumber only the side that has not been merged to main.',
  ].join('\n');
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv, ['body', 'dry-run', 'dir', 'help']);
  } catch (err) {
    console.error(`${err.message}\n\n${usage()}`);
    return 2;
  }
  if (args.options.help) {
    console.log(usage());
    return 0;
  }
  if (args._.length !== 2) {
    console.error(`Expected OLD-ID and NEW-ID.\n\n${usage()}`);
    return 2;
  }
  const [oldId, newId] = args._.map((s) => String(s).trim().toUpperCase());
  const body = !!args.options.body;
  const dryRun = !!args.options['dry-run'];

  let WS;
  let fs;
  let model;
  try {
    const dir = resolveWorkspecDir(typeof args.options.dir === 'string' ? args.options.dir : undefined);
    ({ WS, fs, model } = await loadWorkspec(dir));
  } catch (err) {
    console.error(`error  ${err.message}`);
    return 2;
  }

  let plan;
  try {
    plan = WS.renumberPlan(model, oldId, newId, { body });
  } catch (err) {
    console.error(`refused  ${err.message}`);
    return 1;
  }

  // Count body mentions the caller chose not to rewrite, so nothing goes stale silently.
  let bodyMentionsLeft = 0;
  if (!body) {
    const withBody = WS.renumberPlan(model, oldId, newId, { body: true });
    const changed = (p) => p.updates.reduce((n, u) => n + u.changed, 0);
    const selfBody = WS.rewriteReferences(plan.rename.text, oldId, newId, { body: true }).changed;
    bodyMentionsLeft = changed(withBody) - changed(plan) + selfBody;
  }

  const verb = dryRun ? 'would rename' : 'renamed';
  const verbUpd = dryRun ? 'would update' : 'updated';
  if (!dryRun) {
    // Write the new file and the reference updates first, delete the old file
    // last: if anything fails midway both files exist and the validator
    // reports the duplicate instead of an item vanishing.
    await fs.writeFile(plan.rename.to, plan.rename.text);
    for (const u of plan.updates) await fs.writeFile(u.path, u.text);
    await fs.deleteFile(plan.rename.from);
  }
  console.log(`${verb}  ${plan.rename.from} -> ${plan.rename.to}`);
  for (const u of plan.updates) console.log(`${verbUpd}  ${u.path} (${u.changed} line(s))`);
  if (bodyMentionsLeft) {
    console.log(`note     ${bodyMentionsLeft} body mention(s) of ${oldId} left as they are; rerun with --body to rewrite them.`);
  }
  if (!dryRun) {
    console.log(`Done. Review the diff, then commit the ${1 + plan.updates.length} changed file(s) together.`);
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(2);
  }
);
