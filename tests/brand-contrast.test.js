'use strict';
// Contrast has now regressed twice, and both times it was invisible: the page
// looked fine, and the failure was only findable by computing ratios. Worse,
// the first check I wrote tested the token pairs I ASSUMED were used together
// and so missed the real defects -- steel on the light hero at 2.39:1 and on
// the white form card at 3.01:1 -- because nobody had checked which ground
// each token actually lands on.
//
// So this locks two things: the Brand Book values, which must never drift, and
// the ratio of every token against every ground it is actually used on.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, '..', 'website', 'index.html');
const html = fs.readFileSync(PAGE, 'utf8');
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';

const tokens = {};
for (const m of (css.match(/:root\s*\{[\s\S]*?\}/) || [''])[0]
  .matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)) tokens[m[1]] = m[2];

const channel = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const luminance = (h) => {
  const [r, g, b] = hex(h);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('Brand Book colours have not drifted', () => {
  // Straight from the brand book. A derived accessible variant is the correct
  // way to fix a contrast failure on one of these -- editing the value is not.
  assert.deepStrictEqual(
    {
      navy: tokens.navy, gold: tokens.gold, steel: tokens.steel,
      sand: tokens.sand, surface: tokens.surface, white: tokens.white,
    },
    {
      navy: '#0C3054', gold: '#F2A91E', steel: '#8796A9',
      sand: '#E7E5DF', surface: '#F4F7FA', white: '#FFFFFF',
    });
});

// [token, ground, floor, what]. Grounds are literal because some of them are
// literals in the CSS (the inset panel) rather than tokens.
const PAIRS = [
  ['ink', '#FFFFFF', 4.5, 'body text on white'],
  ['ink', '#F4F7FA', 4.5, 'body text on Surface'],
  ['ink-soft', '#F4F7FA', 4.5, 'secondary text on Surface'],
  ['ink-mute', '#EAF0F7', 4.5, 'muted text on the inset light panel'],
  ['ink-mute', '#F4F7FA', 4.5, 'muted text on Surface (hero stat labels)'],
  ['ink-mute', '#FFFFFF', 4.5, 'muted text on the white form card'],
  ['gold-ink', '#F4F7FA', 4.5, 'gold TEXT on light'],
  ['gold-deep', '#F4F7FA', 3.0, 'gold emphasis and borders on light'],
  ['on-navy', '#0C3054', 4.5, 'text on the navy band'],
  ['on-navy', '#0A2846', 4.5, 'text on a dark card'],
  ['steel-ink', '#0C3054', 4.5, 'steel TEXT on navy'],
  ['steel-ink', '#0A2846', 4.5, 'steel TEXT on navy-850'],
  ['steel', '#081F38', 4.5, 'footer steel on navy-900'],
  ['steel', '#0C3054', 3.0, 'steel as a graphic stroke on navy'],
  ['gold', '#0C3054', 4.5, 'gold text on navy'],
  ['navy', '#F2A91E', 4.5, 'navy text on a gold button'],
];

for (const [token, ground, floor, what] of PAIRS) {
  test(what + ' clears ' + floor.toFixed(1) + ':1', () => {
    assert.ok(tokens[token], '--' + token + ' is not defined');
    const r = contrast(tokens[token], ground);
    assert.ok(r >= floor,
      '--' + token + ' ' + tokens[token] + ' on ' + ground + ' is ' + r.toFixed(2) +
      ':1, below the ' + floor.toFixed(1) + ' floor');
  });
}

test('the ink ramp stays ordered light-to-dark', () => {
  // ink is the darkest and ink-mute the lightest. Darkening ink-mute far
  // enough to pass contrast could invert it past ink-soft, which would make
  // "muted" text look stronger than the secondary text above it.
  assert.ok(luminance(tokens.ink) < luminance(tokens['ink-soft']), 'ink < ink-soft');
  assert.ok(luminance(tokens['ink-soft']) < luminance(tokens['ink-mute']), 'ink-soft < ink-mute');
});

test('brand --steel is used as text only where it passes', () => {
  // --steel is 4.45:1 on --navy, so it is not allowed as text there; text on
  // dark grounds must use --steel-ink. The footer is the one legitimate
  // exception: it sits on --navy-900, where --steel reaches 5.51:1.
  const offenders = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = rule[2];
    if (!/(^|[;\s])color:\s*var\(--steel\)/.test(body)) continue;
    const selector = rule[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ');
    if (selector === 'footer') continue;
    offenders.push(selector);
  }
  assert.deepStrictEqual(offenders, [],
    'these set color: var(--steel); use var(--steel-ink) on dark or var(--ink-mute) on light');
});
