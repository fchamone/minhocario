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

// --- Finding #3: the <details> guard fails open ------------------------------
// Both panels early-return on `if (!panel.open) return` (actions.js,
// stats.js). `open` is a property of HTMLDetailsElement and nothing else, so
// the day either panel becomes a plain <div> the guard reads `undefined`,
// falsies, and the panel goes PERMANENTLY BLANK — no error, no failing test,
// no console warning. The plan calls this the most likely silent regression in
// the project, which is exactly why it gets a tripwire rather than a comment.
//
// V12 promoted #internals out of the stage overlay into its own grid column,
// which is the kind of edit that invites "it's just a box now, make it a div".
// If either panel ever legitimately stops being collapsible, the guard in the
// JS must become `if (panel.open === false) return` in the SAME commit.

/** Panels whose repaint guard depends on `.open` being a real property. */
const COLLAPSIBLE_PANELS = ['internals', 'stats'];

/**
 * Report every panel that is not an open <details>.
 * @param {string} source
 * @returns {string[]} human-readable violations
 */
function collapsiblePanelViolations(source) {
  const violations = [];

  for (const id of COLLAPSIBLE_PANELS) {
    const tag = new RegExp(`<([a-zA-Z][\\w-]*)([^>]*\\bid="${id}"[^>]*)>`).exec(source);

    if (!tag) {
      violations.push(`#${id} is not in index.html at all`);
      continue;
    }
    if (tag[1].toLowerCase() !== 'details') {
      violations.push(
        `#${id} is a <${tag[1]}>, not <details> — its repaint guard reads ` +
          '`panel.open`, which is undefined on any other element, so the panel ' +
          'will render blank forever. Keep it <details>, or change the guard to ' +
          '`panel.open === false` in the same edit.',
      );
      continue;
    }
    // Matched against the whole tag, not the captured attributes: `open` is a
    // bare boolean attribute and is usually written last, so the lookahead needs
    // the closing `>` to land on.
    if (!/\sopen(?=[\s>=])/.test(tag[0])) {
      violations.push(
        `#${id} is a <details> without \`open\` — it starts collapsed, so the ` +
          'player sees an empty panel on first load',
      );
    }
  }

  return violations;
}

test('both readout panels are open <details>, so their repaint guard works', () => {
  assert.deepEqual(collapsiblePanelViolations(html()), []);
});

test('the collapsible-panel walker actually detects a violation', () => {
  // Guards the guard (the V6 lesson): the rule above passes trivially today, so
  // prove it sees each way the invariant can break.
  assert.equal(collapsiblePanelViolations('<div id="internals"></div><details id="stats" open>').length, 1);
  assert.equal(collapsiblePanelViolations('<details id="internals"><details id="stats" open>').length, 1);
  assert.equal(collapsiblePanelViolations('<details id="stats" open>').length, 1, 'missing panel');
  assert.deepEqual(
    collapsiblePanelViolations('<details class="x" id="internals" open><details id="stats" open>'),
    [],
  );
});

// --- V12: the internals panel is a grid region, not a stage overlay ----------
// Until V12 the panel was absolutely positioned inside .stage, which is the
// whole reason `internalsSide`/`placeInternals` existed: the bin could slide
// underneath it, so the panel had to dodge. Promoting it into its own grid
// column deleted that machinery outright.
//
// Putting it back inside .stage would not fail visibly — it would just start
// overlapping the composter again, silently, with no dodge left to save it.

/**
 * Attributes of every open ancestor of the element carrying `id`, outermost
 * first, or null if no such element. Same stack walk as svgsUnderDataString.
 * @param {string} source
 * @param {string} id
 * @returns {string[]|null}
 */
function ancestorAttrs(source, id) {
  const stack = [];
  const wanted = new RegExp(`\\bid="${id}"`);

  for (const m of source.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, rawTag, attrs, selfClosing] = m;
    const tag = rawTag.toLowerCase();

    if (closing) {
      const at = stack.map((e) => e.tag).lastIndexOf(tag);
      if (at !== -1) stack.length = at;
      continue;
    }

    if (wanted.test(attrs)) return stack.map((e) => e.attrs);
    if (!VOID_TAGS.has(tag) && !selfClosing) stack.push({ tag, attrs });
  }

  return null;
}

test('the internals panel is a grid child of the game screen, not a stage overlay', () => {
  const ancestors = ancestorAttrs(html(), 'internals');
  assert.ok(ancestors, '#internals is not in index.html');

  assert.ok(
    !ancestors.some((a) => /\bid="stage"/.test(a)),
    '#internals sits inside #stage again — it would overlay the composter, and ' +
      'the dodge machinery (internalsSide/placeInternals) was deleted in V12',
  );
  assert.ok(
    ancestors.some((a) => /\bclass="[^"]*\bscreen--game\b/.test(a)),
    '#internals must be a child of .screen--game so its grid-area applies',
  );
});

test('the ancestor walker actually detects a violation', () => {
  const nested = '<section class="screen screen--game"><div id="stage"><details id="internals">';
  assert.ok(ancestorAttrs(nested, 'internals').some((a) => /\bid="stage"/.test(a)));

  const promoted = '<section class="screen screen--game"><div id="stage"></div><details id="internals">';
  assert.ok(!ancestorAttrs(promoted, 'internals').some((a) => /\bid="stage"/.test(a)));

  assert.equal(ancestorAttrs('<div id="other">', 'internals'), null);
});

// --- V12: the dodge machinery is gone, with no danglers ----------------------
// Deleting a feature by half is worse than not deleting it: a leftover CSS
// modifier or a call to a removed function is dead weight that reads as live
// code. The panel cannot be slid under any more, so every trace of the
// hysteresis goes.
//
// Deliberately blunt — it matches comments as well as code, and that is a
// feature rather than a limitation to work around. A comment explaining a
// function that no longer exists is exactly the stale rule CLAUDE.md's
// discipline notes call a bug; prose describing the deletion can say what was
// removed without naming identifiers a reader would then fail to grep.

test('no trace of the internals dodge machinery survives', () => {
  const DEAD = ['internalsSide', 'placeInternals', 'internals--right', 'INTERNALS_FLIP_TO_'];
  const sources = uiSources().concat([
    ['css/components.css', read('../css/components.css')],
    ['css/screens.css', read('../css/screens.css')],
    ['index.html', html()],
  ]);

  for (const [file, src] of sources) {
    for (const name of DEAD) {
      assert.ok(
        !src.includes(name),
        `${file} still references \`${name}\` — V12 deleted the stage-overlay ` +
          'dodge, so this is a dangling reference to machinery that no longer exists',
      );
    }
  }
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
