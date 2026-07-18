// Temperature model. PURE module (no DOM/Three.js). Single source of truth for
// the thermal simulation AND the render layer's sun patch: js/render/scene.js
// samples the same solarGain() so the visuals cannot drift from the sim (§2.6).
//
// The bin temperature each tick blends toward a target:
//   target = ambientTemperature(hour) + solarGain(wallPosition, hour)
//            + fermentationHeat(freshFoodMass)
// then blendTemperature() closes part of the gap, scaled by the composter's
// insulation traits (tempResponse / regulation). All constants are first-pass
// (CP1 review / T8 tuning); the shapes are what the tests lock down.

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
const SOLAR_MAX = 6; // °C peak contribution in the direct sun patch
const PATCH_WIDTH = 0.35; // half-width (in wall units) of the sunny patch

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
