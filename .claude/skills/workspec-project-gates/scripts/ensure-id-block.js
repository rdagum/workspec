#!/usr/bin/env node
// Point this working copy at the ID block its agent owns.
//
// A worktree is a fresh checkout, so the gitignored config/user.local.yaml is
// absent and allocateId() throws "no-block". The committed registry
// config/id-blocks.yaml is present, though, and names one block per agent, so
// the block can be derived from the item's assignee and written locally.
//
//   node .claude/skills/workspec-project-gates/scripts/ensure-id-block.js <handle>
//
// Prints the block number on success. Exits 1 when the handle owns no block —
// never invents one, because a colliding ID is far more expensive to unpick.
// Uses the app's own YAML parser via test/load.js, which its header sanctions
// for command-line reuse, so flow mappings parse exactly as the board sees them.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const handle = process.argv[2];
if (!handle) {
  console.error('usage: ensure-id-block.js <handle>');
  process.exit(2);
}

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const { loadWS } = require(path.join(root, 'test', 'load.js'));
const { parseYaml } = loadWS(['utils/yaml.js']);

const registryPath = path.join(root, '.workspec', 'config', 'id-blocks.yaml');
if (!fs.existsSync(registryPath)) {
  console.error(`No ${registryPath}: this repository does not allocate in blocks.`);
  process.exit(1);
}

const registry = parseYaml(fs.readFileSync(registryPath, 'utf8'));
const blocks = (registry && registry.blocks) || [];
const wanted = String(handle).toLowerCase();
const entry = blocks.find((b) => b && String(b.owner || '').toLowerCase() === wanted);

if (!entry) {
  const owners = blocks.map((b) => b.owner).join(', ') || '(none)';
  console.error(`No ID block is claimed by "${handle}" in .workspec/config/id-blocks.yaml.`);
  console.error(`Claimed by: ${owners}`);
  console.error('Do not invent a block or an ID. Describe the item in the pull request instead.');
  process.exit(1);
}

// Only ever write inside a linked worktree. In the main checkout this file is
// the user's own identity and board settings; overwriting it would silently
// discard them. A linked worktree has .git as a file, not a directory.
const dotGit = path.join(root, '.git');
if (fs.existsSync(dotGit) && fs.statSync(dotGit).isDirectory()) {
  console.error('Refusing to write config/user.local.yaml in the main checkout:');
  console.error('that file holds your own identity and settings. Run this from a worktree.');
  console.error(`("${handle}" owns block ${entry.block}.)`);
  process.exit(1);
}

const localPath = path.join(root, '.workspec', 'config', 'user.local.yaml');
fs.writeFileSync(
  localPath,
  `# Written per run by the daily-workspec routine; gitignored, never committed.\n` +
    `handle: ${handle}\n` +
    `id_block: ${entry.block}\n`,
  'utf8',
);

console.log(String(entry.block));
