// Scoring. PURE module: no DOM, no Three.js, no browser globals, no RNG — score
// is fully deterministic. The formula is FROZEN at v1 ship (§2.10 — "ask first"
// before changing it) and must stay bit-for-bit as written.
//
//   points += litersHarvested × 10 × (1 + colonyAgeDays / 30)
//
// It couples production with longevity: idling earns nothing (you must harvest),
// and harvest-then-restart throws away the age multiplier. Colony death resets
// the multiplier (age → 0) but banked points are kept, and the running score
// never decreases (the ranking entry is monotonic).

/** Coins-independent point value of one liter of humus at age 0 (§2.10). */
export const POINTS_PER_LITER = 10;

/** Game-days of colony age that double the multiplier (1 + age/30). */
export const AGE_BONUS_DAYS = 30;

/**
 * Points earned by a single harvest. A day-0 colony scores ×1; a 30-day colony
 * scores ×2; it grows without bound with age. Never negative — negative or NaN
 * inputs are floored to 0 so scoring can only ever add.
 * @param {number} litersHarvested liters of humus removed at harvest
 * @param {number} colonyAgeDays   age of the current colony, in game days
 * @returns {number} points earned (>= 0)
 */
export function scorePoints(litersHarvested, colonyAgeDays) {
  const liters = litersHarvested > 0 ? litersHarvested : 0;
  const age = colonyAgeDays > 0 ? colonyAgeDays : 0;
  return liters * POINTS_PER_LITER * (1 + age / AGE_BONUS_DAYS);
}

/**
 * Add a harvest's points to a farm's running score and return a NEW state.
 * Monotonic by construction: `scorePoints` is always >= 0, so the returned score
 * is always >= the old score (§2.10 — "score never decreases"). Does not mutate
 * the input; deterministic — no RNG.
 * @param {import('./engine.js').FarmState} state
 * @param {number} litersHarvested liters of humus removed at harvest
 * @returns {import('./engine.js').FarmState}
 */
export function applyHarvestScore(state, litersHarvested) {
  const gain = scorePoints(litersHarvested, state.colonyAgeDays);
  return { ...state, score: state.score + gain };
}
