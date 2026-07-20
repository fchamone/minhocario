// Icon factory: the one module that builds SVG.
//
// Two kinds of icon live here, and the split is deliberate:
//
//   1. SPRITE icons (`icon`, `foodIcon`) — a `<use>` pointing at a `<symbol>`
//      inlined at the top of <body> in index.html. Fixed artwork, so it is
//      authored once as markup and referenced, never rebuilt.
//   2. PARAMETRIC icons (`volumeGlyph`, `decompositionRing`) — the drawing
//      itself depends on a number, so there is nothing to put in a sprite. These
//      are built element by element.
//
// `createElementNS` is confined to this module (tests/icons.test.js enforces it)
// so every other UI file keeps the plain `createElement` discipline. That
// matters more than it sounds: `document.createElement('svg')` silently produces
// an HTMLUnknownElement that renders nothing, and the failure is invisible —
// no error, just a blank where an icon should be.
//
// Every icon is `aria-hidden="true"` and `focusable="false"`. Icons carry NO
// text: the adjacent `[data-string]` span carries the accessible name, which is
// why this whole redesign adds zero i18n keys and leaves the three locales
// untouched. `focusable="false"` is not decoration either — without it, older
// Edge/IE put every inline <svg> into the tab order, so the action panel would
// grow a dozen invisible tab stops.

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Radius of the decomposition ring, in its 24-unit viewBox. */
const RING_RADIUS = 8;

/** Circumference the dash offset is expressed against. */
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Clamp to [0, 1]; a corrupt fraction must not leak into an attribute. */
function clamp01(x) {
  return typeof x === 'number' && Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0;
}

/**
 * Create an SVG element with attributes. `className` is NOT usable on an SVG
 * element — there it is a read-only `SVGAnimatedString`, and assigning to it
 * fails silently in some engines — so everything goes through `setAttribute`.
 * @param {string} tag
 * @param {Record<string, string|number>} [attrs]
 * @returns {SVGElement}
 */
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
}

/**
 * The shared outer `<svg>` every icon in this module is wrapped in.
 * @param {string} className
 * @returns {SVGElement}
 */
function iconShell(className) {
  const svg = svgEl('svg', { viewBox: '0 0 24 24' });
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}

/**
 * A sprite icon: `<svg class="ico ico--name"><use href="#ico-name"/></svg>`.
 *
 * The name IS the symbol id minus the `ico-` prefix — one mapping rule, which is
 * what lets tests/icons.test.js resolve every call site statically.
 * @param {string} name symbol name, e.g. 'drain' or 'food-citrus'
 * @returns {SVGElement}
 */
export function icon(name) {
  const svg = iconShell(`ico ico--${name}`);
  svg.append(svgEl('use', { href: `#ico-${name}` }));
  return svg;
}

/**
 * The icon for a catalog food.
 *
 * Carries NO suitability signal, by construction and by discipline: the 14 food
 * symbols share one circular frame, one stroke weight and `currentColor` only,
 * so nothing here can distinguish a welcome food from a harmful one (§2.7 —
 * discovery is the gameplay). See DESIGN.md and tests/icons.test.js.
 * @param {string} foodId a catalog food id
 * @returns {SVGElement}
 */
export function foodIcon(foodId) {
  return icon(`food-${foodId}`);
}

/**
 * A vessel whose fill tracks a proportion — used on the portion chooser so the
 * four rungs read as sizes and not just as numbers.
 *
 * Leak-free by nature: it reports the PORTION the player picked, which they
 * chose, and knows nothing about which food is going into it.
 * @param {number} fraction 0..1 of the largest offered portion
 * @returns {SVGElement}
 */
export function volumeGlyph(fraction) {
  const f = clamp01(fraction);
  const svg = iconShell('ico-volume');

  // The vessel is a fixed outline; only the level inside it moves. Insetting the
  // level by half the outline's stroke keeps it clear of the wall without a
  // clipPath — which would need a document-unique id per instance.
  const TOP = 4;
  const HEIGHT = 16;
  const INNER_TOP = TOP + 1.5;
  const INNER_HEIGHT = HEIGHT - 3;

  svg.append(
    svgEl('rect', {
      class: 'ico-volume__vessel',
      x: 7,
      y: TOP,
      width: 10,
      height: HEIGHT,
      rx: 2,
    }),
    svgEl('rect', {
      class: 'ico-volume__level',
      x: 8.5,
      y: INNER_TOP + INNER_HEIGHT * (1 - f),
      width: 7,
      height: INNER_HEIGHT * f,
      rx: 1,
    }),
  );
  return svg;
}

/**
 * A progress ring for one queued food's decomposition.
 *
 * The densest information gain available in the panel: the queue rows already
 * printed a percentage, but a ring is readable at a glance across six rows, so
 * the player can see WHICH entry is about to finish without reading any of them.
 * Driven by the sim's own `decompositionFraction` — never re-derived here.
 *
 * Drawn as a dashed circle rather than an arc path: one dash of the full
 * circumference, offset by the unfinished remainder. That keeps it a pure
 * attribute change, so it can transition smoothly instead of being rebuilt.
 * @param {number} fraction 0..1 decomposed
 * @returns {SVGElement}
 */
export function decompositionRing(fraction) {
  const f = clamp01(fraction);
  const svg = iconShell('ico-ring');

  svg.append(
    svgEl('circle', {
      class: 'ico-ring__track',
      cx: 12,
      cy: 12,
      r: RING_RADIUS,
    }),
    svgEl('circle', {
      class: 'ico-ring__arc',
      cx: 12,
      cy: 12,
      r: RING_RADIUS,
      'stroke-dasharray': RING_CIRCUMFERENCE.toFixed(3),
      'stroke-dashoffset': (RING_CIRCUMFERENCE * (1 - f)).toFixed(3),
      // Start the sweep at 12 o'clock; SVG angles begin at 3 o'clock.
      transform: 'rotate(-90 12 12)',
    }),
  );
  return svg;
}
