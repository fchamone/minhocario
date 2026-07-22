import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The brand mark exists twice on purpose: inlined in index.html (zero HTTP
 * requests, coloured from CSS tokens through currentColor) and as
 * assets/logo.svg (standalone, for README / docs / anything outside the app,
 * where neither of those is possible). There is no build step to generate one
 * from the other, so nothing but these assertions stops the two from drifting
 * into different-looking worms — the exact failure CLAUDE.md records for the
 * hand-copied THROUGHPUT_CAP_PER_LITER, in a place no test would otherwise see.
 *
 * Only what makes the two the SAME DRAWING is compared: geometry, stroke
 * weights and the accent. The differences are the point of having two copies —
 * the asset bakes its colour and knocks the eye out to transparent, the inlined
 * one inherits currentColor and knocks it out in the page ground — so those are
 * deliberately not asserted here.
 */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const stripComments = (svg) => svg.replace(/<!--[\s\S]*?-->/g, '');

/** The inlined hero mark, comments stripped. */
function inlineMark() {
  const html = stripComments(read('../index.html'));
  const open = html.indexOf('<svg class="home__mark"');
  assert.notEqual(open, -1, 'index.html no longer carries the .home__mark svg');
  const close = html.indexOf('</svg>', open);
  return html.slice(open, close);
}

const logoAsset = () => stripComments(read('../assets/logo.svg'));

const attr = (attrs, name) =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;

/**
 * Every drawn shape, as a colour-blind signature: what is drawn and how thickly,
 * never in what paint. Sorted, so the two documents may order their shapes
 * differently (the asset must define its mask before it can reference it).
 * @param {string} svg
 * @returns {string[]}
 */
function shapes(svg) {
  const out = [];

  for (const [, attrs] of svg.matchAll(/<path\b([^>]*?)\/>/g)) {
    out.push(`path d="${attr(attrs, 'd')}" w=${attr(attrs, 'stroke-width')} cap=${attr(attrs, 'stroke-linecap')}`);
  }
  for (const [, attrs] of svg.matchAll(/<circle\b([^>]*?)\/>/g)) {
    out.push(`circle ${attr(attrs, 'cx')},${attr(attrs, 'cy')} r=${attr(attrs, 'r')}`);
  }

  return out.sort();
}

// --- The two copies are one drawing -----------------------------------------

test('assets/logo.svg and the inlined mark draw the identical worm', () => {
  const asset = shapes(logoAsset());
  const inline = shapes(inlineMark());

  assert.ok(inline.length >= 4, 'the inlined mark should carry body, head, eye and two segment marks');
  assert.deepEqual(
    asset,
    inline,
    'assets/logo.svg and index.html have drifted. They are the same mark and ' +
      'there is no build step to regenerate one from the other, so a retune has ' +
      'to be made in BOTH files in the same commit.',
  );
});

test('both copies are cropped to the same viewBox', () => {
  assert.equal(
    attr(logoAsset(), 'viewBox'),
    attr(inlineMark(), 'viewBox'),
    'a different viewBox is a different crop — the asset would sit at a ' +
      'different size and with different air around it than the hero mark',
  );
});

// --- The asset's baked colour still tracks the token -------------------------
// assets/logo.svg cannot reference a CSS custom property: it is loaded with
// <img>, outside any document that defines one. So it bakes the accent, which
// makes it the one place in the repo where a colour literal is legitimately
// duplicated out of tokens.css — and therefore the one place that can silently
// fall out of date when the palette is retuned.

test("the asset's baked green is exactly --accent", () => {
  const accent = /--accent:\s*(#[0-9a-fA-F]{3,8})\b/.exec(read('../css/tokens.css'))?.[1];
  assert.ok(accent, 'tokens.css should define --accent as a hex literal');

  const baked = [...new Set([...logoAsset().matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]))];
  const paint = baked.filter((c) => !/^#(?:0{6}|f{6})$/i.test(c));

  assert.deepEqual(
    paint.map((c) => c.toLowerCase()),
    [accent.toLowerCase()],
    `assets/logo.svg paints in ${paint.join(', ')} but --accent is now ${accent} — ` +
      'the asset is transcribed FROM tokens.css and has to be re-transcribed ' +
      'when the palette moves (DESIGN.md, "The brand mark")',
  );
});

// --- The asset is self-contained --------------------------------------------
// "Fully static and self-contained: no CDN, no external network calls, works
// offline" is a project non-negotiable, and an SVG is a document that can fetch:
// <image href>, an external stylesheet, a webfont, an xlink into another file.

test('assets/logo.svg fetches nothing', () => {
  const svg = logoAsset();

  for (const [ref] of svg.matchAll(/\b(?:href|xlink:href|src)="([^"]*)"/g)) {
    assert.match(ref, /="#/, `assets/logo.svg references ${ref} — it must resolve internally`);
  }
  for (const tag of ['<image', '<use', '<style', '@import', 'font-face']) {
    assert.ok(!svg.includes(tag), `assets/logo.svg carries ${tag}, which can pull in an external resource`);
  }
});

// --- Guard the guards (the V6 lesson) ---------------------------------------

test('the shape walker actually detects a drift', () => {
  const CIRCLE = '<circle cx="1" cy="2" r="3"/>';
  const PATH = '<path d="M0 0L1 1" stroke-width="2" stroke-linecap="round"/>';
  const a = CIRCLE + PATH;
  const moved = '<circle cx="1" cy="9" r="3"/>' + PATH;
  const thinned = CIRCLE + '<path d="M0 0L1 1" stroke-width="1" stroke-linecap="round"/>';

  assert.deepEqual(shapes(a), shapes(PATH + CIRCLE), 'order must not matter');
  assert.notDeepEqual(shapes(a), shapes(moved), 'a moved circle must register');
  assert.notDeepEqual(shapes(a), shapes(thinned), 'a retuned stroke weight must register');

  // Paint is deliberately invisible to it: that is what lets the asset bake a
  // hex while the inlined copy uses currentColor.
  const painted = a.replace('r="3"', 'r="3" fill="#7bc043"');
  assert.deepEqual(shapes(a), shapes(painted));
});
