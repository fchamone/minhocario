// Shared readout primitives for the game-screen panels.
//
// The internals panel (js/ui/actions.js) and the statistics box (js/ui/stats.js)
// render the same three shapes — a `label: value` stat row, a gauge bar, and a
// titled group — and before this module existed each carried its own copy. The
// copies had already started to drift apart:
//
//   - `formatLiters` was defined identically in both files.
//   - `buildGauge` (actions.js) and `buildFillBar` (stats.js) were near-identical
//     unmerged siblings, each constructing the whole `.gauge` row from scratch.
//   - `buildGroup` existed only in stats.js, while actions.js inlined the same
//     `section.internals__group` + `<h4>` pattern FOUR times.
//
// That matters beyond tidiness: the two panels report the SAME numbers, and the
// tabular-nums alignment plus the two-tier warn/alert colouring only hold if both
// emit the same markup. A drifted copy shows the same litre count in two shapes.
//
// Layering: a UI module. `document` is touched ONLY inside the builders, so the
// pure helpers above them stay importable and testable under Node — the same
// split actions.js and stats.js already keep.
//
// The two gauge variants deliberately share one skeleton rather than collapsing
// into a single function with a mode flag: the `.gauge` grid, its label/value
// line and its `.gauge__bar` track are authored here ONCE, and the variants
// differ only in what goes inside the track. `tests/components.test.js` fails if
// a second module starts building any of this markup again.

import { t } from '../strings.js';

// --- Pure helpers (Node-tested) ---------------------------------------------

/** Slack for "full" comparisons on floating-point volumes (matches engine EPS). */
const EPS = 1e-9;

/**
 * Clamp to [0, 1]. Lives here rather than in either panel because both need it
 * and a second copy is exactly the drift this module exists to end.
 * @param {number} x
 * @returns {number}
 */
export function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Fraction of a tray/tank at which it starts reading as "filling up" and the
 * readout turns from calm to yellow. A FRACTION, not a volume: the catalog spans
 * 5x from the electric bin's 8 L tray to eco's 40 L (and 4 L to 20 L of tank), so
 * any absolute margin that gave a small bin useful warning would fire almost
 * immediately on a large one.
 *
 * The point of the tier is LEAD TIME. `full` already exists and is where the
 * §2.8 chains actually bite — a full tray halts processing, a full tank
 * re-saturates the bedding — but by then the damage has started; at 0.7 there is
 * still a comfortable margin to harvest or drain in.
 */
export const WARN_FILL = 0.7;

/**
 * Fill descriptor for a bounded tank/tray. Shared by both panels so the two
 * readouts cannot disagree about what "full" or "filling up" means — they used
 * to carry independent copies of this.
 *
 * `warn` and `full` are MUTUALLY EXCLUSIVE by construction: a full tray is not
 * "approaching full", it has arrived, and the two states carry different colours
 * and different urgency. Rendering both at once would stack a yellow rule and a
 * red one on the same node and let source order decide the winner.
 * @param {number} liters
 * @param {number} capacity
 * @returns {{liters: number, capacity: number, fill: number, warn: boolean, full: boolean}}
 */
export function fillOf(liters, capacity) {
  const fill = capacity > 0 ? clamp01(liters / capacity) : 0;
  const full = capacity > 0 && liters >= capacity - EPS;
  return {
    liters,
    capacity,
    fill,
    // Same `EPS` slack the `full` comparison uses, for the same reason: a level
    // computed as `capacity * WARN_FILL` does not necessarily divide back to
    // exactly WARN_FILL in binary floating point (12 * 0.7 = 8.399999999999999,
    // which is a hair UNDER the threshold), so a bare `>=` would silently skip
    // the tier for whole families of capacities.
    warn: !full && capacity > 0 && fill >= WARN_FILL - EPS,
    full,
  };
}

/**
 * Format a liter volume for display: at most two decimals, no trailing zeros.
 * @param {number} liters
 * @returns {string}
 */
export function formatLiters(liters) {
  return `${Math.round(liters * 100) / 100} ${t('common.liters')}`;
}

/**
 * Format a whole-number percentage.
 * @param {number} fraction 0..1
 * @returns {string}
 */
export function formatPercent(fraction) {
  return `${Math.round(fraction * 100)}%`;
}

// --- DOM builders (not unit-tested) -----------------------------------------

/**
 * Replace an element's children, tolerating a missing element.
 * @param {string} id
 * @param {...Node} nodes
 * @returns {HTMLElement|null}
 */
export function fill(id, ...nodes) {
  const el = document.getElementById(id);
  if (el) el.replaceChildren(...nodes);
  return el;
}

/**
 * Build one `label: value` line. Both panels use it, which is what keeps them
 * typographically identical — the tabular-nums alignment in particular only
 * holds if every readout emits this markup.
 *
 * `lead` is an optional glyph placed BEFORE the label text, inside the label
 * span (the internals queue uses it for the decomposition ring). It is appended
 * as a node rather than set as text, and the label carries no `data-string`, so
 * `applyStrings()` has nothing here to wipe — the copy is already resolved
 * through `t()` at build time.
 * @param {string} labelKey i18n key path
 * @param {string} valueText pre-formatted display value
 * @param {Node} [lead] optional glyph rendered ahead of the label
 * @returns {HTMLElement}
 */
export function buildStat(labelKey, valueText, lead) {
  const row = document.createElement('div');
  row.className = 'stat';

  const label = document.createElement('span');
  label.className = 'stat__label';
  const text = document.createElement('span');
  text.textContent = t(labelKey);
  if (lead) label.append(lead);
  label.append(text);

  const value = document.createElement('span');
  value.className = 'stat__value';
  value.textContent = valueText;

  row.append(label, value);
  return row;
}

/**
 * The skeleton both gauge variants are built on: the `.gauge` grid with its
 * label, its value, and an empty `.gauge__bar` track. Private — callers reach it
 * through `buildGauge` or `buildFillBar`, which differ only in what they put
 * inside the track and how they mark the row's state.
 * @param {string} labelKey i18n key path
 * @param {string} valueText pre-formatted display value
 * @returns {{row: HTMLElement, bar: HTMLElement}}
 */
function gaugeRow(labelKey, valueText) {
  const row = document.createElement('div');
  row.className = 'gauge';

  const label = document.createElement('span');
  label.className = 'gauge__label';
  label.textContent = t(labelKey);

  const value = document.createElement('span');
  value.className = 'gauge__value';
  value.textContent = valueText;

  const bar = document.createElement('div');
  bar.className = 'gauge__bar';

  row.append(label, value, bar);
  return { row, bar };
}

/**
 * A banded gauge: the comfort band drawn as a highlighted zone with a marker at
 * the current value. Used for the env variables, which have a comfortable middle
 * and are wrong in BOTH directions.
 * @param {string} labelKey i18n key path
 * @param {import('./actions.js').Gauge} g
 * @param {string} valueText pre-formatted display value
 * @returns {HTMLElement}
 */
export function buildGauge(labelKey, g, valueText) {
  const { row, bar } = gaugeRow(labelKey, valueText);
  if (!g.ok) row.classList.add('gauge--alert');

  const comfort = document.createElement('div');
  comfort.className = 'gauge__comfort';
  comfort.style.left = `${g.bandStart * 100}%`;
  comfort.style.width = `${(g.bandEnd - g.bandStart) * 100}%`;

  const marker = document.createElement('div');
  marker.className = 'gauge__marker';
  marker.style.left = `${g.ratio * 100}%`;

  bar.append(comfort, marker);
  return row;
}

/**
 * A band-less gauge: the track filled from the left to the current level. Used
 * for the humus tray and leachate tank, which have no "too empty" edge — they
 * only matter as they approach full (§2.8).
 * @param {string} labelKey i18n key path
 * @param {{fill: number, warn: boolean, full: boolean}} f descriptor from `fillOf`
 * @param {string} valueText pre-formatted display value
 * @returns {HTMLElement}
 */
export function buildFillBar(labelKey, f, valueText) {
  const { row, bar } = gaugeRow(labelKey, valueText);
  markFillLevel(row, f, 'gauge');

  const level = document.createElement('div');
  level.className = 'gauge__fill';
  level.style.width = `${f.fill * 100}%`;

  bar.append(level);
  return row;
}

/**
 * Build a titled group section. The BEM block is a parameter because the two
 * panels namespace their sections differently (`.internals__group` /
 * `.stats__group`) while the structure is identical — which is why actions.js
 * ended up inlining this four times instead of reusing stats.js's copy.
 * @param {'internals'|'stats'} block BEM block name to prefix
 * @param {string} titleKey i18n key path
 * @param {...Node} rows
 * @returns {HTMLElement}
 */
export function buildGroup(block, titleKey, ...rows) {
  const section = document.createElement('section');
  section.className = `${block}__group`;

  const title = document.createElement('h4');
  title.textContent = t(titleKey);

  section.append(title, ...rows);
  return section;
}

/**
 * Paint a row with the two-tier fill state of the tray/tank it reports: yellow
 * while it is filling up, red once it is full. Shared by the `stat` rows and the
 * `gauge` fill bars (hence the block-name argument) so a single descriptor
 * drives every readout of the same number identically.
 *
 * Both classes are toggled on every call rather than only added, so a row reused
 * across repaints cannot keep a stale tier after the player harvests or drains.
 * @param {HTMLElement} row
 * @param {{warn: boolean, full: boolean}} f descriptor from `fillOf`
 * @param {'stat'|'gauge'|'actions__btn'} block BEM block name to suffix
 */
export function markFillLevel(row, f, block) {
  row.classList.toggle(`${block}--warn`, f.warn);
  row.classList.toggle(`${block}--alert`, f.full);
}
