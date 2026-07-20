import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Static guards over index.html and the UI layer. There is no DOM and no
 * browser under `node --test`, so these read the sources and assert structure —
 * the same approach tests/i18n.test.js already uses to scan index.html.
 */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const html = () => read('../index.html');

const uiSources = () =>
  readdirSync(new URL('../js/ui', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => [`js/ui/${f}`, read(`../js/ui/${f}`)])
    .concat([['js/main.js', read('../js/main.js')]]);

// --- Finding #1: applyStrings() destroys inline SVG --------------------------
// js/main.js does `el.textContent = t(key)` on every [data-string] node. An
// <svg> inside such an element is therefore wiped at init AND on every language
// switch. The fix is structural — data-string moves to an inner <span> and the
// icon becomes its sibling — and this is the tripwire that keeps it fixed.
//
// Currently vacuous (the repo has no <svg> yet), so it was verified by
// deliberately nesting one; see the V3 notes in the todo.

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Walk tags, maintaining an element stack, and report every <svg> that has an
 * ancestor carrying data-string (or carries it itself).
 * @returns {string[]} human-readable violations
 */
function svgsUnderDataString(source) {
  const violations = [];
  const stack = [];

  for (const m of source.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, rawTag, attrs, selfClosing] = m;
    const tag = rawTag.toLowerCase();

    if (closing) {
      const at = stack.map((e) => e.tag).lastIndexOf(tag);
      if (at !== -1) stack.length = at;
      continue;
    }

    const carriesString = /\bdata-string=/.test(attrs);
    const holder = stack.find((e) => e.carriesString);

    if (tag === 'svg' && (holder || carriesString)) {
      const owner = holder ? holder.attrs : attrs;
      const key = /\bdata-string="([^"]*)"/.exec(owner)?.[1] ?? '(unknown)';
      violations.push(
        `<svg> inside [data-string="${key}"] — applyStrings() will wipe it; ` +
          'move data-string onto an inner <span> and make the <svg> its sibling',
      );
    }

    if (!VOID_TAGS.has(tag) && !selfClosing) stack.push({ tag, attrs, carriesString });
  }

  return violations;
}

test('no [data-string] element contains an <svg>', () => {
  assert.deepEqual(svgsUnderDataString(html()), []);
});

test('the [data-string]/<svg> walker actually detects a violation', () => {
  // Guards the guard: the rule above is vacuous until icons land, and a test
  // that cannot fail is worth nothing (the V6 lesson).
  const planted = '<button data-string="game.drain"><svg><use href="#x"/></svg></button>';
  assert.equal(svgsUnderDataString(planted).length, 1);

  const correct = '<button><svg><use href="#x"/></svg><span data-string="game.drain"></span></button>';
  assert.deepEqual(svgsUnderDataString(correct), []);
});

// --- Every data-action reaches a handler ------------------------------------

test('every data-action in index.html is wired to something', () => {
  const source = html();
  const actionsJs = read('../js/ui/actions.js');

  // An action button is live if actions.js references its name, or if it also
  // carries data-nav (main.js wires every [data-nav] to the screen router).
  // `openShop` is the second kind: it has no handler in actions.js at all and
  // works purely through data-nav="shop".
  const buttons = [...source.matchAll(/<button[^>]*\bdata-action="([^"]+)"[^>]*>/g)];
  assert.ok(buttons.length > 0, 'index.html should carry data-action buttons');

  for (const [tag, action] of buttons) {
    const wired =
      actionsJs.includes(`'${action}'`) ||
      actionsJs.includes(`"${action}"`) ||
      /\bdata-nav="/.test(tag);

    assert.ok(
      wired,
      `data-action="${action}" has no handler in actions.js and no data-nav fallback`,
    );
  }
});

// --- The HUD readouts don't jitter ------------------------------------------
// DESIGN.md: "every numeric readout uses font-variant-numeric: tabular-nums —
// values change every tick, and proportional digits make the whole panel jitter
// as they do." The HUD is where that bites hardest: six readouts on one strip,
// three of them repainted every tick.
//
// The failure mode is a seventh readout added later without the class. Nothing
// would throw, no test would fail, and the strip would simply twitch once per
// tick in a way that is easy to see and hard to attribute. So the class list is
// derived from the ids updateHud actually writes, rather than hardcoded here —
// adding a readout to hud.js and forgetting the markup is the case this catches.
//
// This reaches into css/screens.css, which is otherwise css.test.js's territory:
// the invariant is one thing (a readout is tagged AND the tag means something),
// and splitting it across two files is how half of it gets deleted later.

test('every HUD readout is tagged for tabular numerals', () => {
  const source = html();
  const hudJs = read('../js/ui/hud.js');
  const screensCss = read('../css/screens.css');

  const written = [...hudJs.matchAll(/\bset\(\s*'(hud-[\w-]+)'/g)].map((m) => m[1]);
  assert.ok(written.length >= 5, 'updateHud should paint the HUD readouts by id');

  for (const id of written) {
    const tag = new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`).exec(source)?.[0];
    assert.ok(tag, `#${id} is written by updateHud but is not in index.html`);
    assert.match(
      tag,
      /class="[^"]*\bhud__value\b/,
      `#${id} is a HUD readout but carries no .hud__value — it will jitter as it ticks`,
    );
  }

  assert.match(
    screensCss,
    /\.hud__value\b[^{]*\{[^}]*font-variant-numeric:\s*tabular-nums/,
    '.hud__value must actually declare tabular-nums, or tagging the readouts means nothing',
  );
});

// --- Every getElementById target exists -------------------------------------

test('every literal getElementById id exists in index.html or is created in js/', () => {
  const source = html();
  const inMarkup = new Set(
    [...source.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]),
  );

  const allJs = uiSources().map(([, src]) => src).join('\n');
  // Ids the UI creates at runtime rather than finding — e.g. setup.js builds the
  // first-waste controls and assigns `select.id = 'setup-waste-food'`.
  const createdAtRuntime = new Set(
    [...allJs.matchAll(/\.id\s*=\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
  );

  for (const [file, src] of uiSources()) {
    // Only literal arguments can be checked; `getElementById(id)` with a
    // variable is resolved at runtime (actions.js and hud.js both do this).
    for (const m of src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const id = m[1];
      assert.ok(
        inMarkup.has(id) || createdAtRuntime.has(id),
        `${file} looks up #${id}, which is neither in index.html nor created in js/`,
      );
    }
  }
});
