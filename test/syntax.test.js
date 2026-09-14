// test/syntax.test.js — every script index.html loads must at least parse.
//
// The UI modules (ui/*.js, core/filesystem.js, app.js) touch the DOM or the
// File System Access API, so no other test evaluates them; a syntax error in
// one of them used to surface only as a blank board in the browser. Compiling
// each file with vm.Script (no execution) catches that in `node --test`. It is
// a parse check, not behavioural coverage — the gates skill still says the UI
// layer is verified by hand.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT } = require('./load.js');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);

describe('syntax: scripts loaded by index.html', () => {
  it('lists the app scripts in index.html', () => {
    assert.ok(scripts.length >= 10, `found ${scripts.length} scripts`);
    assert.ok(scripts.includes('app.js'));
    assert.ok(scripts.includes('ui/board.js'));
  });

  for (const rel of scripts) {
    it(`${rel} parses`, () => {
      const file = path.join(ROOT, rel);
      assert.ok(fs.existsSync(file), `${rel} is missing`);
      const src = fs.readFileSync(file, 'utf8');
      // Same wrapper test/load.js uses, so line numbers in a failure match the file.
      assert.doesNotThrow(() => new vm.Script(`(function (window) {${src}\n})`, { filename: file }));
    });
  }
});
