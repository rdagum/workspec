#!/usr/bin/env node
// tools/validate-workspec.js
//
// Validate a .workspec repository from the command line with zero
// dependencies, using the board's own loader and checks (core/model.js,
// core/allocation.js). Prints one line per problem and exits non-zero when
// there are errors, so it can run as a pre-commit hook and in CI on the
// pull-request merge result (README: "Validating in Git hooks and CI").
//
//   node tools/validate-workspec.js [PATH] [--strict] [--quiet]
//
//   PATH      a .workspec directory, or a repository that contains one.
//             Defaults to the nearest .workspec at or above the current directory.
//   --strict  treat warnings as errors
//   --quiet   print problems only, no summary line
//
// Exit codes: 0 clean, 1 problems found, 2 could not load the repository.

'use strict';

const { resolveWorkspecDir, loadWorkspec, collectProblems, parseArgs } = require('./lib.js');

function usage() {
  return [
    'Usage: node tools/validate-workspec.js [PATH] [--strict] [--quiet]',
    '',
    '  PATH      a .workspec directory or a repository that contains one',
    '            (default: nearest .workspec at or above the current directory)',
    '  --strict  treat warnings as errors',
    '  --quiet   print problems only, no summary',
    '',
    'Exit codes: 0 clean, 1 problems found, 2 could not load.',
  ].join('\n');
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv, ['strict', 'quiet', 'help']);
  } catch (err) {
    console.error(`${err.message}\n\n${usage()}`);
    return 2;
  }
  if (args.options.help) {
    console.log(usage());
    return 0;
  }
  if (args._.length > 1) {
    console.error(`Expected at most one PATH argument.\n\n${usage()}`);
    return 2;
  }

  let dir;
  let model;
  try {
    dir = resolveWorkspecDir(args._[0]);
    ({ model } = await loadWorkspec(dir));
  } catch (err) {
    console.error(`error  ${err.message}`);
    return 2;
  }

  const problems = collectProblems(model);
  for (const p of problems) {
    const where = p.file ? `${p.file}: ` : '';
    const line = `${p.level === 'error' ? 'error  ' : 'warning'}  ${where}${p.message}`;
    if (p.level === 'error') console.error(line);
    else console.log(line);
  }

  const errors = problems.filter((p) => p.level === 'error').length;
  const warnings = problems.length - errors;
  const failed = errors > 0 || (args.options.strict && warnings > 0);
  if (!args.options.quiet) {
    const summary = `${model.items.size} item(s), ${errors} error(s), ${warnings} warning(s) in ${dir}`;
    if (failed) console.error(`FAILED: ${summary}`);
    else console.log(`OK: ${summary}`);
  }
  return failed ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(2);
  }
);
