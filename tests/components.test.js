import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  clamp01,
  fillOf,
  formatLiters,
  formatPercent,
  buildStat,
  buildGauge,
  buildFillBar,
  buildGroup,
  markFillLevel,
  fill,
  WARN_FILL,
} from '../js/ui/components.js';
import * as actions from '../js/ui/actions.js';

/**
 * js/ui/components.js is the single home for the readout primitives the
 * internals panel and the statistics box both render. Two kinds of test live
 * here:
 *
 *   1. Behaviour of the pure helpers, which run under Node unchanged.
 *   2. Static source guards that the duplication V9 removed cannot grow back.
 *      There is no DOM here, so "one builder serves both panels" is asserted by
 *      reading the sources — the same approach tests/markup.test.js uses.
 */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const uiSources = () =>
  readdirSync(new URL('../js/ui', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => [`js/ui/${f}`, read(`../js/ui/${f}`)]);

const stripComments = (js) => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** UI sources other than the one module allowed to own a primitive. */
const othersThan = (owner) =>
  uiSources().filter(([file]) => file !== `js/ui/${owner}`);

// --- The pure helpers still behave ------------------------------------------

test('clamp01 pins a value into the unit interval', () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(2), 1);
});

test('fillOf reports the two tiers as mutually exclusive', () => {
  // A full tray has ARRIVED; it is not "approaching full". Rendering both at
  // once would stack a yellow rule and a red one on the same node.
  const warning = fillOf(7, 10);
  assert.equal(warning.warn, true);
  assert.equal(warning.full, false);

  const done = fillOf(10, 10);
  assert.equal(done.warn, false);
  assert.equal(done.full, true);
  assert.equal(done.fill, 1);
});

test('fillOf survives the float dust that a bare >= would trip over', () => {
  // 12 * 0.7 = 8.399999999999999, a hair UNDER the threshold, so an exact
  // comparison would silently skip the warn tier for whole families of
  // capacities. The EPS slack is why this passes.
  assert.equal(fillOf(12 * WARN_FILL, 12).warn, true);
});

test('fillOf tolerates a bin with no capacity', () => {
  const none = fillOf(0, 0);
  assert.equal(none.fill, 0);
  assert.equal(none.warn, false);
  assert.equal(none.full, false);
});

test('formatLiters trims to at most two decimals with no trailing zeros', () => {
  assert.match(formatLiters(1.5), /^1\.5\b/);
  assert.match(formatLiters(2), /^2\b/);
  assert.match(formatLiters(0.256), /^0\.26\b/);
});

test('formatPercent renders a whole-number percentage', () => {
  assert.equal(formatPercent(0.5), '50%');
  assert.equal(formatPercent(0), '0%');
  assert.equal(formatPercent(1), '100%');
});

// --- The builders exist and are the shared ones ------------------------------

test('components.js exports every builder both panels need', () => {
  for (const [name, fn] of Object.entries({
    buildStat,
    buildGauge,
    buildFillBar,
    buildGroup,
    markFillLevel,
    fill,
  })) {
    assert.equal(typeof fn, 'function', `${name} should be exported as a function`);
  }
});

test('actions.js re-exports the moved primitives so no test file had to move', () => {
  // V9 keeps these re-exports for one release: tests/actions.test.js and any
  // other caller keep importing from the module they always did.
  for (const name of ['buildStat', 'fillOf', 'markFillLevel', 'WARN_FILL']) {
    assert.ok(name in actions, `actions.js no longer re-exports ${name}`);
  }
  assert.equal(actions.fillOf, fillOf, 'actions.fillOf must BE the components.js one');
  assert.equal(actions.WARN_FILL, WARN_FILL);
});

// --- Static guards: the duplication cannot grow back -------------------------
// Each of these fails if a second module starts building the same markup again,
// which is exactly how the four primitives drifted apart in the first place.

test('the .gauge row markup is authored in exactly one module', () => {
  // buildGauge (actions.js) and buildFillBar (stats.js) were near-identical
  // unmerged siblings, each constructing the whole row from scratch.
  for (const [file, src] of othersThan('components.js')) {
    assert.doesNotMatch(
      stripComments(src),
      /className\s*=\s*'gauge'/,
      `${file} builds a .gauge row itself — use buildGauge/buildFillBar from components.js`,
    );
  }
});

test('the .stat row markup is authored in exactly one module', () => {
  for (const [file, src] of othersThan('components.js')) {
    assert.doesNotMatch(
      stripComments(src),
      /className\s*=\s*'stat'/,
      `${file} builds a .stat row itself — use buildStat from components.js`,
    );
  }
});

test('group sections are authored in exactly one module', () => {
  // buildGroup lived only in stats.js while actions.js inlined the same
  // section + <h4> pattern four times.
  for (const [file, src] of othersThan('components.js')) {
    assert.doesNotMatch(
      stripComments(src),
      /className\s*=\s*'(?:internals|stats)__group'/,
      `${file} builds a group section itself — use buildGroup from components.js`,
    );
  }
});

test('formatLiters is defined exactly once across the UI layer', () => {
  const definers = uiSources()
    .filter(([, src]) => /function\s+formatLiters\b/.test(stripComments(src)))
    .map(([file]) => file);

  assert.deepEqual(
    definers,
    ['js/ui/components.js'],
    'formatLiters was defined identically in actions.js and stats.js; it has one home now',
  );
});

test('the duplication guards actually detect a violation', () => {
  // Guards the guards (the V6 lesson): these rules pass trivially the moment
  // they are satisfied, so prove the patterns match the markup they describe.
  const planted = "const row = document.createElement('div'); row.className = 'gauge';";
  assert.match(stripComments(planted), /className\s*=\s*'gauge'/);

  const plantedGroup = "section.className = 'stats__group';";
  assert.match(stripComments(plantedGroup), /className\s*=\s*'(?:internals|stats)__group'/);

  // ...and that a comment mentioning the class is NOT mistaken for markup.
  const mentioned = "// sets className = 'gauge' on the row\nfoo();";
  assert.doesNotMatch(stripComments(mentioned), /className\s*=\s*'gauge'/);
});
