// Actions panel + DOM internals ("x-ray data") panel for the game screen.
//
// Two responsibilities:
//   1. The action buttons (§2.7): add waste, add sawdust, buy worms, drain,
//      harvest, plus the wall-position slider and the x-ray toggle. Each button
//      dispatches through a callback so `main.js` stays the sole orchestrator —
//      this module never touches the save, the clock, or the sim directly.
//   2. The internals panel: population by stage, the four env gauges, the recent
//      food queue, and humus/leachate fill. It is the numeric gauge layer the
//      3D x-ray (T20) later renders alongside, and the instrument used to read
//      the §2.8 failure chains while tuning.
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
import { listFoods, decompositionFraction } from '../sim/foods.js';
import { getComposter } from '../sim/composters.js';
import { getSpecies, carryingCapacity, PH_COMFORT, TOX_THRESHOLD } from '../sim/worms.js';
import {
  MIN_PORTION_LITERS,
  WORM_PACK_SIZES,
  wormPackPrice,
  absoluteTick,
} from '../sim/engine.js';

/** How many queue entries the panel previews; the rest are counted, not hidden. */
export const QUEUE_PREVIEW_LIMIT = 6;

/** Default waste portion offered in the add-waste dialog (liters). */
const DEFAULT_PORTION_LITERS = 1;

/** Fixed sawdust portion the "add sawdust" button applies (liters). */
const SAWDUST_PORTION_LITERS = 0.5;

// Display domains for the env gauges — the full scale each bar is drawn on.
// These are PRESENTATION ranges only (how wide the bar is), not sim thresholds;
// the comfort bands drawn inside them come from the sim.
const MOISTURE_DOMAIN = { min: 0, max: 1 };
const PH_DOMAIN = { min: 0, max: 14 };
const TOXICITY_DOMAIN = { min: 0, max: 1 };
const TEMPERATURE_DOMAIN = { min: 0, max: 45 };

/** Slack for "full" comparisons on floating-point volumes (matches engine EPS). */
const EPS = 1e-9;

/** Fallback comfort bands for a farm with no species chosen yet. */
const FALLBACK_MOISTURE_BAND = { min: 0.4, max: 0.85 };
const FALLBACK_TEMP_BAND = { min: 10, max: 30 };

// --- Pure helpers (Node-tested) ---------------------------------------------

/** Clamp to [0, 1]. */
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

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
 * Fill descriptor for a bounded tank/tray.
 * @param {number} liters
 * @param {number} capacity
 * @returns {{liters: number, capacity: number, fill: number, full: boolean}}
 */
function fillOf(liters, capacity) {
  return {
    liters,
    capacity,
    fill: capacity > 0 ? clamp01(liters / capacity) : 0,
    full: capacity > 0 && liters >= capacity - EPS,
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

// --- DOM (not unit-tested) ---------------------------------------------------

/** Format a liter volume for display: at most two decimals, no trailing zeros. */
function formatLiters(liters) {
  return `${Math.round(liters * 100) / 100} ${t('common.liters')}`;
}

/** Format a whole-number percentage. */
function formatPercent(fraction) {
  return `${Math.round(fraction * 100)}%`;
}

/** Replace an element's children, tolerating a missing element. */
function fill(id, ...nodes) {
  const el = document.getElementById(id);
  if (el) el.replaceChildren(...nodes);
  return el;
}

/**
 * Build one labelled gauge row: a bar showing the comfort band as a highlighted
 * zone with a marker at the current value.
 * @param {string} labelKey i18n key path
 * @param {Gauge} g
 * @param {string} valueText pre-formatted display value
 * @returns {HTMLElement}
 */
function buildGauge(labelKey, g, valueText) {
  const row = document.createElement('div');
  row.className = 'gauge';
  if (!g.ok) row.classList.add('gauge--alert');

  const label = document.createElement('span');
  label.className = 'gauge__label';
  label.textContent = t(labelKey);

  const value = document.createElement('span');
  value.className = 'gauge__value';
  value.textContent = valueText;

  const bar = document.createElement('div');
  bar.className = 'gauge__bar';

  const comfort = document.createElement('div');
  comfort.className = 'gauge__comfort';
  comfort.style.left = `${g.bandStart * 100}%`;
  comfort.style.width = `${(g.bandEnd - g.bandStart) * 100}%`;

  const marker = document.createElement('div');
  marker.className = 'gauge__marker';
  marker.style.left = `${g.ratio * 100}%`;

  bar.append(comfort, marker);
  row.append(label, value, bar);
  return row;
}

/** Build one `label: value` line for the internals panel. */
function buildStat(labelKey, valueText) {
  const row = document.createElement('div');
  row.className = 'stat';

  const label = document.createElement('span');
  label.className = 'stat__label';
  label.textContent = t(labelKey);

  const value = document.createElement('span');
  value.className = 'stat__value';
  value.textContent = valueText;

  row.append(label, value);
  return row;
}

/**
 * Repaint the internals panel from the current state. Cheap enough to call on
 * every tick; a no-op when the panel is hidden or there is no farm.
 * @param {import('../sim/engine.js').FarmState|null} farm
 */
export function updateInternals(farm) {
  const panel = document.getElementById('internals');
  if (!panel || panel.hidden) return;

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
  const pop = document.createElement('section');
  pop.className = 'internals__group';
  const popTitle = document.createElement('h4');
  popTitle.textContent = t('game.popTitle');
  pop.append(
    popTitle,
    buildStat('game.popCocoons', String(Math.round(snap.population.cocoons))),
    buildStat('game.popJuveniles', String(Math.round(snap.population.juveniles))),
    buildStat('game.popAdults', String(Math.round(snap.population.adults))),
    buildStat(
      'game.popTotal',
      `${Math.round(snap.population.total)} / ${Math.round(snap.population.capacity)}`,
    ),
  );

  // Environment gauges.
  const env = document.createElement('section');
  env.className = 'internals__group';
  const envTitle = document.createElement('h4');
  envTitle.textContent = t('game.envTitle');
  env.append(
    envTitle,
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
  const tanks = document.createElement('section');
  tanks.className = 'internals__group';
  const tanksTitle = document.createElement('h4');
  tanksTitle.textContent = t('game.tanksTitle');
  const humusRow = buildStat(
    'game.humusLabel',
    `${formatLiters(snap.humus.liters)} / ${formatLiters(snap.humus.capacity)}`,
  );
  if (snap.humus.full) humusRow.classList.add('stat--alert');
  const leachateRow = buildStat(
    'game.leachateLabel',
    `${formatLiters(snap.leachate.liters)} / ${formatLiters(snap.leachate.capacity)}`,
  );
  if (snap.leachate.full) leachateRow.classList.add('stat--alert');
  tanks.append(tanksTitle, humusRow, leachateRow);

  // Recent food queue.
  const queue = document.createElement('section');
  queue.className = 'internals__group';
  const queueTitle = document.createElement('h4');
  queueTitle.textContent = t('game.queueTitle');
  queue.append(queueTitle);
  if (snap.queue.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'internals__empty';
    empty.textContent = t('game.queueEmpty');
    queue.append(empty);
  } else {
    for (const entry of snap.queue) {
      queue.append(
        buildStat(
          `foods.${entry.foodId}.name`,
          `${formatLiters(entry.liters)} · ${formatPercent(entry.decomposed)}`,
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
 * @param {string} titleKey i18n key for the heading
 * @param {{value: *, label: string, disabled?: boolean}[]} options
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

    const list = document.createElement('div');
    list.className = 'chooser__options';
    for (const option of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chooser__option';
      button.textContent = option.label;
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
 * @param {(foodId: string, liters: number) => void} onAddWaste
 */
async function promptAddWaste(onAddWaste) {
  const foodId = await chooseFrom(
    'game.chooseFood',
    foodChoices().map((choice) => ({ value: choice.id, label: choice.name })),
  );
  if (!foodId) return;

  const portions = [MIN_PORTION_LITERS, DEFAULT_PORTION_LITERS, 2, 4];
  const liters = await chooseFrom(
    'game.choosePortion',
    portions.map((value) => ({ value, label: formatLiters(value) })),
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

  on('addWaste', () => promptAddWaste(onAddWaste));
  on('addSawdust', () => onAddSawdust(SAWDUST_PORTION_LITERS));
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

  // X-ray toggle: reveals BOTH the numeric internals panel (T14) and the 3D x-ray
  // view (T20) in lockstep — one control, two layers. Purely a view switch: it
  // must never pause or perturb the sim (spec §2.7 / T20 acceptance criterion),
  // so it only flips `hidden`, repaints the panel, and asks main.js to mirror the
  // state into the render layer (which is itself read-only over the sim).
  on('xray', () => {
    const panel = document.getElementById('internals');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    const active = !panel.hidden;
    updateInternals(getFarm());
    onToggleXray?.(active);
  });

  const slider = document.getElementById('wall-position');
  if (slider) {
    const farm = getFarm();
    if (farm) slider.value = String(farm.wallPosition);
    // `input` (not `change`) so the composter tracks the slider live. This is the
    // slider → 3D half of the bidirectional sync (T19): it dispatches the SAME
    // `onMove` action the 3D drag does, and the reverse (3D drag → slider) lands
    // through `syncWallSlider` on the resulting repaint.
    slider.addEventListener('input', () => onMove(Number(slider.value)));
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
}

/**
 * Point the player at the action that clears a full tray/tank (§2.8 edge state):
 * a full humus tray halts processing, a full leachate tank re-saturates the
 * bedding, and the fix is Harvest / Drain respectively. Highlight the button
 * only while the colony is alive — a dead colony's own banner takes precedence,
 * and its levels are frozen anyway. Uses the same capacities/`EPS` the internals
 * "full" readout does, so button and gauge agree.
 * @param {import('../sim/engine.js').FarmState|null} farm
 */
function markActionUrgency(farm) {
  const composter = farm ? getComposter(farm.composterId) : null;
  const alive = !!farm && farm.colonyAlive !== false;
  const trayFull = !!composter && alive && farm.humus >= composter.humusCapacity - EPS;
  const tankFull = !!composter && alive && farm.leachate >= composter.leachateCapacity - EPS;
  const flag = (action, on) => {
    const el = document.querySelector(`[data-action="${action}"]`);
    if (el) el.classList.toggle('actions__btn--urgent', on);
  };
  flag('harvest', trayFull);
  flag('drain', tankFull);
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
