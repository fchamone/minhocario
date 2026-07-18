// Core simulation engine. PURE module: no DOM, no Three.js, no browser globals.
// `tick(state, rng)` advances the farm by one game hour and returns a NEW state.
//
// The full FarmState shape is defined here as a JSDoc typedef; later tasks fill
// in the currently-stubbed subsystems (food queue, population, production,
// scoring). As of T3 tick advances the clock and updates bin temperature.

import { getComposter } from './composters.js';
import { getFood, queueDynamics, decompositionFraction, DECOMP_TICKS } from './foods.js';
import { getSpecies, carryingCapacity, populationStep, RATION_TICKS } from './worms.js';
import {
  ambientTemperature,
  solarGain,
  fermentationHeat,
  blendTemperature,
} from './temperature.js';
import { scorePoints, applyHarvestScore } from './scoring.js';

/** Smallest waste portion the player may add, in liters (§2.7). */
export const MIN_PORTION_LITERS = 0.25;

// Bin-environment dynamics constants (§2.5). First-pass; tuned at T8/T21.
const NEUTRAL_PH = 7; // pH the bin eases back toward when nothing pushes it
const PH_DRIFT_RATE = 0.02; // fraction of the gap to neutral closed per tick
const TOX_DECAY_RATE = 0.001; // per-tick toxicity decay — deliberately very slow
const SAWDUST_DRY_PER_LITER = 0.03; // moisture removed per liter of sawdust added

// Passive evaporation (§2.5): a warm bin loses moisture to the air every tick.
// Without this, moisture is a ONE-WAY ratchet — only food and leachate backup
// raise it, only sawdust lowers it — so an untended bin can never dry out on its
// own and the "too dry" failure state (§2.8) is unreachable by neglect.
//
// Evaporation is TEMPERATURE-GATED: negligible at room temperature, climbing only
// as the bin heats past EVAP_THRESHOLD. This mirrors real drying (evaporation rises
// steeply with temperature) and, crucially, means a cool shaded bin barely dries —
// so a hot, sun-baked or neglected bin dries into lethal territory while a
// well-placed, well-fed bin holds its moisture. First-pass; tuned at T8/T21.
const EVAP_THRESHOLD = 24; // °C below which passive drying is negligible
const EVAP_COEF = 0.0006; // per-tick moisture lost per °C above the threshold

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

// Percolation (§2.5/§2.8): gravity drains bedding water into the leachate tank
// whenever the bedding is wetter than it can hold, and only while the tank has
// room. This is the bin's main water OUT-path (evaporation only matters when
// hot), so draining the tank is what keeps a well-fed bin in its moisture band.
const FIELD_CAPACITY = 0.75; // moisture the bedding holds against gravity
const PERCOLATION_RATE = 0.3; // fraction of the excess that drains per tick
const MOISTURE_TO_LEACHATE_LITERS = 8; // liters of leachate per 1.0 moisture unit

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

// Guided bedding mix -> initial bin environment (setup, §2.3). The mix is three
// components; the starting moisture/pH is their volume-weighted blend. Values
// are FIRST-PASS: sawdust is dry & mildly acidic, fruit peels wet & acidic, wet
// cardboard wet & near-neutral — so more sawdust dries the bin, more peels
// acidify it, more cardboard wets it.
const BEDDING_COMPONENTS = {
  sawdust: { moisture: 0.15, ph: 6.2 },
  peels: { moisture: 0.85, ph: 5.0 },
  cardboard: { moisture: 0.8, ph: 7.2 },
};

/**
 * Guided (pre-filled) bedding amounts in liters — tuned so the blend lands
 * moisture/pH inside every species' comfort band (locked by the engine test).
 */
export const RECOMMENDED_BEDDING = { sawdust: 1.5, peels: 1, cardboard: 2.5 };

/**
 * A bedding mix, in liters per component.
 * @typedef {object} BeddingMix
 * @property {number} sawdust   dry, mildly acidic
 * @property {number} peels     fruit peels/husks — wet, acidic
 * @property {number} cardboard wet cardboard — wet, near-neutral
 */

/**
 * Initial bin moisture and pH from a bedding mix: the volume-weighted blend of
 * the component characteristics. An empty mix returns neutral defaults. Pure.
 * @param {BeddingMix} mix
 * @returns {{moisture: number, ph: number}}
 */
export function beddingEnv(mix) {
  let total = 0;
  let moisture = 0;
  let ph = 0;
  for (const [key, comp] of Object.entries(BEDDING_COMPONENTS)) {
    const liters = mix && mix[key] > 0 ? mix[key] : 0;
    total += liters;
    moisture += liters * comp.moisture;
    ph += liters * comp.ph;
  }
  if (total <= 0) return { moisture: 0.5, ph: 7 };
  return { moisture: clamp01(moisture / total), ph: clamp(ph / total, 0, 14) };
}

/**
 * @typedef {object} InitialFarmOptions
 * @property {number} [seed=1]           RNG seed (orchestrator supplies entropy)
 * @property {string|null} [composterId=null]
 * @property {string|null} [speciesId=null]
 * @property {number} [wallPosition=0.5]
 * @property {Partial<BinEnv>|null} [env=null] initial env override (e.g. from
 *   beddingEnv) merged over the neutral defaults; unset fields keep defaults.
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
    env = null,
  } = opts;

  const baseEnv = { moisture: 0.5, ph: 7, toxicity: 0, temperature: 20 };

  return {
    day: 1,
    hour: 0,
    rngState: seed >>> 0,
    composterId,
    speciesId,
    wallPosition,
    population: { cocoons: 0, juveniles: 0, adults: 0 },
    env: env ? { ...baseEnv, ...env } : baseEnv,
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
  let dayRolled = false;
  if (hour >= 24) {
    hour = 0;
    day += 1;
    dayRolled = true;
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
  // full humus tray means no worm-driven processing this tick — but the overflow
  // chains (leachate spill, anaerobic rot) below keep running regardless, since
  // rot is decay, not production (§2.1 "production stops" on colony death).
  let queue = state.queue;
  let humus = state.humus;
  let leachate = state.leachate;
  let spillMoisture = 0; // leachate re-saturating the bedding (tank-full chain)
  let rotToxicity = 0; // stranded food rotting anaerobically (tray-full chain)
  let eatenMoisture = 0; // water in consumed food, released into the bedding
  // Fraction of the colony's food requirement standing in the bin this tick; it
  // brakes laying in populationStep (see worms.js RATION_TICKS). A farm with no
  // composter or no species has no colony to feed, so it stays fully fed (1).
  let ration = 1;

  if (composter) {
    const active = state.population.juveniles + state.population.adults;
    const trayFull = humus >= composter.humusCapacity - EPS;

    // Measured BEFORE this tick's eating, against the same throughput formula
    // used to consume: how many ticks of demand the standing queue covers.
    if (species && active > 0) {
      const demand = active * species.speed * composter.speed * CONSUMPTION_PER_WORM;
      const standing = queue.reduce((sum, e) => sum + e.liters, 0);
      ration = demand > 0 ? clamp01(standing / (demand * RATION_TICKS)) : 1;
    }

    // A dead colony (colonyAlive === false) never produces; its population is
    // already zero so `active > 0` also gates this, but the flag makes the
    // "colony-dead ⇒ no consumption/humus/leachate" rule (§2.1) explicit.
    if (species && active > 0 && !trayFull && state.colonyAlive) {
      // Eating throughput scales with the active colony and both speed traits.
      let toEat = active * species.speed * composter.speed * CONSUMPTION_PER_WORM;
      let eaten = 0;
      const nextQueue = [];
      for (const entry of queue) {
        if (toEat <= EPS) {
          nextQueue.push(entry);
          continue;
        }
        let eatenHere;
        if (entry.liters <= toEat + EPS) {
          // Oldest entry fully consumed -> removed from the queue.
          eatenHere = entry.liters;
          toEat -= entry.liters;
        } else {
          // Partially eaten -> keep the remainder in place.
          eatenHere = toEat;
          nextQueue.push({ ...entry, liters: entry.liters - toEat });
          toEat = 0;
        }
        eaten += eatenHere;
        // Water in EATEN food still enters the bin — worms process it into moist
        // castings, they do not evaporate it. Only the share that had not already
        // seeped out through decomposition is credited, so each liter of food
        // releases its moisture exactly once whether it rots in place or is eaten.
        // Without this the bin leaked water: a hungry colony consumed food within
        // a tick or two of it landing, so almost none of that moisture ever
        // reached the bedding, and evaporation dried a well-fed farm to death
        // (the CP3 crash). The bin's real water sink is draining the leachate.
        const food = getFood(entry.foodId);
        if (food) {
          const undecomposed = 1 - decompositionFraction(newTick - entry.addedAtTick);
          eatenMoisture += food.moisture * eatenHere * Math.max(0, undecomposed);
        }
      }
      // Fully decomposed food leaves the queue — an active colony works it into
      // the bedding, so it stops occupying bin capacity. It yields no humus:
      // humus is what worms MAKE (§2.6), and crediting un-eaten matter would pay
      // the player for neglect. Gated on the same condition as consumption, so
      // when processing halts (tray full) or the colony is gone the matter
      // strands and rots instead — the §2.8 tray chain is driven by exactly that
      // stranded volume.
      //
      // Without this, decomposed matter sat in the queue forever once there were
      // too few worms left to eat it: it permanently blocked bin capacity (so no
      // fresh waste could be added), released no more moisture, and produced no
      // more fermentation heat. A crashed colony could then always rebound, which
      // turned the leachate and overfeeding chains into endless limit cycles
      // instead of reaching the terminal state §2.8 requires.
      queue = nextQueue.filter((e) => newTick - e.addedAtTick < DECOMP_TICKS);
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

  // Environment dynamics: moisture accrues (food releases it, leachate backup
  // spikes it) and is lost to passive evaporation (faster when warm) and sawdust;
  // pH eases back toward neutral then takes the food push; toxicity decays very
  // slowly then takes the food load plus any rot. Evaporation uses the pre-tick
  // temperature (the warmth the bin carried into this hour).
  const evaporation = EVAP_COEF * Math.max(0, state.env.temperature - EVAP_THRESHOLD);
  let moisture = clamp01(
    state.env.moisture + dyn.moisture + eatenMoisture + spillMoisture - evaporation,
  );

  // Percolation (§2.8, the leachate chain): bedding water above field capacity
  // drains down into the leachate tank — this is what the tank and its tap are
  // FOR, and it is the ONLY path water has out of a cool bin. It makes the
  // never-drain chain work as the spec describes it: keep draining and the
  // bedding is held at field capacity, let the tank fill and percolation backs up
  // with nowhere to go, so the bedding saturates to lethal. Before this the tank
  // was decorative — it never even reached capacity, and "saturation" deaths were
  // really just food water piling up with no drainage anywhere in the model.
  if (composter) {
    const room = composter.leachateCapacity - leachate;
    if (moisture > FIELD_CAPACITY && room > EPS) {
      const excess = (moisture - FIELD_CAPACITY) * PERCOLATION_RATE;
      const drained = Math.min(excess, room / MOISTURE_TO_LEACHATE_LITERS);
      moisture -= drained;
      leachate += drained * MOISTURE_TO_LEACHATE_LITERS;
    }
  }
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
    ? populationStep(state.population, env, species, carryingCapacity(composter), rng, ration)
    : state.population;

  // Colony lifecycle (§2.1). Age advances once per game-day rollover while the
  // colony lives; a dead colony is frozen at the age it reached. Death is a
  // TRANSITION detected here: a colony that HAD worms (pre-tick total > 0) and
  // now has none flips colonyAlive → false. An empty pre-setup farm (never had
  // worms) never makes that transition, so it stays "alive" until real worms are
  // added and only later lost. Repopulation (buyWormPack) resets the age to 0.
  const prevTotal =
    state.population.cocoons + state.population.juveniles + state.population.adults;
  const newTotal = population.cocoons + population.juveniles + population.adults;
  let colonyAlive = state.colonyAlive;
  let colonyAgeDays = state.colonyAgeDays;
  if (state.colonyAlive && dayRolled) colonyAgeDays += 1;
  if (state.colonyAlive && prevTotal > 0 && newTotal === 0) colonyAlive = false;

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
    colonyAgeDays,
    colonyAlive,
  };
}

// --- Economy (§2.2, §2.11) --------------------------------------------------
//
// PURE and deterministic — no RNG, no DOM. The wallet lives on the player
// PROFILE (save schema §2.11: `{ v, profile: { nickname, wallet }, farm, ... }`)
// so it survives farm restarts; it is NOT a FarmState field. Every economy
// function therefore takes an explicit `wallet` number and returns the updated
// one alongside the new farm state. All prices are FIRST-PASS (CP-review / T8
// tuning); the structural relationships are what matter and what the tests lock.

/** Auto-sell price of humus, per liter (§2.2 — humus is worth much more). */
export const HUMUS_PRICE_PER_LITER = 12;

/** Auto-sell price of leachate, per liter (§2.2 — a small bonus). */
export const LEACHATE_PRICE_PER_LITER = 2;

/** Worm pack sizes the shop sells (§2.2). */
export const WORM_PACK_SIZES = [50, 100, 200];

// New profiles start able to buy the cheapest composter (tier2 = 100) + a
// 50-worm pack of the cheapest species (californiana = 40) + bedding (FREE,
// §2.2), with a little slack. Minimum viable start is 140; 200 leaves 60 of
// slack. Asserted DYNAMICALLY against the catalogs in the tests, not hardcoded
// there — so retuning a catalog price only needs this constant revisited.
/** Coins a fresh player profile starts with (§2.2). */
export const STARTING_WALLET = 200;

// Larger packs cost proportionally more worms but earn a small, capped bulk
// discount (cheaper per worm). species.price is defined as the price of the
// base 50-worm pack; a pack of N worms costs price × (N/50) × discount.
const BULK_DISCOUNT_PER_STEP = 0.03; // per extra 50-worm step above the base pack

/**
 * Price of a worm pack. species.price is the base 50-worm pack price; the pack
 * scales by worm count (packSize/50) with a small bulk discount and is rounded
 * to whole coins. Unknown species or an unsupported pack size returns Infinity
 * (unaffordable), so a caller's `wallet >= price` guard rejects it.
 * @param {string} speciesId catalog id (js/sim/worms.js)
 * @param {number} packSize  number of worms (one of WORM_PACK_SIZES)
 * @returns {number} price in coins, or Infinity if invalid
 */
export function wormPackPrice(speciesId, packSize) {
  const species = getSpecies(speciesId);
  if (!species || !WORM_PACK_SIZES.includes(packSize)) return Infinity;
  const steps = packSize / 50; // 1, 2, or 4
  const discount = Math.max(0.5, 1 - BULK_DISCOUNT_PER_STEP * (steps - 1));
  return Math.round(species.price * steps * discount);
}

/**
 * Coins earned auto-selling harvested humus (§2.2 — no inventory, instant sale).
 * @param {number} liters liters of humus sold (>= 0)
 * @returns {number} coins
 */
export function sellHumus(liters) {
  return (liters > 0 ? liters : 0) * HUMUS_PRICE_PER_LITER;
}

/**
 * Coins earned auto-selling drained leachate (§2.2 — a small bonus).
 * @param {number} liters liters of leachate sold (>= 0)
 * @returns {number} coins
 */
export function sellLeachate(liters) {
  return (liters > 0 ? liters : 0) * LEACHATE_PRICE_PER_LITER;
}

/**
 * Result of harvesting the humus tray and auto-selling it (§2.2, §2.10).
 * @typedef {object} HarvestSaleResult
 * @property {FarmState} state    tray emptied and score advanced
 * @property {number} wallet      wallet after crediting the sale
 * @property {number} harvested   liters of humus removed
 * @property {number} coins       coins credited for the humus
 * @property {number} points      score points the harvest added
 */

/**
 * Harvest the humus tray, auto-sell it into the wallet, and bank the age-scaled
 * score (§2.10). Combines harvestHumus + sellHumus + applyHarvestScore. The
 * points use the colony age at harvest time. Pure — no RNG.
 * @param {FarmState} state
 * @param {number} wallet coins on the player profile
 * @returns {HarvestSaleResult}
 */
export function harvestAndSell(state, wallet) {
  const { state: harvested, harvested: liters } = harvestHumus(state);
  const coins = sellHumus(liters);
  const points = scorePoints(liters, state.colonyAgeDays);
  const scored = applyHarvestScore(harvested, liters);
  return { state: scored, wallet: wallet + coins, harvested: liters, coins, points };
}

/**
 * Result of draining the leachate tank and auto-selling it (§2.2).
 * @typedef {object} DrainSaleResult
 * @property {FarmState} state   tank emptied
 * @property {number} wallet     wallet after crediting the sale
 * @property {number} drained    liters of leachate removed
 * @property {number} coins      coins credited for the leachate
 */

/**
 * Drain the leachate tank and auto-sell it into the wallet. Leachate earns coins
 * but NO score — only humus harvests score (§2.10). Pure — no RNG.
 * @param {FarmState} state
 * @param {number} wallet coins on the player profile
 * @returns {DrainSaleResult}
 */
export function drainAndSell(state, wallet) {
  const { state: drainedState, drained } = drainLeachate(state);
  const coins = sellLeachate(drained);
  return { state: drainedState, wallet: wallet + coins, drained, coins };
}

/**
 * Result of a wallet-spending action (buy / repopulate / migrate).
 * @typedef {object} PurchaseResult
 * @property {FarmState} state  new state (unchanged when ok === false)
 * @property {number} wallet    new wallet (unchanged when ok === false)
 * @property {boolean} ok       whether the purchase went through
 */

/**
 * Buy a worm pack and add the worms to the farm as ADULTS (§2.2). Rejects
 * (ok:false, state+wallet unchanged) on an unknown species, an unsupported pack
 * size, or an insufficient wallet. On success the price is deducted and the
 * worms are added; the pack's species becomes the farm's species (one species
 * per farm). If the colony was DEAD this repopulates the SAME farm (§2.1):
 * colonyAlive → true and colonyAgeDays → 0, while score/humus/leachate totals
 * are kept. Adding to a LIVE colony does NOT reset the age. Pure — no RNG.
 * @param {FarmState} state
 * @param {number} wallet coins on the player profile
 * @param {string} speciesId catalog id (js/sim/worms.js)
 * @param {number} packSize  number of worms (one of WORM_PACK_SIZES)
 * @returns {PurchaseResult}
 */
export function buyWormPack(state, wallet, speciesId, packSize) {
  const species = getSpecies(speciesId);
  if (!species || !WORM_PACK_SIZES.includes(packSize)) {
    return { state, wallet, ok: false };
  }
  const price = wormPackPrice(speciesId, packSize);
  if (!(wallet >= price)) return { state, wallet, ok: false };

  const wasDead = !state.colonyAlive;
  const next = {
    ...state,
    speciesId,
    population: { ...state.population, adults: state.population.adults + packSize },
    colonyAlive: true,
    // A dead colony repopulates as a fresh colony: age resets. A live one keeps
    // its accumulated age (restocking must not wipe the longevity multiplier).
    colonyAgeDays: wasDead ? 0 : state.colonyAgeDays,
  };
  return { state: next, wallet: wallet - price, ok: true };
}

/**
 * Repopulate the farm after a colony death (§2.1). Thin alias of buyWormPack —
 * a dead colony's purchase already resets colonyAlive/colonyAgeDays.
 * @param {FarmState} state
 * @param {number} wallet coins on the player profile
 * @param {string} speciesId catalog id (js/sim/worms.js)
 * @param {number} packSize  number of worms (one of WORM_PACK_SIZES)
 * @returns {PurchaseResult}
 */
export function repopulateColony(state, wallet, speciesId, packSize) {
  return buyWormPack(state, wallet, speciesId, packSize);
}

/**
 * Migrate the farm to a new composter model (§2.2 mid-farm upgrade). Rejects
 * (ok:false, unchanged) on an unknown or same model, or if the wallet cannot
 * cover the net cost `newPrice − 0.5 × oldPrice`. On success: the old bin's
 * humus + leachate are auto-sold into the wallet, a 50% trade-in of the OLD
 * composter is credited, the new price is deducted, and worms / food queue /
 * bedding (env) / colonyAgeDays / score / colonyAlive all carry across. Humus
 * and leachate start empty in the new bin (they were sold). If the new bin's
 * capacity is smaller, the carried queue is trimmed OLDEST-FIRST up to the new
 * capacity (truncating the straddling entry, discarding the newest overflow —
 * the oldest food is closest to becoming humus). One composter at a time. Pure
 * — no RNG.
 * @param {FarmState} state
 * @param {number} wallet coins on the player profile
 * @param {string} newComposterId catalog id (js/sim/composters.js)
 * @returns {PurchaseResult}
 */
export function migrateToComposter(state, wallet, newComposterId) {
  const newComposter = getComposter(newComposterId);
  if (!newComposter || newComposterId === state.composterId) {
    return { state, wallet, ok: false };
  }

  const oldComposter = getComposter(state.composterId);
  const tradeIn = 0.5 * (oldComposter ? oldComposter.price : 0);
  const netCost = newComposter.price - tradeIn;
  if (!(wallet >= netCost)) return { state, wallet, ok: false };

  // Auto-sell whatever was in the old bin, then apply trade-in − new price.
  const saleCoins = sellHumus(state.humus) + sellLeachate(state.leachate);
  const newWallet = wallet + saleCoins + tradeIn - newComposter.price;

  // Trim the carried queue oldest-first to the new capacity if it is smaller.
  let queue = state.queue;
  const queued = queue.reduce((sum, e) => sum + e.liters, 0);
  if (queued > newComposter.capacity + EPS) {
    const trimmed = [];
    let room = newComposter.capacity;
    for (const e of queue) {
      if (room <= EPS) break;
      if (e.liters <= room + EPS) {
        trimmed.push(e);
        room -= e.liters;
      } else {
        trimmed.push({ ...e, liters: room });
        room = 0;
      }
    }
    queue = trimmed;
  }

  const next = {
    ...state,
    composterId: newComposterId,
    queue,
    humus: 0,
    leachate: 0,
  };
  return { state: next, wallet: newWallet, ok: true };
}
