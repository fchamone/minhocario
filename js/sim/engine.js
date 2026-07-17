// Core simulation engine. PURE module: no DOM, no Three.js, no browser globals.
// `tick(state, rng)` advances the farm by one game hour and returns a NEW state.
//
// The full FarmState shape is defined here as a JSDoc typedef; later tasks fill
// in the currently-stubbed subsystems (food queue, population, production,
// scoring). As of T3 tick advances the clock and updates bin temperature.

import { getComposter } from './composters.js';
import { getFood, queueDynamics } from './foods.js';
import {
  ambientTemperature,
  solarGain,
  fermentationHeat,
  blendTemperature,
} from './temperature.js';

/** Smallest waste portion the player may add, in liters (§2.7). */
export const MIN_PORTION_LITERS = 0.25;

// Bin-environment dynamics constants (§2.5). First-pass; tuned at T8/T21.
const NEUTRAL_PH = 7; // pH the bin eases back toward when nothing pushes it
const PH_DRIFT_RATE = 0.02; // fraction of the gap to neutral closed per tick
const TOX_DECAY_RATE = 0.001; // per-tick toxicity decay — deliberately very slow
const SAWDUST_DRY_PER_LITER = 0.03; // moisture removed per liter of sawdust added

/** Clamp to [0, 1]. */
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Clamp to [lo, hi]. */
function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * A single food item decomposing in the bin.
 * @typedef {object} FoodEntry
 * @property {string} foodId    catalog id (js/sim/foods.js)
 * @property {number} liters    portion volume in liters
 * @property {number} addedAtTick absolute tick index when it was added
 */

/**
 * Three-stage worm cohort counts (§2.4). Stubbed at zero until T5.
 * @typedef {object} Population
 * @property {number} cocoons
 * @property {number} juveniles
 * @property {number} adults
 */

/**
 * Bin-wide environment variables (§2.5); each has a comfort band. Stubbed at
 * neutral defaults until T3/T4 drive them.
 * @typedef {object} BinEnv
 * @property {number} moisture    0..1 water fraction
 * @property {number} ph          0..14
 * @property {number} toxicity    0..1 accumulated, decays slowly
 * @property {number} temperature degrees Celsius
 */

/**
 * The complete, JSON-serializable simulation state. Stored under `farm` in the
 * versioned save (js/storage.js). Contains only plain JSON types so it
 * round-trips losslessly and stays deterministic across save/load.
 * @typedef {object} FarmState
 * @property {number} day           game day, starts at 1
 * @property {number} hour          hour of day, 0..23
 * @property {number} rngState      serializable RNG state (js/sim/rng.js)
 * @property {string|null} composterId chosen composter model (catalog id)
 * @property {string|null} speciesId   chosen worm species (catalog id)
 * @property {number} wallPosition  position along the garage wall, 0..1
 * @property {Population} population
 * @property {BinEnv} env
 * @property {FoodEntry[]} queue    food items decomposing, oldest first
 * @property {number} humus         humus accrued in the tray (liters)
 * @property {number} leachate      leachate accrued in the tank (liters)
 * @property {number} colonyAgeDays days since the current colony started
 * @property {boolean} colonyAlive  false once the population hits zero
 * @property {number} score         live score (couples output and colony age)
 */

/**
 * @typedef {object} InitialFarmOptions
 * @property {number} [seed=1]           RNG seed (orchestrator supplies entropy)
 * @property {string|null} [composterId=null]
 * @property {string|null} [speciesId=null]
 * @property {number} [wallPosition=0.5]
 */

/**
 * Build a fresh farm at day 1, hour 0 with all subsystems at their defaults.
 * @param {InitialFarmOptions} [opts]
 * @returns {FarmState}
 */
export function createInitialFarmState(opts = {}) {
  const {
    seed = 1,
    composterId = null,
    speciesId = null,
    wallPosition = 0.5,
  } = opts;

  return {
    day: 1,
    hour: 0,
    rngState: seed >>> 0,
    composterId,
    speciesId,
    wallPosition,
    population: { cocoons: 0, juveniles: 0, adults: 0 },
    env: { moisture: 0.5, ph: 7, toxicity: 0, temperature: 20 },
    queue: [],
    humus: 0,
    leachate: 0,
    colonyAgeDays: 0,
    colonyAlive: true,
    score: 0,
  };
}

/**
 * The absolute tick index for a farm's current clock (day 1 hour 0 = tick 0).
 * Used to stamp food entries and reason about elapsed time.
 * @param {FarmState} state
 * @returns {number}
 */
export function absoluteTick(state) {
  return (state.day - 1) * 24 + state.hour;
}

/**
 * Add a waste portion to the food queue. Rejects unknown foods and portions
 * below MIN_PORTION_LITERS (returns the input state unchanged). The queue is
 * bounded by the composter's capacity: an over-capacity add is clamped to the
 * remaining space, or rejected if less than a minimum portion remains.
 * Deterministic — no RNG.
 * @param {FarmState} state
 * @param {string} foodId catalog id (js/sim/foods.js)
 * @param {number} liters requested portion volume
 * @returns {FarmState}
 */
export function addFood(state, foodId, liters) {
  if (!getFood(foodId)) return state;
  if (!(liters >= MIN_PORTION_LITERS)) return state; // also rejects NaN/negatives

  const composter = getComposter(state.composterId);
  const capacity = composter ? composter.capacity : 0;
  const used = state.queue.reduce((sum, e) => sum + e.liters, 0);
  const remaining = capacity - used;
  if (remaining < MIN_PORTION_LITERS) return state; // bin is full

  const portion = Math.min(liters, remaining);
  const entry = { foodId, liters: portion, addedAtTick: absoluteTick(state) };
  return { ...state, queue: [...state.queue, entry] };
}

/**
 * Add sawdust to dry the bin. Lowers moisture deterministically (§2.5 — this is
 * the sawdust action's whole purpose); does not enter the food queue. Ignores a
 * non-positive amount.
 * @param {FarmState} state
 * @param {number} liters sawdust volume added
 * @returns {FarmState}
 */
export function addSawdust(state, liters) {
  if (!(liters > 0)) return state;
  const moisture = clamp01(state.env.moisture - SAWDUST_DRY_PER_LITER * liters);
  return { ...state, env: { ...state.env, moisture } };
}

/**
 * Advance the simulation by one game hour and return a NEW FarmState. Does not
 * mutate the input. The caller must construct `rng` from `state.rngState` (so
 * the sequence resumes correctly after save/load); tick threads the RNG's
 * advanced state back into the returned state.
 * @param {FarmState} state
 * @param {import('./rng.js').Rng} rng
 * @returns {FarmState}
 */
export function tick(state, rng) {
  let hour = state.hour + 1;
  let day = state.day;
  if (hour >= 24) {
    hour = 0;
    day += 1;
  }

  const prevTick = absoluteTick(state);
  const newTick = prevTick + 1;

  // Food queue decomposition releases moisture/pH/toxicity gradually and yields
  // the still-fresh mass that drives fermentation heat (§2.5, §2.7).
  const dyn = queueDynamics(state.queue, prevTick, newTick);

  // Environment dynamics: moisture accrues (sawdust removes it); pH eases back
  // toward neutral then takes the food push; toxicity decays very slowly then
  // takes the food load.
  const moisture = clamp01(state.env.moisture + dyn.moisture);
  const ph = clamp(
    state.env.ph + (NEUTRAL_PH - state.env.ph) * PH_DRIFT_RATE + dyn.phPush,
    0,
    14,
  );
  const toxicity = clamp01(state.env.toxicity * (1 - TOX_DECAY_RATE) + dyn.toxicity);

  // Temperature: blend toward the environment target for the new hour.
  const composter = getComposter(state.composterId);
  const target =
    ambientTemperature(hour) +
    solarGain(state.wallPosition, hour) +
    fermentationHeat(dyn.freshHeatMass);
  const temperature = blendTemperature(state.env.temperature, target, composter);

  return {
    ...state,
    day,
    hour,
    rngState: rng.state,
    env: { moisture, ph, toxicity, temperature },
  };
}
