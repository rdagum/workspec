// test/load.js
//
// Loads the browser modules into Node without touching their source.
//
// Every app module is a classic script of the form
//   (function (WS) { ... })(window.WS = window.WS || {});
// so all Node needs is a `window` object to hand in. Each file is wrapped in
// `(function (window) { ... })` and evaluated through `vm` so stack traces keep
// the real file name and line numbers. The browser code path stays
// byte-identical; there is no build step and no dependency beyond Node itself.
//
// Usage:
//   const { loadWS } = require('./load.js');
//   const WS = loadWS();                       // yaml, ids, parser, model
//   const { parseYaml } = loadWS(['utils/yaml.js']);
//
// The same loader is meant to be reused by command-line tools (for example a
// future tools/validate-workspec.js), so keep it small and dependency-free.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** Repository root (the directory that holds index.html). */
const ROOT = path.resolve(__dirname, '..');

/**
 * Modules that have no DOM or File System Access API dependency, in the same
 * dependency order index.html uses. Anything that touches `document` stays out.
 */
const PURE_MODULES = ['utils/yaml.js', 'utils/ids.js', 'core/parser.js', 'core/allocation.js', 'core/model.js'];

/**
 * Evaluate the given modules (paths relative to the repository root, in
 * dependency order) against a fresh `window` and return the populated `WS`
 * namespace. Each call builds an independent namespace.
 */
function loadWS(modules = PURE_MODULES) {
  const window = { WS: {} };
  for (const rel of modules) {
    const file = path.join(ROOT, rel);
    const src = fs.readFileSync(file, 'utf8');
    // The wrapper shares line 1 with the source so reported line numbers match the file.
    const script = new vm.Script(`(function (window) {${src}\n})`, { filename: file });
    script.runInThisContext()(window);
  }
  return window.WS;
}

module.exports = { ROOT, PURE_MODULES, loadWS };
