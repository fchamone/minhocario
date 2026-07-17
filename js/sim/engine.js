// Core simulation engine. PURE module: no DOM, no Three.js, no browser globals.
// `tick(state, rng)` advances the farm by one game hour and returns a NEW state.
//
// The full FarmState shape is defined here as a JSDoc typedef; later tasks fill
// in the currently-stubbed subsystems (temperature, food queue, population,
// production, scoring). For T2, tick only advances the clock.

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

  return {
    ...state,
    day,
    hour,
    rngState: rng.state,
  };
}
