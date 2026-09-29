// test/theme.test.js — style.css palettes: the accessible themes (dark-aa,
// light-aa) meet WCAG 2.2 AA contrast, and the colours the component rules
// read through a variable keep the standard themes rendering as before.
//
// The stylesheet is read as text, not evaluated in a browser: each theme's
// palette is :root, then the plain `body` rule, then its own
// body[data-theme="…"] block, with var() references resolved against the
// result. That mirrors the cascade for custom properties set on body.

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./load.js');

const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function block(selector) {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return null;
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  const vars = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

// A custom property's var() is resolved on the element that declares it and
// inherited as that value, so :root's are resolved against :root alone and
// body's (the plain rule plus the theme block) against body's own set.
function resolveAll(vars) {
  const resolve = (v, depth = 0) => {
    const m = /^var\(--([\w-]+)\)$/.exec(v);
    return m && depth < 8 ? resolve(vars[m[1]], depth + 1) : v;
  };
  const out = {};
  for (const k of Object.keys(vars)) out[k] = resolve(vars[k]);
  return out;
}

function palette(theme) {
  const root = resolveAll(block(':root'));
  const onBody = { ...block('body') };
  if (theme !== 'dark') Object.assign(onBody, block(`body[data-theme="${theme}"]`));
  return resolveAll({ ...root, ...onBody });
}

function luminance(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const SURFACES = ['bg', 'bg-2', 'bg-3', 'panel'];
const TEXT = ['text', 'text-dim', 'text-faint', 'accent', 'danger', 'warn', 'ok'];
// [foreground, background] pairs painted as a label on a fill.
const LABELS = [
  ['on-accent', 'accent-2'],
  ['on-accent', 'accent-hover'],
  ['on-danger', 'danger'],
  ['on-danger', 'danger-hover'],
  ['on-type', 'epic'],
  ['on-type', 'story'],
  ['on-type', 'task'],
  ['on-type', 'bug'],
  ['on-type', 'spike'],
  ['on-type', 'type-other'],
  ['text', 'invalid-ground'],
  ['warn', 'banner-ground'],
];

describe('theme: the themes app.js offers', () => {
  const list = /const THEMES = \[([^\]]+)\]/.exec(appSrc);
  const themes = list ? [...list[1].matchAll(/'([\w-]+)'/g)].map((m) => m[1]) : [];

  it('app.js lists dark, light and both accessible themes', () => {
    assert.deepEqual(themes, ['dark', 'light', 'dark-aa', 'light-aa']);
  });

  for (const theme of themes.filter((t) => t !== 'dark')) {
    it(`style.css has a body[data-theme="${theme}"] palette`, () => {
      assert.ok(block(`body[data-theme="${theme}"]`), `no block for ${theme}`);
    });
  }
});

describe('theme: standard themes keep their original colours', () => {
  const ORIGINAL = {
    dark: { 'on-accent': '#fff', 'accent-hover': '#5b8cff', 'on-danger': '#2a0d0d', 'danger-hover': '#ff8585',
      'on-type': '#0f1117', 'type-other': '#9aa3b2', 'invalid-ground': '#2a1414', 'banner-ground': '#3a2410' },
    light: { 'on-accent': '#fff', 'accent-hover': '#3f6fe0', 'on-danger': '#2a0d0d', 'danger-hover': '#ff8585',
      'on-type': '#0f1117', 'type-other': '#4f586b', 'invalid-ground': '#2a1414', 'banner-ground': '#3a2410' },
  };
  for (const [theme, expected] of Object.entries(ORIGINAL)) {
    it(`${theme}: the extracted colour variables equal the literals they replaced`, () => {
      const p = palette(theme);
      for (const [k, v] of Object.entries(expected)) assert.equal(p[k], v, `${theme} --${k}`);
    });
  }
});

describe('theme: accessible themes meet WCAG AA', () => {
  for (const theme of ['dark-aa', 'light-aa']) {
    const p = palette(theme);
    const fails = [];
    const check = (fg, bg, min) => {
      assert.ok(p[fg] && p[bg], `${theme}: --${fg} or --${bg} is not defined`);
      const r = contrast(p[fg], p[bg]);
      if (r < min) fails.push(`--${fg} on --${bg} ${r.toFixed(2)}:1 < ${min}:1`);
    };

    it(`${theme}: text colours reach 4.5:1 on every surface`, () => {
      for (const s of SURFACES) for (const t of TEXT) check(t, s, 4.5);
      assert.deepEqual(fails.splice(0), []);
    });

    it(`${theme}: labels reach 4.5:1 on their fills`, () => {
      for (const [fg, bg] of LABELS) check(fg, bg, 4.5);
      assert.deepEqual(fails.splice(0), []);
    });

    it(`${theme}: control borders and the focus ring reach 3:1`, () => {
      for (const s of SURFACES) {
        check('border-2', s, 3);
        check('accent', s, 3);
      }
      assert.deepEqual(fails.splice(0), []);
    });
  }
});
