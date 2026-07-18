// Temperature model. PURE module (no DOM/Three.js). Single source of truth for
// the thermal simulation AND the render layer's sun patch: js/render/scene.js
// samples the same solarGain() so the visuals cannot drift from the sim (§2.6).
//
// The bin temperature each tick blends toward a target:
//   target = ambientTemperature(hour) + solarGain(wallPosition, hour)
//            + positionBias(wallPosition, hotSide)
//            + fermentationHeat(freshFoodMass)
// then blendTemperature() closes part of the gap, scaled by the composter's
// insulation traits (tempResponse / regulation). All constants are first-pass
// (CP1 review / T8 tuning); the shapes are what the tests lock down.
//
// TWO SEPARATE POSITION TERMS, deliberately. `solarGain` is the SUN: it sweeps,
// it is symmetric about mid-wall, and it is zero all night. `positionBias` is the
// GARAGE ITSELF: a fixed thermal gradient with a hot end and a cold end, which
// does not care what hour it is. Folding the gradient into solarGain would have
// been the obvious move and is wrong twice over — it would break the render
// layer, which samples solarGain to draw the sun patch and normalises against
// `solarGain(0.5, 12)` as the global peak, and it would make the "cold end" warm
// up at night, which is precisely when a cold corner is coldest.

/** Comfortable setpoint (°C) that regulated composters (electric) hold toward. */
export const IDEAL_TEMP = 22;

// Ambient day/night cycle.
const AMBIENT_MEAN = 20; // °C daily average
const AMBIENT_AMPLITUDE = 8; // °C swing above/below mean (night ~12, day ~28)
const AMBIENT_PEAK_HOUR = 15; // warmest hour of the day

// Solar sun-patch model. The bright patch sweeps the wall from position 0 at
// sunrise to 1 at sunset; intensity peaks at solar noon.
const SUNRISE_HOUR = 6;
const SUNSET_HOUR = 18;
// SOLAR_MAX was 6 through CP6, which made placement decorative: because the bin
// blends toward a target, damping changes the SWING but never the MEAN, so the
// sunniest spot added only ~0.8 °C to the daily average and moving the composter
// changed a 30-day population by under 3% — inside the noise. At 12 the spread
// between the sunny centre and the shaded ends is ~1.6 °C of daily mean and
// ~6 °C of midday peak, which is enough to matter without making the wall lethal.
//
// PATCH_WIDTH stays at 0.35 deliberately. Widening it to 0.5 buys only ~0.2 °C
// more spread while pushing positions 0.2–0.3 past the 30 °C band where laying
// stalls, and 0.5 is also the exact ceiling the "shaded end gets no midday sun"
// test allows (proximity hits 0 precisely at width 0.5). Narrow keeps the margin.
const SOLAR_MAX = 12; // °C peak contribution in the direct sun patch
const PATCH_WIDTH = 0.35; // half-width (in wall units) of the sunny patch

// Fixed hot-end/cold-end gradient (see positionBias). Half the end-to-end spread:
// +3 at the hot end, -3 at the cold end, 6 °C across the wall at ALL hours.
//
// This is roughly 4x the sun's lever. The sun moves the DAILY MEAN by only
// ~1.6 °C between mid-wall and the ends (it is zero for the twelve night hours,
// and the patch only dwells over any given spot briefly), whereas this applies
// around the clock. That ratio is the point: placement was previously a rounding
// error next to species and composter choice.
//
// CAPPED BY TWO OPPOSING GUARDS, both locked by tests — do not raise it without
// re-measuring both. All figures below are MEASURED on an unfed tier2 bin (the
// catalog's most exposed model, tempResponse 0.6), sampling settled days:
//
//   UPPER — placement must not cook a bin on its own. Solar and the gradient
//   stack worst around position 0.66, where the sun patch passes overhead just as
//   the ambient cycle peaks. Peak BIN temperature there is 37.0 °C against
//   californiana's 38 °C lethal line: 0.96 °C of headroom, and the gradient is
//   responsible for 0.96 °C of it (36.1 °C before). So this constant has already
//   spent essentially all the slack that existed — 4 would put an UNFED bin in
//   the worst spot at the lethal line, before a single liter of food is added.
//   Note the peak is off-centre: the old "well-placed bin" guard samples position
//   0.5 only (37.7 °C of TARGET there) and never saw this region.
//
//   LOWER — the warm end must NOT rescue a cold-sensitive colony overnight, or it
//   would quietly replace the electric composter's regulation, which the catalog
//   sells as the only reliable answer to a cold night. The ambient night trough
//   is ~12 °C and Gigante-Africana's comfort floor is 20 °C; at 3 the warm end
//   troughs at ~15 °C, comfortably short (locked in tests/balance.test.js).
//
// 3 sits inside both, but the upper guard is tight. There is little room above it.
const POSITION_BIAS_MAX = 3;

// Fermentation heat from fresh food mass. Tuned down from an initial 0.8 (which
// drove heavily-fed bins to an unrealistic 50-90 °C) so a full fresh load peaks
// in the 40s — hot enough that chronic overfeeding still turns lethal, but not so
// hot that ordinary feeding cooks the colony or (via the temperature-gated
// evaporation in engine.js) dries every fed bin out. Tuned at T8/T21.
const FERMENT_COEF = 0.35; // °C added to the target per liter of fresh food mass

/**
 * Ambient temperature (°C) as a function of the hour of day. Smooth sinusoid,
 * coldest before dawn, warmest mid-afternoon. Periodic over 24h.
 * @param {number} hourOfDay 0..24 (24 == 0 of the next day)
 * @returns {number}
 */
export function ambientTemperature(hourOfDay) {
  const phase = (2 * Math.PI * (hourOfDay - (AMBIENT_PEAK_HOUR - 6))) / 24;
  return AMBIENT_MEAN + AMBIENT_AMPLITUDE * Math.sin(phase);
}

/**
 * Solar heat contribution (°C) at a wall position and hour. Zero at night; a
 * patch sweeps the wall during the day and peaks at solar noon. Deterministic
 * and unit-testable; the render layer visualizes this exact function.
 * @param {number} wallPosition 0..1 along the garage wall
 * @param {number} hourOfDay 0..23
 * @returns {number} >= 0
 */
export function solarGain(wallPosition, hourOfDay) {
  if (hourOfDay <= SUNRISE_HOUR || hourOfDay >= SUNSET_HOUR) return 0;
  const dayFraction = (hourOfDay - SUNRISE_HOUR) / (SUNSET_HOUR - SUNRISE_HOUR); // 0..1
  const intensity = Math.sin(Math.PI * dayFraction); // 0 at edges, 1 at noon
  const patchCenter = dayFraction; // patch sweeps 0 -> 1 across the day
  const proximity = Math.max(0, 1 - Math.abs(wallPosition - patchCenter) / PATCH_WIDTH);
  return SOLAR_MAX * intensity * proximity;
}

/**
 * Fixed thermal gradient along the wall (°C), independent of the hour: one end
 * of the garage is warm, the other is cold, and mid-wall is neutral. Which end
 * is which is a per-farm property (`hotSide`), rolled once when the farm is
 * created — so every run's garage has to be learned rather than memorised across
 * runs. Nothing draws it: the player discovers it from the thermometer, the same
 * way the food list is discovered (§2.7).
 *
 * WHY THIS EXISTS. Through T24 the only positional lever was `solarGain`, whose
 * patch SWEEPS the wall — so the axis was centre-vs-ends and the two ends were
 * identical by construction (a symmetry the tests asserted outright). Placement
 * was therefore one-dimensional: "in the sun or not". A fixed gradient adds the
 * dimension the room actually has, and it is a much bigger lever than the sun —
 * see the spread comparison in tests/temperature.test.js.
 *
 * APPLIES AT EVERY HOUR, including at night, which is the whole point: it is a
 * property of where the bin sits, not of the sunlight falling on it. This is why
 * it is a separate term rather than part of `solarGain` (see the module header).
 * The night behaviour is load-bearing for the electric composter's premium —
 * `POSITION_BIAS_MAX` is capped so even the hot end's night trough stays below
 * the cold-sensitive species' comfort floor, leaving active regulation the only
 * reliable answer to a cold night (locked in tests/balance.test.js).
 *
 * @param {number} wallPosition 0..1 along the garage wall
 * @param {number} hotSide which END is the hot one: 1 = position 1, 0 = position 0
 * @returns {number} °C offset, in [-POSITION_BIAS_MAX, +POSITION_BIAS_MAX]
 */
export function positionBias(wallPosition, hotSide) {
  // A corrupt/absent position reads as mid-wall (neutral) rather than throwing or
  // poisoning the temperature with NaN — the same defensive stance the render
  // layer takes over `wallPosition`.
  if (typeof wallPosition !== 'number' || !Number.isFinite(wallPosition)) return 0;
  const p = Math.min(1, Math.max(0, wallPosition));
  // -1 at position 0, +1 at position 1, 0 at mid-wall; flipped when the hot end
  // is position 0. Any value other than 0 reads as "position 1 is hot", so an
  // old save missing the field degrades to a defined orientation, never NaN.
  const towardOne = 2 * p - 1;
  // Mid-wall returns early so the neutral point is a clean +0 under both
  // orientations. Negating 0 yields -0, which is a different value to Object.is
  // (and so to assert.strictEqual) and would make the pivot orientation-dependent
  // in exactly the one place it must not be.
  if (towardOne === 0) return 0;
  return POSITION_BIAS_MAX * (hotSide === 0 ? -towardOne : towardOne);
}

/**
 * Fermentation heat (°C added to the target) from the current fresh food mass.
 * Monotonic in mass; zero when empty. Wired to the real queue mass in T4.
 * @param {number} freshFoodMass liters of fresh (still-decomposing) food
 * @returns {number} >= 0
 */
export function fermentationHeat(freshFoodMass) {
  return FERMENT_COEF * Math.max(0, freshFoodMass);
}

/**
 * Advance the bin temperature one tick toward `target`, damped by the
 * composter's insulation traits. Regulated models (electric) bias the target
 * toward IDEAL_TEMP first; then a fraction of the remaining gap is closed.
 * @param {number} current current bin temperature (°C)
 * @param {number} target environment target for this tick (°C)
 * @param {import('./composters.js').Composter|null} composter
 * @returns {number} new bin temperature (°C)
 */
export function blendTemperature(current, target, composter) {
  const response = composter ? composter.tempResponse : 0.5;
  const regulation = composter ? composter.regulation : 0;
  const effectiveTarget = target + regulation * (IDEAL_TEMP - target);
  return current + response * (effectiveTarget - current);
}
