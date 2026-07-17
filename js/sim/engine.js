// Core simulation engine. PURE module: no DOM, no Three.js, no browser globals.
// `tick(state, rng)` advances the farm by one game hour and returns a NEW state.
//
// The full FarmState shape is defined here as a JSDoc typedef; later tasks fill
// in the currently-stubbed subsystems (food queue, population, production,
// scoring). As of T3 tick advances the clock and updates bin temperature.

import { getComposter } from './composters.js';
import { getFood, queueDynamics } from './foods.js';
import { getSpecies, carryingCapacity, populationStep } from './worms.js';
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

// Production / consumption / overflow constants (§2.6, §2.8). First-pass; tuned
// at T8. The eating throughput of the colony per tick is
//   activeWorms × species.speed × composter.speed × CONSUMPTION_PER_WORM
// so a bigger, faster colony in a faster composter processes more food, and
// per-model humus output tracks composter.speed × composter.humusRate.
const CONSUMPTION_PER_WORM = 0.0005; // liters of food a single active worm eats per tick

// Tray-full chain (§2.8): once the humus tray is full processing halts; the
// undrained queue then rots anaerobically, raising toxicity in proportion to the
// stranded food volume each tick.
const ROT_RATE = 0.0002; // toxicity added per liter of stranded queue per tick

// Tank-full chain (§2.8): leachate produced past the tank's capacity re-saturates
// the bedding — this fraction of each overflowed liter is added to moisture.
const LEACHATE_SPILL_TO_MOISTURE = 0.05;

// Numerical slack for "depleted"/"full" comparisons on floating-point volumes.
const EPS = 1e-9;

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
 * Result of a container-emptying action. Unlike addFood/addSawdust (which return
 * a bare FarmState), drain/harvest also surface the volume removed so the economy
 * layer (T7 auto-sell/scoring) can price it. Pure — no RNG.
 * @typedef {object} DrainResult
 * @property {FarmState} state   new state with the tank emptied
 * @property {number} drained    liters of leachate removed
 */

/**
 * @typedef {object} HarvestResult
 * @property {FarmState} state   new state with the humus tray emptied
 * @property {number} harvested  liters of humus removed
 */

/**
 * Drain the leachate tank: empties it instantly and fully (leachate -> 0),
 * relieving the moisture pressure of a full tank (§2.7 — "instant, empties
 * fully"). Returns the new state plus the volume drained (for T7 auto-sell).
 * Deterministic — no RNG.
 * @param {FarmState} state
 * @returns {DrainResult}
 */
export function drainLeachate(state) {
  const drained = state.leachate;
  return { state: { ...state, leachate: 0 }, drained };
}

/**
 * Harvest the humus tray: empties it at any time (humus -> 0), which re-enables
 * processing after a tray-full halt (§2.8). Returns the new state plus the volume
 * harvested — T7 scoring consumes `harvested` for the age-multiplied points.
 * Deterministic — no RNG.
 * @param {FarmState} state
 * @returns {HarvestResult}
 */
export function harvestHumus(state) {
  const harvested = state.humus;
  return { state: { ...state, humus: 0 }, harvested };
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

  const composter = getComposter(state.composterId);
  const species = getSpecies(state.speciesId);

  // Worm consumption, production, and the two overflow chains (§2.6, §2.8).
  // Consumption uses the PRE-tick population (order-independent from the cohort
  // step below) and is fully deterministic — no RNG. A dead/empty colony or a
  // full humus tray means no processing this tick.
  let queue = state.queue;
  let humus = state.humus;
  let leachate = state.leachate;
  let spillMoisture = 0; // leachate re-saturating the bedding (tank-full chain)
  let rotToxicity = 0; // stranded food rotting anaerobically (tray-full chain)

  if (composter) {
    const active = state.population.juveniles + state.population.adults;
    const trayFull = humus >= composter.humusCapacity - EPS;

    if (species && active > 0 && !trayFull) {
      // Eating throughput scales with the active colony and both speed traits.
      let toEat = active * species.speed * composter.speed * CONSUMPTION_PER_WORM;
      let eaten = 0;
      const nextQueue = [];
      for (const entry of queue) {
        if (toEat <= EPS) {
          nextQueue.push(entry);
          continue;
        }
        if (entry.liters <= toEat + EPS) {
          // Oldest entry fully consumed -> removed from the queue.
          eaten += entry.liters;
          toEat -= entry.liters;
        } else {
          // Partially eaten -> keep the remainder in place.
          eaten += toEat;
          nextQueue.push({ ...entry, liters: entry.liters - toEat });
          toEat = 0;
        }
      }
      queue = nextQueue;
      // Eaten volume converts to humus and leachate at the composter's rates.
      humus += eaten * composter.humusRate;
      leachate += eaten * composter.leachateRate;
    }

    // Tank-full chain: leachate past capacity re-saturates the bedding (moisture
    // spike) and the tank clamps at capacity — the spike happens ONLY here.
    if (leachate > composter.leachateCapacity) {
      spillMoisture = (leachate - composter.leachateCapacity) * LEACHATE_SPILL_TO_MOISTURE;
      leachate = composter.leachateCapacity;
    }

    // Tray-full chain: humus clamps at capacity; while the tray is full the
    // undrained queue rots anaerobically and climbs toxicity over time.
    if (humus > composter.humusCapacity) humus = composter.humusCapacity;
    if (trayFull) {
      const stranded = queue.reduce((sum, e) => sum + e.liters, 0);
      rotToxicity = stranded * ROT_RATE;
    }
  }

  // Environment dynamics: moisture accrues (sawdust removes it, leachate backup
  // spikes it); pH eases back toward neutral then takes the food push; toxicity
  // decays very slowly then takes the food load plus any rot.
  const moisture = clamp01(state.env.moisture + dyn.moisture + spillMoisture);
  const ph = clamp(
    state.env.ph + (NEUTRAL_PH - state.env.ph) * PH_DRIFT_RATE + dyn.phPush,
    0,
    14,
  );
  const toxicity = clamp01(
    state.env.toxicity * (1 - TOX_DECAY_RATE) + dyn.toxicity + rotToxicity,
  );

  // Temperature: blend toward the environment target for the new hour.
  const target =
    ambientTemperature(hour) +
    solarGain(state.wallPosition, hour) +
    fermentationHeat(dyn.freshHeatMass);
  const temperature = blendTemperature(state.env.temperature, target, composter);
  const env = { moisture, ph, toxicity, temperature };

  // Population: evolve the cohort pipeline against the new environment. Skipped
  // until a species is chosen (empty farm before setup); the RNG is only drawn
  // for fractional cohort flows, so an empty colony consumes no randomness.
  const population = species
    ? populationStep(state.population, env, species, carryingCapacity(composter), rng)
    : state.population;

  return {
    ...state,
    day,
    hour,
    rngState: rng.state,
    env,
    population,
    queue,
    humus,
    leachate,
  };
}
