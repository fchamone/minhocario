// Actions panel + DOM internals ("x-ray data") panel for the game screen.
//
// Two responsibilities:
//   1. The action buttons (§2.7): add waste, add sawdust, buy worms, drain,
//      harvest, plus the wall-position slider and the x-ray toggle. Each button
//      dispatches through a callback so `main.js` stays the sole orchestrator —
//      this module never touches the save, the clock, or the sim directly.
//   2. The internals panel: population by stage, the four env gauges, the recent
//      food queue, and humus/leachate fill. It is the numeric gauge layer the
//      3D x-ray (T20) renders alongside, and the instrument used to read the
//      §2.8 failure chains while tuning. It is ALWAYS present and collapses on
//      its own — the x-ray toggle drives only the 3D view. The two used to move
//      in lockstep, which meant the player could not read the numbers without
//      also making the bin translucent.
//
// Layering: a UI module. Display copy comes through the i18n runtime and all
// thresholds come from the pure sim layer (never re-declared here, so retuning
// the sim moves the gauges too). `document` is touched ONLY inside the DOM
// functions below the pure-helper block, so `foodChoices`/`portionValid`/
// `gauge`/`internalsSnapshot` are unit-tested under Node.
//
// SPEC §2.7: the add-waste list mixes suitable and unsuitable foods and must
// NEVER label, group, or reorder by suitability — discovery is the gameplay.
// `foodChoices` therefore exposes only `{id, name}` in raw catalog order, and
// `tests/actions.test.js` guards that.

import { t } from '../strings.js';
import {
  clamp01,
  fillOf,
  formatLiters,
  formatPercent,
  fill,
  buildStat,
  buildGauge,
  buildGroup,
  markFillLevel,
  WARN_FILL,
} from './components.js';
import { foodIcon, volumeGlyph, decompositionRing } from './icons.js';
import { listFoods, decompositionFraction } from '../sim/foods.js';
import { getComposter } from '../sim/composters.js';
import { getSpecies, carryingCapacity, PH_COMFORT, TOX_THRESHOLD } from '../sim/worms.js';
import {
  MIN_PORTION_LITERS,
  WORM_PACK_SIZES,
  wormPackPrice,
  absoluteTick,
  BIN_REFERENCE_CAPACITY,
} from '../sim/engine.js';

// Re-exported for one release (V9): these four primitives moved to
// components.js, and keeping the old names live here means no existing caller
// or test file had to move in the same commit. js/ui/stats.js already imports
// them from their new home.
export { buildStat, fillOf, markFillLevel, WARN_FILL };

/** How many queue entries the panel previews; the rest are counted, not hidden. */
export const QUEUE_PREVIEW_LIMIT = 6;

// --- Capacity-scaled portions ------------------------------------------------
// Portions scale with the bin so upkeep effort stays roughly constant across
// upgrades: a fixed ladder meant filling the 100 L `eco` took ~25 clicks of its
// largest button while the 20 L `electric` overflowed on the same click.
//
// Everything is anchored on `tier2` (30 L): one capacity unit IS a tier2, so the
// two lowest rungs (0.25 L, 1 L) and the 0.5 L sawdust click are unchanged there.
// The ladder no longer coincides with the feeding rate the balance suite
// exercises, and that is worth saying plainly: the suite feeds `cap * 0.06` per
// feeding, and since the mid rung moved from 2 L to 4 L on tier2 NO rung on any
// model lands at 6-7% of capacity. The rungs bracket it — the 1-unit rung is
// 3.1-3.8% of capacity and the 4-unit rung is 12.5-13.8%. Nothing breaks: the
// balance suite calls `addFood` with explicit liters derived from capacity and
// never reads this ladder, so rung changes cannot move it.
//
// The TOP of the ladder is a different problem, and scaling with capacity alone
// did not solve it. Food DEMAND scales with capacity × DENSITY (50 worms/L,
// worms.js) and is then bounded by the engine's per-tick throughput ceiling, so a
// FULL bin's appetite is `binThroughputCeiling(composter, species) × 24` liters
// per game day, while a portion rung is only `capacity × step / 30`. At the old
// 4-unit top rung the rung was ~20-28% of a full `eco` game-day and ~16-22% on
// `electric` — four to six clicks to cover one day of a mature colony. At 10
// units it is a real meal, not a garnish.
//
// Ask the ENGINE for that ceiling (`binThroughputCeiling`), never re-derive it
// here or in a test. The ratio used to be capacity-free — capacity cancelled, so
// a rung's worth depended only on the two speed traits — but T25 made the ceiling
// sublinear in capacity (CAPACITY_THROUGHPUT_FALLOFF), so capacity no longer
// cancels and any hand-copied formula is now wrong in two ways at once.
//
// Where that actually lands, without varnish (californiana, the BEGINNER DEFAULT
// and the pairing a new player has on the 100-coin `tier2`): the top rung runs
// 58% (`electric`) to 124% (`tier2`) of a full-bin game-day, and it EXCEEDS a
// full day on `tier2` (1.24), `buried` (1.16) and `tier3` (1.05). So a single
// top-rung click can outrun a mature default colony's daily appetite. That is
// measured, not assumed, and it was checked before the rung was raised: a fresh
// farm given one top-rung click across seeds 1/7/42 stays survivable on every
// model, which `tests/actions.test.js` now asserts by simulation rather than by
// the ratio proxy it used to mirror (and mirror wrongly). The §2.8 overfeeding
// chain remains a designed failure the player walks into by sustained choice,
// not by one press.
//
// What still bounds a mis-click is the CAPACITY side, which the speed traits do
// not touch: the rung lands at 33-35% of capacity on every model, so no single
// click can take an empty bin past about a third full — which is what keeps it
// clear of `addFood`'s silent capacity clamp (an over-capacity add is trimmed to
// the remaining space and still reported as a plain success, so a rung near a
// whole bin would read as a surprise).
//
// SAWDUST STEP stays at 0.5 units, and that is a decision, not an oversight.
//
// NOTE this rationale was rewritten at T25. It used to read "the sim environment
// is ABSOLUTE, not volume-normalised ... a bigger bin does NOT dilute a feeding",
// and that was true when written — it is exactly the asymmetry T25 fixed. Env
// variables are now CONCENTRATIONS: the engine divides a queue's moisture/pH/
// toxicity load by the bin volume (`envDilution`, js/sim/engine.js), because this
// very ladder made the input scale with capacity while the state variable did
// not, so one top-rung click moved moisture +0.28 on tier2 but +0.43 on eco.
//
// Sawdust still scales on the capacity unit, and the conclusion is unchanged, but
// the REASON is now the opposite one: a bigger bin dilutes food and sawdust
// ALIKE, so the two keep pace only if both are sized in capacity units. Freezing
// sawdust at 0.5 L would now under-dose a large bin just as badly as before.
// What it does NOT need to track is the top rung's widening, because a wider
// ladder changes clicks per day, not LITERS fed per day: the daily moisture load
// is unchanged, so there is nothing new to offset. Sawdust is not a per-feeding
// moisture neutraliser
// either — it removes SAWDUST_DRY_PER_LITER (0.04) moisture/L against food's
// ~0.05 moisture/L released, so cancelling a feeding 1:1 would take ~1.25 L of
// sawdust per liter of food, past any ratio this ladder offers. Percolation plus
// draining the tank is the bin's real water out-path (engine.js FIELD_CAPACITY /
// PERCOLATION_RATE); sawdust is the fine-adjust nudge.
//
// What sawdust IS a neutraliser for is toxicity (SAWDUST_TOX_PER_LITER), and the
// step size is what keeps that lever honest. The scrub is meant to be gated by
// the drying — you should not be able to clean a bin without paying for it in
// moisture — so the step must stay small enough that a player cannot chain
// clicks freely. At 0.5 units one click on `eco` is 1.75 L: -0.07 moisture, or
// 41% of `azul`'s 0.55-0.72 comfort band. Two presses and azul is out of band,
// which is exactly the intended cost. Scaling the step 2.5× with the top rung
// would break that: one `eco` click would become 4 L, -0.16 moisture, swallowing
// azul's entire band in a single press and handing over a consequence-free
// toxicity scrub along with it.

/**
 * Bin capacity the portion ladder is anchored on (liters). Taken from the engine
 * rather than re-declared: the sim's volume normalisation and throughput falloff
 * are anchored on the same bin, and two independent 30s would be free to drift.
 */
const PORTION_ANCHOR_CAPACITY = BIN_REFERENCE_CAPACITY;

/** Multipliers on the capacity unit, ascending — the four offered rungs. */
const PORTION_STEPS = [0.25, 1, 4, 10];

/** Sawdust portion per click, as a multiple of the capacity unit. */
const SAWDUST_STEP = 0.5;

// Display domains for the env gauges — the full scale each bar is drawn on.
// These are PRESENTATION ranges only (how wide the bar is), not sim thresholds;
// the comfort bands drawn inside them come from the sim.
const MOISTURE_DOMAIN = { min: 0, max: 1 };
const PH_DOMAIN = { min: 0, max: 14 };
const TOXICITY_DOMAIN = { min: 0, max: 1 };
const TEMPERATURE_DOMAIN = { min: 0, max: 45 };

/** Fallback comfort bands for a farm with no species chosen yet. */
const FALLBACK_MOISTURE_BAND = { min: 0.4, max: 0.85 };
const FALLBACK_TEMP_BAND = { min: 10, max: 30 };

// --- Pure helpers (Node-tested) ---------------------------------------------

/**
 * The add-waste list: every catalog food as `{id, name}`, in catalog order.
 *
 * Deliberately carries NO suitability signal (§2.7) — no flag, no grouping, no
 * sorting, and no extra fields that could hint at one. The catalog order is
 * already an irregular suitable/harmful mix on purpose (js/sim/foods.js — not a
 * strict parity alternation), so it is passed through untouched.
 * @returns {{id: string, name: string}[]}
 */
export function foodChoices() {
  return listFoods().map((food) => ({ id: food.id, name: t(`foods.${food.id}.name`) }));
}

/**
 * Whether a requested waste portion is acceptable, mirroring the engine's
 * minimum (§2.7) so the UI can reject it before dispatching. Strict about the
 * type — a string from an unparsed input must not slip through.
 * @param {number} liters
 * @returns {boolean}
 */
export function portionValid(liters) {
  return typeof liters === 'number' && Number.isFinite(liters) && liters >= MIN_PORTION_LITERS;
}

/**
 * Snap a raw liter amount to a readable value a player can reason about, on a
 * coarser grid as the number grows (nobody wants a "6.67 L" button). Always at
 * least MIN_PORTION_LITERS, so a snap can never produce an amount the engine
 * would reject.
 * @param {number} liters
 * @returns {number}
 */
function snapLiters(liters) {
  const grid = liters < 2 ? 0.25 : liters < 5 ? 0.5 : 1;
  const snapped = Math.round(liters / grid) * grid;
  // Re-round to kill float dust from the divide (e.g. 0.30000000000000004).
  return Math.max(MIN_PORTION_LITERS, Math.round(snapped * 100) / 100);
}

/**
 * The capacity unit both ladders scale on: 1 for the anchor bin, 2 for a bin
 * twice its size. Falls back to the anchor for a missing/invalid capacity so the
 * UI still offers the historical ladder before a composter exists.
 * @param {number} capacity bin capacity in liters
 * @returns {number}
 */
function capacityUnit(capacity) {
  const cap =
    typeof capacity === 'number' && Number.isFinite(capacity) && capacity > 0
      ? capacity
      : PORTION_ANCHOR_CAPACITY;
  return cap / PORTION_ANCHOR_CAPACITY;
}

/**
 * The waste portions offered for a bin of the given capacity, ascending and
 * deduped. The smallest rung stays at or near MIN_PORTION_LITERS on every bin so
 * precise top-ups remain possible; the largest is sized against a full bin's
 * daily appetite (see the ladder note above), which is well past the rate a
 * young colony can sustain — so a one-click overfeed stays reachable (§2.8's
 * overfeeding chain is a designed failure the player should be able to walk into).
 * @param {number} capacity bin capacity in liters
 * @returns {number[]} 1-4 ascending liter amounts, all >= MIN_PORTION_LITERS
 */
export function portionOptions(capacity) {
  const unit = capacityUnit(capacity);
  const snapped = PORTION_STEPS.map((step) => snapLiters(step * unit));
  // Small bins can snap two rungs onto the same value (both clamped to the
  // minimum); collapse them rather than showing a duplicate button.
  return [...new Set(snapped)].sort((a, b) => a - b);
}

/**
 * The sawdust volume one "add sawdust" click applies for a bin of the given
 * capacity. Scales on the same capacity unit as portionOptions, so an upgrade
 * never weakens the drying lever; it deliberately does NOT track the top rung's
 * width (see the ladder note above for why).
 * @param {number} capacity bin capacity in liters
 * @returns {number} liters, >= MIN_PORTION_LITERS
 */
export function sawdustPortion(capacity) {
  return snapLiters(SAWDUST_STEP * capacityUnit(capacity));
}

/**
 * A gauge descriptor: where a value sits on its display scale, where its comfort
 * band sits on that same scale, and whether the value is inside the band. Ratios
 * are 0..1 fractions of the display domain, ready to drive a CSS width/offset.
 * @typedef {object} Gauge
 * @property {number} value      the raw sim value
 * @property {{min: number, max: number}} band comfort band (raw units)
 * @property {boolean} ok        whether `value` is inside the band (edges count)
 * @property {number} ratio      value's position on the domain, clamped 0..1
 * @property {number} bandStart  band.min's position on the domain, 0..1
 * @property {number} bandEnd    band.max's position on the domain, 0..1
 */

/**
 * Position a value and its comfort band on a display domain. Pure.
 * @param {number} value
 * @param {{min: number, max: number}} band  comfort band in raw units
 * @param {{min: number, max: number}} domain full display scale in raw units
 * @returns {Gauge}
 */
export function gauge(value, band, domain) {
  const span = domain.max - domain.min;
  // A degenerate domain would divide by zero; collapse every ratio to 0 instead
  // of leaking NaN/Infinity into a style attribute.
  const at = (x) => (span > 0 ? clamp01((x - domain.min) / span) : 0);
  const v = Number.isFinite(value) ? value : domain.min;

  return {
    value: v,
    band,
    ok: v >= band.min && v <= band.max,
    ratio: at(v),
    bandStart: at(band.min),
    bandEnd: at(band.max),
  };
}

/**
 * The complete data model behind the internals (x-ray) panel: everything the
 * player can see about the bin's insides, derived from state alone. Pure — a
 * snapshot, so rendering it never perturbs the sim (a T20 acceptance criterion
 * that starts here).
 *
 * Comfort bands come from the chosen species and the shared sim constants, so a
 * gauge reads "out of band" exactly when the sim is stressing the colony.
 * @param {import('../sim/engine.js').FarmState|null|undefined} farm
 * @returns {object|null} null when there is no farm to inspect
 */
export function internalsSnapshot(farm) {
  if (!farm) return null;

  const composter = getComposter(farm.composterId);
  const species = getSpecies(farm.speciesId);
  const { cocoons, juveniles, adults } = farm.population;
  const now = absoluteTick(farm);

  // Newest-first: the panel is a "what did I just add" readout. The sim keeps
  // the queue oldest-first (consumption order), so this is a reversed view —
  // the underlying array is never mutated.
  const ordered = [...farm.queue].reverse();

  return {
    // Which bin the player is looking inside — the panel names it, so an
    // upgrade is visible in the readout as well as in the 3D scene.
    composterId: composter ? composter.id : null,
    capacity: composter ? composter.capacity : 0,
    population: {
      cocoons,
      juveniles,
      adults,
      total: cocoons + juveniles + adults,
      capacity: carryingCapacity(composter),
    },
    env: {
      moisture: gauge(
        farm.env.moisture,
        species ? species.moistureComfort : FALLBACK_MOISTURE_BAND,
        MOISTURE_DOMAIN,
      ),
      ph: gauge(farm.env.ph, PH_COMFORT, PH_DOMAIN),
      toxicity: gauge(farm.env.toxicity, { min: 0, max: TOX_THRESHOLD }, TOXICITY_DOMAIN),
      temperature: gauge(
        farm.env.temperature,
        species ? species.tempComfort : FALLBACK_TEMP_BAND,
        TEMPERATURE_DOMAIN,
      ),
    },
    queue: ordered.slice(0, QUEUE_PREVIEW_LIMIT).map((entry) => {
      const ageTicks = now - entry.addedAtTick;
      return {
        foodId: entry.foodId,
        liters: entry.liters,
        ageTicks,
        decomposed: decompositionFraction(ageTicks),
      };
    }),
    queueHidden: Math.max(0, ordered.length - QUEUE_PREVIEW_LIMIT),
    humus: fillOf(farm.humus, composter ? composter.humusCapacity : 0),
    leachate: fillOf(farm.leachate, composter ? composter.leachateCapacity : 0),
  };
}

// --- Internals panel placement -----------------------------------------------
// The panel overlays the stage, so it can end up on top of the composter itself.
// The bin's on-screen position is driven entirely by `wallPosition` (0 = pushed
// to the far left of the usable span, 1 = far right), so the side to dodge to is
// a pure function of that number — no camera projection needed, and it stays
// testable under Node. The render layer's camera/canvas/span are module-private
// by design; reaching for them here would couple UI to render for no gain.

/** Below this the bin is far enough left that the left-anchored panel overlaps. */
const INTERNALS_FLIP_TO_RIGHT = 0.35;

/** Above this the bin has cleared the left anchor and the panel can come home. */
const INTERNALS_FLIP_TO_LEFT = 0.5;

/**
 * Which side of the stage the internals panel should sit on, given where the
 * player has slid the composter. Pure.
 *
 * The two thresholds deliberately do NOT coincide: a single threshold would make
 * the panel flap left/right on every pointer sample while a drag hovers around
 * it, since `input` fires continuously. The dead band between
 * `INTERNALS_FLIP_TO_RIGHT` and `INTERNALS_FLIP_TO_LEFT` resolves to `current`
 * instead, so the panel only moves once per crossing and then stays put — the
 * player has to drag meaningfully past the flip point to move it back.
 *
 * Callers pass the side the panel is on RIGHT NOW (read back off the DOM), which
 * is what gives the hysteresis its state; this function keeps none of its own.
 * @param {number} wallPosition  0..1 slider/drag position of the composter
 * @param {'left'|'right'} [current='left']  side the panel currently occupies
 * @returns {'left'|'right'} side the panel should occupy
 */
export function internalsSide(wallPosition, current = 'left') {
  // A non-number (or NaN/Infinity) means we cannot know where the bin is —
  // fall back to the CSS default rather than pinning the panel somewhere odd.
  if (typeof wallPosition !== 'number' || !Number.isFinite(wallPosition)) return 'left';
  if (wallPosition < INTERNALS_FLIP_TO_RIGHT) return 'right';
  if (wallPosition > INTERNALS_FLIP_TO_LEFT) return 'left';
  return current === 'right' ? 'right' : 'left';
}

// --- DOM (not unit-tested) ---------------------------------------------------
// The readout primitives this panel renders with — buildStat, buildGauge,
// buildGroup, markFillLevel, fill and the formatters — live in components.js,
// shared with the statistics box. See the note at the top of that file for what
// had drifted before they were consolidated.

/**
 * Move the internals panel out from under the composter. Reads the side the
 * panel is on back off its own class list so `internalsSide`'s hysteresis has
 * real state to compare against (see the dead-band note there), then writes the
 * decision back as a class. Called from every path that changes `wallPosition`
 * so the panel tracks a live drag, not just the next repaint.
 * @param {number} wallPosition
 */
function placeInternals(wallPosition) {
  const panel = document.getElementById('internals');
  if (!panel) return;
  const current = panel.classList.contains('internals--right') ? 'right' : 'left';
  panel.classList.toggle('internals--right', internalsSide(wallPosition, current) === 'right');
}

/**
 * Whether the 3D x-ray view is on. Module-local because it is a pure VIEW
 * preference: it never enters the farm state or the save (the sim knows nothing
 * about it), so it resets to off on reload — the same contract the stats box's
 * open/closed state has. Before the panel was decoupled this flag did not exist
 * at all; "is x-ray on" was read back off the panel's `hidden` attribute, which
 * stopped being a truth source the moment the panel became always-visible.
 */
let xrayActive = false;

/**
 * The last state handed to `updateInternals`, kept so re-opening a collapsed
 * panel can repaint immediately. Without it, expanding the panel while the clock
 * is paused would show whatever was there before it was collapsed (or nothing at
 * all) until the next tick or player action — which reads as a broken panel.
 * Mirrors the same mechanism in js/ui/stats.js.
 */
let lastInternals = null;

/** True once the collapse/expand listener is attached (attach exactly once). */
let internalsToggleWired = false;

/**
 * Repaint the internals panel from the current state. Cheap enough to call on
 * every tick; a no-op when the player has collapsed the panel (a closed
 * `<details>` renders nothing worth building) or there is no farm.
 * @param {import('../sim/engine.js').FarmState|null} farm
 */
export function updateInternals(farm) {
  const panel = document.getElementById('internals');
  if (!panel) return;

  lastInternals = farm;
  if (!internalsToggleWired) {
    internalsToggleWired = true;
    panel.addEventListener('toggle', () => updateInternals(lastInternals));
  }
  if (!panel.open) return;

  if (farm) placeInternals(farm.wallPosition);

  const snap = internalsSnapshot(farm);
  if (!snap) {
    fill('internals-body');
    return;
  }

  const body = document.createElement('div');

  // Which bin this is: model name + total volume. Rendered into the body (not
  // the static heading) so it follows a mid-farm upgrade automatically.
  if (snap.composterId) {
    const model = document.createElement('p');
    model.className = 'internals__model';
    model.textContent =
      `${t(`composters.${snap.composterId}.name`)} · ${snap.capacity} ${t('common.liters')}`;
    body.append(model);
  }

  // Population by stage, against carrying capacity.
  const pop = buildGroup(
    'internals',
    'game.popTitle',
    buildStat('game.popCocoons', String(Math.round(snap.population.cocoons))),
    buildStat('game.popJuveniles', String(Math.round(snap.population.juveniles))),
    buildStat('game.popAdults', String(Math.round(snap.population.adults))),
    buildStat(
      'game.popTotal',
      `${Math.round(snap.population.total)} / ${Math.round(snap.population.capacity)}`,
    ),
  );

  // Environment gauges.
  const env = buildGroup(
    'internals',
    'game.envTitle',
    buildGauge('game.envMoisture', snap.env.moisture, formatPercent(snap.env.moisture.value)),
    buildGauge('game.envPh', snap.env.ph, snap.env.ph.value.toFixed(1)),
    buildGauge('game.envToxicity', snap.env.toxicity, formatPercent(snap.env.toxicity.value)),
    buildGauge(
      'game.envTemperature',
      snap.env.temperature,
      `${snap.env.temperature.value.toFixed(1)} °C`,
    ),
  );

  // Humus / leachate fill.
  const humusRow = buildStat(
    'game.humusLabel',
    `${formatLiters(snap.humus.liters)} / ${formatLiters(snap.humus.capacity)}`,
  );
  markFillLevel(humusRow, snap.humus, 'stat');
  const leachateRow = buildStat(
    'game.leachateLabel',
    `${formatLiters(snap.leachate.liters)} / ${formatLiters(snap.leachate.capacity)}`,
  );
  markFillLevel(leachateRow, snap.leachate, 'stat');
  const tanks = buildGroup('internals', 'game.tanksTitle', humusRow, leachateRow);

  // Recent food queue.
  const queue = buildGroup('internals', 'game.queueTitle');
  if (snap.queue.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'internals__empty';
    empty.textContent = t('game.queueEmpty');
    queue.append(empty);
  } else {
    for (const entry of snap.queue) {
      // The ring reports the SAME `decomposed` fraction the percentage beside it
      // prints, so the glyph and the number cannot disagree — both come from the
      // sim's `decompositionFraction` via the snapshot, never re-derived here.
      queue.append(
        buildStat(
          `foods.${entry.foodId}.name`,
          `${formatLiters(entry.liters)} · ${formatPercent(entry.decomposed)}`,
          decompositionRing(entry.decomposed),
        ),
      );
    }
    if (snap.queueHidden > 0) {
      const more = document.createElement('p');
      more.className = 'internals__empty';
      more.textContent = `+${snap.queueHidden} ${t('game.queueMore')}`;
      queue.append(more);
    }
  }

  body.append(pop, env, tanks, queue);
  fill('internals-body', body);
}

/**
 * Show a transient feedback line in the actions panel (harvest yield, rejected
 * purchase, etc.). Replaces any previous message.
 * @param {string} message already-localized text
 * @param {boolean} [isError] style it as a rejection
 */
export function showFeedback(message, isError = false) {
  const el = document.getElementById('action-feedback');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('actions__feedback--error', isError);
  // Re-trigger the entrance animation on every message so a repeated outcome
  // (two rejected clicks in a row) is still visibly acknowledged. Removing then
  // re-adding the class with a forced reflow in between restarts the animation.
  el.classList.remove('actions__feedback--flash');
  void el.offsetWidth;
  el.classList.add('actions__feedback--flash');
}

/**
 * Open a modal chooser and resolve with the picked value (or null on cancel).
 * Built from a `<dialog>` so Escape and the backdrop behave natively.
 *
 * An option may carry an `icon` node, rendered ahead of its label. Options are
 * built here with `t()` already applied, so nothing in this dialog carries
 * `data-string` and `applyStrings()` cannot wipe an icon out of it.
 * @param {string} titleKey i18n key for the heading
 * @param {{value: *, label: string, disabled?: boolean, icon?: Node}[]} options
 * @returns {Promise<*|null>}
 */
function chooseFrom(titleKey, options) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('chooser');
    if (!dialog) {
      resolve(null);
      return;
    }

    // Resolution is driven by the dialog's own `close` event, NOT by the click
    // handler. `close()` fires that event ASYNCHRONOUSLY (it is queued as a
    // task), so resolving eagerly would let this prompt's queued event land on
    // the NEXT prompt's listener — the two prompts share one <dialog> element.
    // That is what made the portion chooser open and shut instantly after a
    // food was picked. Waiting for the event keeps sequential prompts serialized:
    // the listener detaches as the event is delivered, so nothing is left queued.
    let picked = null;
    const onClose = () => {
      dialog.removeEventListener('close', onClose);
      resolve(picked);
    };
    // Also covers Escape / backdrop dismissal, which resolve as a cancel (null).
    dialog.addEventListener('close', onClose);
    const finish = (value) => {
      picked = value;
      dialog.close();
    };

    const title = document.createElement('h3');
    title.textContent = t(titleKey);

    // A tiled prompt needs a definite width or its grid collapses to one column
    // (see `.chooser--grid`). Toggled per prompt because the same <dialog> also
    // serves text-only prompts, which should stay shrink-wrapped and compact.
    dialog.classList.toggle('chooser--grid', options.some((option) => option.icon));

    const list = document.createElement('div');
    list.className = 'chooser__options';
    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      // An option with a glyph becomes a TILE: the glyph stacks above the label
      // instead of sitting beside it. That is what lets the icon be large enough
      // to actually read, and it also pins the glyph to the same spot in every
      // cell — in a side-by-side row a two-line food name shifts its neighbour's
      // icon, and irregular placement is its own grouping cue across 14 items.
      button.className = option.icon ? 'chooser__option chooser__option--tile' : 'chooser__option';
      const label = document.createElement('span');
      label.textContent = option.label;
      if (option.icon) button.append(option.icon);
      button.append(label);
      button.disabled = Boolean(option.disabled);
      if (!option.disabled) button.addEventListener('click', () => finish(option.value));
      list.append(button);
    }

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'chooser__cancel';
    cancel.textContent = t('common.cancel');
    cancel.addEventListener('click', () => finish(null));

    dialog.replaceChildren(title, list, cancel);
    dialog.showModal();
  });
}

/**
 * Ask which waste to add and how much, then dispatch it.
 * The food list is rendered EXACTLY as `foodChoices` returns it — no grouping,
 * no sorting, no annotation (§2.7).
 * @param {number} capacity current bin capacity, which sizes the portion ladder.
 * @param {(foodId: string, liters: number) => void} onAddWaste
 */
async function promptAddWaste(capacity, onAddWaste) {
  // Icons are attached in the SAME pass that renders the names, straight off
  // `foodChoices()`, so the list still has exactly one ordering and no food can
  // acquire a decoration another one lacks (§2.7).
  const foodId = await chooseFrom(
    'game.chooseFood',
    foodChoices().map((choice) => ({
      value: choice.id,
      label: choice.name,
      icon: foodIcon(choice.id),
    })),
  );
  if (!foodId) return;

  const portions = portionOptions(capacity);
  // The glyph is relative to the LARGEST rung offered for this bin, so the four
  // buttons read as a ladder. Against an absolute scale every rung on a small
  // bin would look empty and the comparison — which is the whole point — would
  // be lost.
  const largest = portions[portions.length - 1];
  const liters = await chooseFrom(
    'game.choosePortion',
    portions.map((value) => ({
      value,
      label: formatLiters(value),
      icon: volumeGlyph(largest > 0 ? value / largest : 0),
    })),
  );
  if (!portionValid(liters)) return;

  onAddWaste(foodId, liters);
}

/**
 * Ask which worm pack to buy, disabling packs the wallet cannot cover, then
 * dispatch it.
 * @param {string|null} speciesId the farm's species
 * @param {number} wallet
 * @param {(packSize: number) => void} onBuyWorms
 */
async function promptBuyWorms(speciesId, wallet, onBuyWorms) {
  const species = getSpecies(speciesId);
  if (!species) {
    showFeedback(t('game.noSpecies'), true);
    return;
  }

  const packSize = await chooseFrom(
    'game.chooseWormPack',
    WORM_PACK_SIZES.map((size) => {
      const price = wormPackPrice(speciesId, size);
      return {
        value: size,
        label: `${size} · ${price} ${t('common.coins')}`,
        disabled: !(wallet >= price),
      };
    }),
  );
  if (!packSize) return;

  onBuyWorms(packSize);
}

/**
 * Ask the player to confirm a destructive action. Reuses the modal chooser, so
 * Escape and the backdrop both read as "no".
 * @param {string} messageKey i18n key for the question
 * @returns {Promise<boolean>}
 */
async function confirmAction(messageKey) {
  const answer = await chooseFrom(messageKey, [{ value: true, label: t('common.confirm') }]);
  return answer === true;
}

/**
 * Wire the actions panel. Every button dispatches through a callback — this
 * module never mutates the sim or the save itself, so `main.js` remains the
 * single orchestrator (and the single autosave point).
 *
 * @param {object} deps
 * @param {() => import('../sim/engine.js').FarmState|null} deps.getFarm current farm.
 * @param {() => number} deps.getWallet current coins.
 * @param {(foodId: string, liters: number) => void} deps.onAddWaste
 * @param {(liters: number) => void} deps.onAddSawdust
 * @param {(packSize: number) => void} deps.onBuyWorms
 * @param {() => void} deps.onDrain
 * @param {() => void} deps.onHarvest
 * @param {(position: number) => void} deps.onMove wall position 0..1.
 * @param {() => void} deps.onRestart end this run and start a new one.
 * @param {(active: boolean) => void} [deps.onToggleXray] mirror the x-ray toggle
 *   into the 3D scene (translucent shell + internals overlay). Optional so the
 *   DOM internals panel works even without a render layer.
 */
export function initActions(deps) {
  const {
    getFarm,
    getWallet,
    onAddWaste,
    onAddSawdust,
    onBuyWorms,
    onDrain,
    onHarvest,
    onMove,
    onRestart,
    onToggleXray,
  } = deps;

  const on = (action, handler) => {
    const el = document.querySelector(`[data-action="${action}"]`);
    if (el) el.addEventListener('click', handler);
  };

  // Both waste and sawdust amounts are sized from the CURRENT bin, resolved at
  // click time rather than captured here — the player can upgrade mid-run and the
  // ladder has to follow the migration without re-initialising the panel.
  const currentCapacity = () => getComposter(getFarm()?.composterId)?.capacity ?? 0;

  on('addWaste', () => promptAddWaste(currentCapacity(), onAddWaste));
  on('addSawdust', () => onAddSawdust(sawdustPortion(currentCapacity())));
  on('addWorms', () => promptBuyWorms(getFarm()?.speciesId ?? null, getWallet(), onBuyWorms));
  on('drain', onDrain);
  on('harvest', onHarvest);

  // The dead-colony banner's CTA is the same worm purchase as the panel button;
  // buying into a dead colony is what repopulates it (§2.1 — the engine resets
  // colonyAlive and the age multiplier).
  on('repopulate', () => promptBuyWorms(getFarm()?.speciesId ?? null, getWallet(), onBuyWorms));

  // Restarting discards the running farm, so it always asks first (§2.1).
  on('restart', async () => {
    if (await confirmAction('game.restartConfirm')) onRestart();
  });

  // X-ray toggle: drives ONLY the 3D view (T20) — the translucent shell and the
  // rendered internals overlay. It deliberately does NOT touch the DOM internals
  // panel, which is always available and collapses on its own (see the panel's
  // note in index.html): reading the numbers and seeing through the bin are two
  // separate wants, and one button cannot serve both.
  //
  // Purely a view switch: it must never pause or perturb the sim (spec §2.7 /
  // T20 acceptance criterion), so it only flips a local flag and asks main.js to
  // mirror it into the render layer (which is itself read-only over the sim).
  //
  // The button carries its own pressed state because it no longer has any DOM
  // side effect to serve as feedback: `setXrayView` is a silent no-op when WebGL
  // is unavailable, so without this the control would look dead.
  on('xray', () => {
    xrayActive = !xrayActive;
    const btn = document.querySelector('[data-action="xray"]');
    if (btn) {
      btn.setAttribute('aria-pressed', String(xrayActive));
      btn.classList.toggle('is-active', xrayActive);
    }
    onToggleXray?.(xrayActive);
  });

  const slider = document.getElementById('wall-position');
  if (slider) {
    const farm = getFarm();
    if (farm) {
      slider.value = String(farm.wallPosition);
      placeInternals(farm.wallPosition);
    }
    // `input` (not `change`) so the composter tracks the slider live. This is the
    // slider → 3D half of the bidirectional sync (T19): it dispatches the SAME
    // `onMove` action the 3D drag does, and the reverse (3D drag → slider) lands
    // through `syncWallSlider` on the resulting repaint.
    slider.addEventListener('input', () => {
      const next = Number(slider.value);
      // Reposition from the slider value directly rather than waiting for the
      // repaint, so the panel gets out of the way during the drag itself.
      placeInternals(next);
      onMove(next);
    });
  }
}

/**
 * State → slider half of the wall-position bidirectional sync (T19): reflect the
 * live `wallPosition` on the range input so a 3D drag moves the thumb. Skipped
 * while the slider itself has focus, so dragging the slider is never fought by a
 * same-tick repaint; a 3D drag focuses the canvas (not the slider), so it flows
 * through here.
 * @param {import('../sim/engine.js').FarmState|null} farm
 */
function syncWallSlider(farm) {
  const slider = document.getElementById('wall-position');
  if (slider && farm && document.activeElement !== slider) {
    slider.value = String(farm.wallPosition);
  }
  // Outside the focus guard: a 3D drag moves the bin without touching the
  // slider, and the panel has to dodge that too.
  if (farm) placeInternals(farm.wallPosition);
}

/**
 * Point the player at the action that clears a filling or full tray/tank (§2.8
 * edge state): a full humus tray halts processing, a full leachate tank
 * re-saturates the bedding, and the fix is Harvest / Drain respectively.
 *
 * Two tiers, matching the readouts: yellow from `WARN_FILL` (act soon, nothing
 * broken yet) and the red pulse at full (production is already suffering). The
 * button and the gauge are driven by the SAME `fillOf` descriptor, so they can
 * never disagree about which tier the bin is in.
 *
 * Highlighted only while the colony is alive — a dead colony's own banner takes
 * precedence, and its levels are frozen anyway.
 * @param {import('../sim/engine.js').FarmState|null} farm
 */
function markActionUrgency(farm) {
  const composter = farm ? getComposter(farm.composterId) : null;
  const alive = !!farm && farm.colonyAlive !== false;
  const none = { warn: false, full: false };
  const tray = composter && alive ? fillOf(farm.humus, composter.humusCapacity) : none;
  const tank = composter && alive ? fillOf(farm.leachate, composter.leachateCapacity) : none;
  const flag = (action, f) => {
    const el = document.querySelector(`[data-action="${action}"]`);
    if (el) markFillLevel(el, f, 'actions__btn');
  };
  flag('harvest', tray);
  flag('drain', tank);
}

/**
 * Reflect current state in the actions panel: sync the slider (e.g. after a
 * load, or from a 3D drag) and repaint the internals panel if it is open.
 * @param {import('../sim/engine.js').FarmState|null} farm
 */
export function updateActions(farm) {
  syncWallSlider(farm);

  // Dead-colony banner: production has stopped and repopulating is the only way
  // forward (§2.1). Driven purely by state, so it clears itself the moment a
  // worm pack revives the colony.
  const banner = document.getElementById('colony-dead');
  if (banner) banner.hidden = !farm || farm.colonyAlive !== false;

  markActionUrgency(farm);
  updateInternals(farm);
}
