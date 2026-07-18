// Food catalog + decomposition model. PURE data/logic module (no DOM/Three.js).
//
// The add-waste list (§2.7) deliberately mixes SUITABLE and UNSUITABLE foods
// "without labeling which is which" — discovery is the gameplay. So the data
// shape carries NO suitability flag: a food's character is emergent from its
// numbers alone (toxicity, pH push, fermentation heat). The catalog order is an
// intentionally IRREGULAR mix — not grouped good-then-bad, and deliberately NOT
// a strict good/bad alternation either (a perfect parity pattern is itself an
// ordering hint: it would let a player infer suitability from a food's index).
// Adjacent runs of two suitable or two unsuitable foods keep the sequence
// non-uniform, so nothing downstream can leak suitability by ordering. A guard
// test (tests/foods.test.js) locks down that the order is not strictly
// alternating.
//
// Per-liter effect fields (all released GRADUALLY as an entry decomposes):
//   moisture  water added to the bin per liter over full decomposition (>= 0)
//   ph        signed pH influence per liter; NEGATIVE acidifies (citrus/onion),
//             POSITIVE alkalizes (eggshells), ~0 is neutral
//   toxicity  toxicity added per liter over full decomposition (>= 0); the
//             unsuitable foods carry the load, suitable foods are ~0
//   heat      fermentation-heat multiplier while the entry is still fresh;
//             protein/oily foods (meat, dairy, oily) ferment hotter
// All numbers are FIRST-PASS values for CP1 review / T8 tuning; the SHAPES and
// relationships (harmful => toxic/acidic/hot, suitable => benign) are what the
// tests lock down.

/**
 * @typedef {object} Food
 * @property {string} id       catalog id (English identifier)
 * @property {number} moisture per-liter moisture released over decomposition
 * @property {number} ph       signed per-liter pH influence (- acid, + alkaline)
 * @property {number} toxicity per-liter toxicity released over decomposition
 * @property {number} heat     fermentation-heat multiplier while fresh
 */

/** @type {readonly Food[]} irregular mix on purpose — order is not a suitability hint */
export const FOODS = [
  { id: 'fruitPeels', moisture: 0.05, ph: -0.02, toxicity: 0.0, heat: 1.0 },
  { id: 'onionGarlic', moisture: 0.04, ph: -0.05, toxicity: 0.03, heat: 1.0 },
  { id: 'coffeeGrounds', moisture: 0.03, ph: -0.03, toxicity: 0.0, heat: 1.1 },
  { id: 'vegetableScraps', moisture: 0.06, ph: 0.0, toxicity: 0.0, heat: 1.0 },
  { id: 'meat', moisture: 0.03, ph: 0.0, toxicity: 0.15, heat: 1.8 },
  { id: 'eggshells', moisture: 0.0, ph: 0.04, toxicity: 0.0, heat: 0.9 },
  { id: 'cookedPasta', moisture: 0.05, ph: 0.0, toxicity: 0.06, heat: 1.4 },
  { id: 'citrus', moisture: 0.05, ph: -0.15, toxicity: 0.01, heat: 1.0 },
  { id: 'wetCardboard', moisture: 0.07, ph: 0.0, toxicity: 0.0, heat: 0.8 },
  { id: 'dairy', moisture: 0.04, ph: -0.02, toxicity: 0.12, heat: 1.6 },
  { id: 'teaLeaves', moisture: 0.04, ph: -0.01, toxicity: 0.0, heat: 1.0 },
  { id: 'pumpkinGuts', moisture: 0.08, ph: 0.0, toxicity: 0.0, heat: 1.1 },
  { id: 'oilyFood', moisture: 0.02, ph: 0.0, toxicity: 0.13, heat: 1.7 },
  { id: 'saltyLeftovers', moisture: 0.03, ph: 0.0, toxicity: 0.1, heat: 1.2 },
];

const BY_ID = new Map(FOODS.map((f) => [f.id, f]));

/** Ticks for a food entry to fully break down (2 game days). Tuned at T8. */
export const DECOMP_TICKS = 48;

/**
 * Look up a food model by id.
 * @param {string|null} id
 * @returns {Food|null}
 */
export function getFood(id) {
  return BY_ID.get(id) ?? null;
}

/**
 * All food models in catalog (display) order.
 * @returns {readonly Food[]}
 */
export function listFoods() {
  return FOODS;
}

/**
 * Cumulative fraction (0..1) of a food entry that has decomposed by `ageTicks`.
 * Linear ramp to full at DECOMP_TICKS; clamped outside [0, DECOMP_TICKS].
 * @param {number} ageTicks ticks elapsed since the entry was added
 * @returns {number} 0..1
 */
export function decompositionFraction(ageTicks) {
  if (ageTicks <= 0) return 0;
  if (ageTicks >= DECOMP_TICKS) return 1;
  return ageTicks / DECOMP_TICKS;
}

/**
 * Aggregate the food queue's contribution for a single tick step.
 *
 * Effect deltas (moisture/phPush/toxicity) are the amounts RELEASED by
 * decomposition between `prevTick` and `newTick`; `freshHeatMass` is the
 * heat-weighted, still-fresh mass at `newTick` (drives fermentation heat).
 * Unknown food ids are skipped. Pure — no mutation, no RNG.
 *
 * @param {import('./engine.js').FoodEntry[]} queue
 * @param {number} prevTick absolute tick before this step
 * @param {number} newTick  absolute tick after this step
 * @returns {{moisture: number, phPush: number, toxicity: number, freshHeatMass: number}}
 */
export function queueDynamics(queue, prevTick, newTick) {
  let moisture = 0;
  let phPush = 0;
  let toxicity = 0;
  let freshHeatMass = 0;
  for (const entry of queue) {
    const food = BY_ID.get(entry.foodId);
    if (!food) continue;
    const prevFrac = decompositionFraction(prevTick - entry.addedAtTick);
    const newFrac = decompositionFraction(newTick - entry.addedAtTick);
    const released = Math.max(0, newFrac - prevFrac) * entry.liters;
    moisture += food.moisture * released;
    phPush += food.ph * released;
    toxicity += food.toxicity * released;
    freshHeatMass += entry.liters * (1 - newFrac) * food.heat;
  }
  return { moisture, phPush, toxicity, freshHeatMass };
}
