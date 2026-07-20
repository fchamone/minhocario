import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { FOODS } from '../js/sim/foods.js';

/**
 * Static guards over the icon sprite in index.html and js/ui/icons.js.
 *
 * The important half of this file is the FOOD set. Real food illustrations were
 * chosen deliberately (the names already say "Carne", so an illustration of meat
 * leaks nothing the name doesn't), but two leaks ARE new and neither is visible
 * in a diff:
 *
 *   1. Silhouette grouping — organic-irregular (peels, guts, leaves) versus
 *      manufactured-regular (pasta, dairy, salty) reads as two families, which
 *      is exactly the suitability split the catalog order hides.
 *   2. Colour coding — green/brown versus pink/white/beige is the same failure
 *      through another channel.
 *
 * The mitigation is a uniform treatment: one identical circular frame, one
 * stroke weight, no fills, `currentColor` only. The frame and the weight are
 * what the eye groups on, and BOTH are machine-checkable — so they are checked
 * here. What is NOT checkable is whether the 14 glyphs inside those frames still
 * cluster; that stays a manual review item at CPV2.
 */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const html = () => read('../index.html');

const jsSources = () =>
  readdirSync(new URL('../js/ui', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => [`js/ui/${f}`, read(`../js/ui/${f}`)]);

/**
 * Parse every `<symbol id="ico-…">` out of a document.
 * @returns {Map<string, {attrs: string, body: string}>} keyed by id
 */
function symbols(source) {
  const found = new Map();
  for (const m of source.matchAll(/<symbol\s+([^>]*?)>([\s\S]*?)<\/symbol>/g)) {
    const [, attrs, body] = m;
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
    if (id) found.set(id, { attrs, body });
  }
  return found;
}

/** Every `#ico-…` referenced by a `<use>` in the markup. */
const usedInMarkup = (source) =>
  [...source.matchAll(/<use\s+[^>]*href="#([^"]+)"/g)].map((m) => m[1]);

/** Every name passed to `icon('…')` in the UI layer. */
const usedInJs = () =>
  jsSources().flatMap(([, src]) =>
    [...src.matchAll(/\bicon\(\s*'([\w-]+)'/g)].map((m) => `ico-${m[1]}`),
  );

const foodSymbols = () =>
  [...symbols(html()).entries()].filter(([id]) => id.startsWith('ico-food-'));

// --- Resolution: no reference dangles, no symbol is dead ---------------------

test('every <use href> in index.html resolves to a symbol in the sprite', () => {
  const defined = symbols(html());
  for (const id of usedInMarkup(html())) {
    assert.ok(defined.has(id), `<use href="#${id}"> has no matching <symbol id="${id}">`);
  }
});

test("every icon('…') call in js/ui resolves to a symbol in the sprite", () => {
  const defined = symbols(html());
  for (const id of usedInJs()) {
    assert.ok(defined.has(id), `icon() builds a <use> for #${id}, which the sprite does not define`);
  }
});

test('every catalog food has an icon, and no icon has no food', () => {
  const defined = symbols(html());
  for (const food of FOODS) {
    assert.ok(
      defined.has(`ico-food-${food.id}`),
      `food "${food.id}" has no #ico-food-${food.id} symbol — the chooser would render a blank`,
    );
  }
  // The other direction: a symbol for a food the catalog dropped is dead weight
  // that would never be caught, since nothing renders it.
  const catalog = new Set(FOODS.map((f) => f.id));
  for (const [id] of foodSymbols()) {
    const foodId = id.slice('ico-food-'.length);
    assert.ok(catalog.has(foodId), `#${id} has no matching food in the catalog`);
  }
});

test('the sprite carries no unreferenced symbol', () => {
  const referenced = new Set([
    ...usedInMarkup(html()),
    ...usedInJs(),
    // Food symbols are referenced through `foodIcon(food.id)` over the catalog,
    // which the test above covers exhaustively.
    ...FOODS.map((f) => `ico-food-${f.id}`),
  ]);

  for (const [id] of symbols(html())) {
    assert.ok(referenced.has(id), `#${id} is defined but never used — delete it or wire it up`);
  }
});

// --- Food icons: the uniform-treatment discipline ---------------------------

test('every food icon is drawn on the same canvas', () => {
  const boxes = new Set(
    foodSymbols().map(([, s]) => /\bviewBox="([^"]+)"/.exec(s.attrs)?.[1]),
  );
  assert.equal(
    boxes.size,
    1,
    `food icons use ${boxes.size} different viewBoxes (${[...boxes].join(' | ')}) — ` +
      'a different canvas means a different optical scale, which is a grouping cue',
  );
});

test('every food icon carries the identical circular frame', () => {
  // The frame is what the eye actually groups on. If one is a different radius
  // or weight, that icon reads as a different KIND of thing — which is the
  // silhouette leak arriving through the container instead of the glyph.
  const frames = new Set(
    foodSymbols().map(([, s]) => /<circle\b[^>]*\/>/.exec(s.body)?.[0].replace(/\s+/g, ' ')),
  );
  assert.equal(
    frames.size,
    1,
    `food icons carry ${frames.size} distinct frames — they must be byte-identical:\n` +
      [...frames].join('\n'),
  );
  assert.ok([...frames][0], 'no food icon carries a frame circle at all');
});

test('every food icon paints in currentColor only — no per-food hue', () => {
  for (const [id, s] of foodSymbols()) {
    for (const m of s.body.matchAll(/\b(fill|stroke)="([^"]*)"/g)) {
      const [, prop, value] = m;
      assert.ok(
        value === 'currentColor' || value === 'none',
        `#${id} sets ${prop}="${value}" — food icons are monochrome; ` +
          'green/brown vs pink/white is the suitability split by another channel',
      );
    }
  }
});

test('every food icon is drawn at one and the same stroke weight', () => {
  // Uniform optical weight is the other half of the discipline: a heavier icon
  // reads as a more significant one.
  const weights = new Set();
  for (const [, s] of foodSymbols()) {
    for (const m of s.body.matchAll(/\bstroke-width="([^"]*)"/g)) weights.add(m[1]);
  }
  assert.equal(
    weights.size,
    1,
    `food icons use ${weights.size} stroke weights (${[...weights].join(', ')}) — ` +
      'the set must read at one optical weight',
  );
});

test('food icons are stroke-only, so no glyph carries more fill density', () => {
  for (const [id, s] of foodSymbols()) {
    const fills = [...s.body.matchAll(/\bfill="([^"]*)"/g)].map((m) => m[1]);
    for (const value of fills) {
      assert.equal(
        value,
        'none',
        `#${id} fills a shape — a filled glyph is optically heavier than a drawn one, ` +
          'and weight differences are exactly what group 14 icons into families',
      );
    }
  }
});

// --- Hand-authored path data --------------------------------------------------
// A malformed `d` renders NOTHING and reports nothing: no console error, no
// exception, just a blank where an icon should be. With 80+ hand-typed paths in
// the sprite that is the single likeliest way an icon silently disappears, and
// it is the kind of thing a reviewer's eye skims straight past.

test('every path in the sprite carries well-formed data', () => {
  const paths = [...html().matchAll(/\sd="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(paths.length > 0, 'the sprite should carry path data');

  for (const d of paths) {
    assert.match(d, /^[Mm]/, `a path starts without a moveto and will not render: "${d}"`);
    assert.doesNotMatch(
      d,
      /[^MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]/,
      `a path carries a character no SVG command allows: "${d}"`,
    );
  }
});

test('the path-data check actually detects malformed data', () => {
  const bad = ['L4 4', 'M4 4 X9 9'];
  assert.doesNotMatch(bad[0], /^[Mm]/);
  assert.match(bad[1], /[^MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]/);
});

// --- Icons carry no text ----------------------------------------------------

test('every icon <svg> is hidden from assistive tech and from tab order', () => {
  const icons = [...html().matchAll(/<svg\b[^>]*class="[^"]*\bico\b[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.ok(icons.length > 0, 'index.html should carry icon <svg> elements');

  for (const tag of icons) {
    assert.match(tag, /aria-hidden="true"/, `icon is not aria-hidden: ${tag}`);
    assert.match(tag, /focusable="false"/, `icon is focusable (an IE/Edge tab-order trap): ${tag}`);
  }
});

test('the icons module builds the same hidden, non-focusable svg', () => {
  const src = read('../js/ui/icons.js');
  assert.match(src, /aria-hidden'?"?,\s*'true'/, 'icon() must set aria-hidden="true"');
  assert.match(src, /focusable'?"?,\s*'false'/, 'icon() must set focusable="false"');
  // createElementNS is confined to this one module so every other UI file keeps
  // the plain createElement discipline.
  for (const [file, source] of jsSources()) {
    if (file === 'js/ui/icons.js') continue;
    assert.doesNotMatch(
      source,
      /createElementNS/,
      `${file} calls createElementNS — SVG construction belongs in js/ui/icons.js`,
    );
  }
});

// --- Guard the guards -------------------------------------------------------

test('the food-uniformity checks actually detect a violation', () => {
  // Every rule above passes trivially once satisfied, so prove each pattern
  // matches the thing it claims to police (the V6 lesson).
  const odd = `
    <symbol id="ico-food-a" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1"/>
      <g fill="none" stroke="currentColor" stroke-width="1.25"><path d="M6 6"/></g>
    </symbol>
    <symbol id="ico-food-b" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2"/>
      <g fill="#c33" stroke="currentColor" stroke-width="2.5"><path d="M6 6"/></g>
    </symbol>`;

  const planted = [...symbols(odd).entries()].filter(([id]) => id.startsWith('ico-food-'));
  assert.equal(planted.length, 2, 'the symbol parser should find both planted icons');

  const boxes = new Set(planted.map(([, s]) => /\bviewBox="([^"]+)"/.exec(s.attrs)?.[1]));
  assert.equal(boxes.size, 2, 'the viewBox check must see two different canvases');

  const frames = new Set(
    planted.map(([, s]) => /<circle\b[^>]*\/>/.exec(s.body)?.[0].replace(/\s+/g, ' ')),
  );
  assert.equal(frames.size, 2, 'the frame check must see two different frames');

  const weights = new Set(
    planted.flatMap(([, s]) => [...s.body.matchAll(/\bstroke-width="([^"]*)"/g)].map((m) => m[1])),
  );
  assert.ok(weights.size > 1, 'the stroke-weight check must see more than one weight');

  const fills = planted.flatMap(([, s]) =>
    [...s.body.matchAll(/\bfill="([^"]*)"/g)].map((m) => m[1]),
  );
  assert.ok(fills.includes('#c33'), 'the monochrome check must see the planted hue');
});
