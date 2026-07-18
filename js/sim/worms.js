// Worm species catalog + population model. PURE module (no DOM/Three.js).
//
// Population is a three-stage cohort pipeline (§2.4): adults lay cocoons,
// cocoons hatch into juveniles after a delay, juveniles mature into adults.
// Each stage transition is a per-tick probability (mean delay HATCH_TICKS /
// MATURE_TICKS), so a drained pipeline recovers only after a realistic lag.
//
// The bin environment (§2.5) drives two SEPARATE, graded responses:
//   - reproductionFactor: 1 inside every comfort band, easing to 0 as any one
//     variable reaches its "stall" distance outside the band;
//   - mortalityRate: 0 until a variable passes a LARGER "lethal" distance
//     (LETHAL_RATIO × the stall distance), then climbing.
// So as conditions worsen, laying stalls FIRST and dying follows — never the
// reverse. Every fractional flow is stochastically rounded through the seeded
// RNG, so counts stay integers and the sim stays deterministic per seed.
//
// All numbers are FIRST-PASS (CP-review / T8 tuning); the shapes and orderings
// (africana eats fastest & is cold-sensitive, azul breeds fastest & narrow on
// moisture) are what the tests lock down.

/**
 * @typedef {object} Band
 * @property {number} min
 * @property {number} max
 */

/**
 * @typedef {object} Species
 * @property {string} id
 * @property {string} latin            scientific (Latin) name — language-neutral data
 * @property {number} reproduction     base cocoons laid per adult per tick (ideal)
 * @property {number} speed            eating/processing multiplier (used in T6)
 * @property {Band}   tempComfort      comfortable temperature band (°C)
 * @property {Band}   moistureComfort  comfortable moisture band (0..1)
 * @property {number} price            purchase cost per pack unit (economy T7)
 */

/** @type {readonly Species[]} shop/setup display order */
export const SPECIES = [
  {
    // Vermelha-da-Califórnia (Eisenia fetida) — forgiving all-rounder, cheap.
    id: 'californiana',
    latin: 'Eisenia fetida',
    reproduction: 0.02,
    speed: 1.0,
    tempComfort: { min: 10, max: 30 },
    moistureComfort: { min: 0.4, max: 0.85 },
    price: 40,
  },
  {
    // Gigante-Africana (Eudrilus eugeniae) — fastest eater, heat-loving,
    // dies in cold nights (highest comfort floor).
    id: 'africana',
    latin: 'Eudrilus eugeniae',
    reproduction: 0.022,
    speed: 1.4,
    tempComfort: { min: 20, max: 34 },
    moistureComfort: { min: 0.45, max: 0.8 },
    price: 70,
  },
  {
    // Minhoca-Azul (Perionyx excavatus) — fastest reproduction, narrow moisture.
    id: 'azul',
    latin: 'Perionyx excavatus',
    reproduction: 0.035,
    speed: 1.1,
    tempComfort: { min: 15, max: 32 },
    moistureComfort: { min: 0.55, max: 0.72 },
    price: 55,
  },
];

const BY_ID = new Map(SPECIES.map((s) => [s.id, s]));

// Cohort pipeline timing (ticks). Mean time a cocoon takes to hatch and a
// juvenile to mature; the empty-pipeline recovery lag is their sum.
export const HATCH_TICKS = 48; // ~2 game days
export const MATURE_TICKS = 72; // ~3 game days

// Environment comfort + stress calibration. A variable's normalized stress is
// its distance outside the comfort band divided by that variable's STALL span;
// stress 1 => laying stalled, stress LETHAL_RATIO => mortality begins.
const PH_COMFORT = { min: 6, max: 8 };
const TOX_THRESHOLD = 0.1; // toxicity below this is harmless

const TEMP_STALL = 4; // °C outside the band that fully stalls laying
// Moisture band is asymmetric in its lethal headroom: moisture clamps at 1.0, so
// the wet side has only (1 - band.max) of room. A stall span of 0.06 keeps the
// dry side graded (0.1 outside the band => stress 1.67: laying stalled, no dying)
// while letting a fully-saturated bin (the leachate-overflow terminal, §2.8)
// reach a lethal stress of ~2.5 — without it, over-wetness could never kill.
const MOISTURE_STALL = 0.06; // moisture units outside the band
const PH_STALL = 1; // pH units outside the band
const TOX_STALL = 0.15; // toxicity above threshold
const OVERPOP_STALL = 0.5; // crowding ratio above carrying capacity

const LETHAL_RATIO = 2; // mortality starts at LETHAL_RATIO × the stall distance
const MORT_SLOPE = 0.08; // per-tick mortality gained per unit stress past lethal

const DENSITY = 50; // worms per liter of composter capacity (carrying capacity)

// Nutrition (§2.4). Laying is gated by the standing food supply as well as by the
// environment. Without this, reproduction ignores food entirely and a colony
// breeds far past what its keeper feeds — then dies of a SIDE EFFECT (the empty
// queue stops releasing moisture, so evaporation dries the bedding into lethal
// territory). That boom-bust wiped a well-tended colony from 2700 worms to 1 at
// CP3 while every test stayed green. Hunger now brakes laying directly, so the
// colony settles at a food-supported size instead of overshooting and crashing.
//
// `ration` is the fraction of the colony's full food requirement that the
// standing queue covers (1 = well fed, 0 = empty bin); the engine computes it
// from the same throughput formula it uses for consumption. Hunger is a
// REPRODUCTION brake only: its stress is capped at the stall distance (1) and so
// can never reach the lethal distance (LETHAL_RATIO), keeping §2.5's "laying
// slows before dying" true — a starving colony stops growing and slowly ages
// out, it is never struck down outright.
export const RATION_TICKS = 24; // ticks of eating a "full larder" holds (1 game day)

/**
 * Look up a species by id.
 * @param {string|null} id
 * @returns {Species|null}
 */
export function getSpecies(id) {
  return BY_ID.get(id) ?? null;
}

/**
 * All species in display order.
 * @returns {readonly Species[]}
 */
export function listSpecies() {
  return SPECIES;
}

/**
 * Carrying capacity (max healthy worms) for a composter — scales with volume.
 * @param {import('./composters.js').Composter|null} composter
 * @returns {number}
 */
export function carryingCapacity(composter) {
  return composter ? composter.capacity * DENSITY : 0;
}

/** Distance of `value` outside [band.min, band.max], else 0. */
function outsideBand(value, band) {
  if (value < band.min) return band.min - value;
  if (value > band.max) return value - band.max;
  return 0;
}

/**
 * Normalized environmental stresses (0 = comfortable, 1 = laying-stalled,
 * LETHAL_RATIO = mortality onset) for each bin variable + crowding.
 * @returns {number[]}
 */
function stresses(env, species, active, cap, ration) {
  const overpop = cap > 0 ? Math.max(0, active / cap - 1) / OVERPOP_STALL : 0;
  // Capped at 1 (the stall distance) by construction — hunger never turns lethal.
  const hunger = clamp01(1 - ration);
  return [
    outsideBand(env.temperature, species.tempComfort) / TEMP_STALL,
    outsideBand(env.moisture, species.moistureComfort) / MOISTURE_STALL,
    outsideBand(env.ph, PH_COMFORT) / PH_STALL,
    Math.max(0, env.toxicity - TOX_THRESHOLD) / TOX_STALL,
    overpop,
    hunger,
  ];
}

/** Clamp to [0, 1]. */
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Laying multiplier in [0, 1]: 1 when every variable is comfortable, dropping
 * to 0 as the worst single variable reaches its stall distance.
 * @param {import('./engine.js').BinEnv} env
 * @param {Species} species
 * @param {number} active juveniles + adults (crowding)
 * @param {number} cap carrying capacity
 * @param {number} [ration=1] fraction of the colony's food requirement on hand
 * @returns {number}
 */
export function reproductionFactor(env, species, active, cap, ration = 1) {
  let factor = 1;
  for (const s of stresses(env, species, active, cap, ration)) {
    factor = Math.min(factor, clamp01(1 - s));
  }
  return factor;
}

/**
 * Per-tick mortality fraction in [0, 1]: 0 until a variable passes its lethal
 * distance, then summing each offending variable's contribution.
 * @param {import('./engine.js').BinEnv} env
 * @param {Species} species
 * @param {number} active juveniles + adults (crowding)
 * @param {number} cap carrying capacity
 * @param {number} [ration=1] fraction of the colony's food requirement on hand
 *   (never contributes: hunger stress is capped below the lethal distance)
 * @returns {number}
 */
export function mortalityRate(env, species, active, cap, ration = 1) {
  let rate = 0;
  for (const s of stresses(env, species, active, cap, ration)) {
    rate += Math.max(0, s - LETHAL_RATIO) * MORT_SLOPE;
  }
  return clamp01(rate);
}

/**
 * Round `value` up or down to an integer, using the RNG so the expected value
 * is preserved (e.g. 2.3 -> 3 with 30% probability). Only draws when there is a
 * fractional part, so an all-integer step consumes no randomness.
 * @param {number} value
 * @param {import('./rng.js').Rng} rng
 * @returns {number}
 */
function stochasticRound(value, rng) {
  const floor = Math.floor(value);
  const frac = value - floor;
  if (frac <= 0) return floor;
  return floor + (rng.next() < frac ? 1 : 0);
}

/**
 * Advance the population one tick: lay, hatch, mature, and apply mortality.
 * All flows are computed from the pre-tick snapshot (order-independent) and
 * stochastically rounded. Returns a NEW population; never mutates the input.
 * @param {import('./engine.js').Population} population
 * @param {import('./engine.js').BinEnv} env
 * @param {Species} species
 * @param {number} cap carrying capacity
 * @param {import('./rng.js').Rng} rng
 * @param {number} [ration=1] fraction of the colony's food requirement on hand
 * @returns {import('./engine.js').Population}
 */
export function populationStep(population, env, species, cap, rng, ration = 1) {
  const { cocoons, juveniles, adults } = population;
  const active = juveniles + adults;
  const rFactor = reproductionFactor(env, species, active, cap, ration);
  const mRate = mortalityRate(env, species, active, cap, ration);

  const laid = stochasticRound(adults * species.reproduction * rFactor, rng);
  const hatched = stochasticRound(cocoons / HATCH_TICKS, rng);
  const matured = stochasticRound(juveniles / MATURE_TICKS, rng);
  const deathC = stochasticRound(cocoons * mRate, rng);
  const deathJ = stochasticRound(juveniles * mRate, rng);
  const deathA = stochasticRound(adults * mRate, rng);

  return {
    cocoons: Math.max(0, cocoons - hatched - deathC + laid),
    juveniles: Math.max(0, juveniles - matured - deathJ + hatched),
    adults: Math.max(0, adults - deathA + matured),
  };
}
