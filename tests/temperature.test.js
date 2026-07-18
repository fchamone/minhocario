import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ambientTemperature,
  solarGain,
  positionBias,
  fermentationHeat,
  blendTemperature,
  IDEAL_TEMP,
} from '../js/sim/temperature.js';
import { getComposter, listComposters } from '../js/sim/composters.js';
import { createInitialFarmState, tick } from '../js/sim/engine.js';
import { createRng } from '../js/sim/rng.js';

// --- solarGain ---------------------------------------------------------------

test('solarGain is zero at night for every position', () => {
  for (const h of [0, 1, 2, 3, 4, 5, 20, 21, 22, 23]) {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      assert.equal(solarGain(p, h), 0, `expected 0 at pos ${p}, hour ${h}`);
    }
  }
});

test('solarGain peaks in the sunny region at midday and is zero at the shaded end', () => {
  const sunny = solarGain(0.5, 12); // patch center at midday
  const shaded = solarGain(0, 12); // far end at midday
  assert.ok(sunny > 0, 'sunny region should receive sun at midday');
  assert.equal(shaded, 0, 'shaded end receives no sun at midday');

  // The midday sunny spot is the global maximum across positions and hours.
  let max = 0;
  for (let h = 0; h < 24; h++) {
    for (let p = 0; p <= 1.0001; p += 0.05) max = Math.max(max, solarGain(p, h));
  }
  assert.ok(sunny + 1e-9 >= max, 'midday sunny spot is the global max');
});

test('solarGain is never negative', () => {
  for (let h = 0; h < 24; h++) {
    for (let p = 0; p <= 1.0001; p += 0.1) assert.ok(solarGain(p, h) >= 0);
  }
});

// --- positionBias: the wall's fixed warm end / cold end ----------------------
// Distinct from solarGain in three ways, each asserted below: it is signed (the
// cold end is a PENALTY, not merely an absence of sun), it is antisymmetric about
// mid-wall rather than symmetric, and it does not care what hour it is.

test('positionBias is zero at mid-wall and opposite-signed at the two ends', () => {
  for (const hotSide of [0, 1]) {
    assert.equal(positionBias(0.5, hotSide), 0, 'mid-wall is the neutral pivot');
    const left = positionBias(0, hotSide);
    const right = positionBias(1, hotSide);
    assert.ok(left * right < 0, 'the ends sit on opposite sides of neutral');
    assert.ok(Math.abs(left + right) < 1e-9, 'and are mirror images of each other');
  }
});

test('hotSide names which END is the warm one', () => {
  assert.ok(positionBias(1, 1) > 0, 'hotSide 1 -> position 1 is warm');
  assert.ok(positionBias(0, 1) < 0, 'hotSide 1 -> position 0 is cold');
  assert.ok(positionBias(0, 0) > 0, 'hotSide 0 -> position 0 is warm');
  assert.ok(positionBias(1, 0) < 0, 'hotSide 0 -> position 1 is cold');
});

test('flipping hotSide mirrors the whole wall exactly', () => {
  for (let p = 0; p <= 1.0001; p += 0.1) {
    assert.ok(
      Math.abs(positionBias(p, 1) + positionBias(p, 0)) < 1e-9,
      `orientation is a clean reflection at ${p.toFixed(1)}`,
    );
  }
});

test('positionBias rises monotonically toward the warm end', () => {
  let prev = -Infinity;
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const bias = positionBias(p, 1);
    assert.ok(bias > prev, `no flat spots or reversals along the wall at ${p.toFixed(2)}`);
    prev = bias;
  }
});

test('positionBias applies at EVERY hour, unlike the sun', () => {
  // The defining difference from solarGain, and the reason it is a separate term:
  // a cold corner is coldest at night, exactly when solarGain contributes nothing.
  // If this ever collapses to a daytime-only effect, the cold end stops being cold
  // when it matters most.
  for (const h of [0, 3, 6, 12, 18, 23]) {
    assert.equal(solarGain(0, h) + solarGain(1, h) >= 0, true);
  }
  assert.equal(solarGain(1, 2), 0, 'the sun is off at 02h');
  assert.ok(positionBias(1, 1) > 0, 'the gradient is not, and takes no hour argument');
});

test('positionBias is a much bigger lever than the sun patch', () => {
  // The mechanic it replaces was too small to feel: the sun moves the daily MEAN
  // by only ~1.6 °C between mid-wall and the ends, because it is zero for twelve
  // hours a day and sweeps past any given spot quickly. The gradient applies
  // around the clock, so it should dominate by a wide margin.
  const meanSolar = (p) => {
    let sum = 0;
    for (let h = 0; h < 24; h++) sum += solarGain(p, h);
    return sum / 24;
  };
  const solarLever = meanSolar(0.5) - meanSolar(0);
  const biasLever = positionBias(1, 1) - positionBias(0, 1);
  assert.ok(
    biasLever > solarLever * 3,
    `placement is now a real decision: ${biasLever.toFixed(2)} °C vs the sun's ${solarLever.toFixed(2)} °C`,
  );
});

test('positionBias survives a corrupt wall position instead of poisoning the sim', () => {
  // A hand-edited or migrated save can carry rubbish here, and a NaN would
  // propagate through the blend target into env.temperature and never wash out.
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'left']) {
    assert.equal(positionBias(bad, 1), 0, `${String(bad)} reads as neutral`);
  }
  // Out-of-range positions clamp to the ends rather than extrapolating past them.
  assert.equal(positionBias(-5, 1), positionBias(0, 1));
  assert.equal(positionBias(5, 1), positionBias(1, 1));
});

// --- ambient cycle -----------------------------------------------------------

test('ambient temperature is warmer at mid-afternoon than pre-dawn', () => {
  assert.ok(ambientTemperature(15) > ambientTemperature(3));
});

test('ambient temperature is periodic over 24h', () => {
  assert.ok(Math.abs(ambientTemperature(0) - ambientTemperature(24)) < 1e-9);
});

// --- fermentation heat -------------------------------------------------------

test('fermentation heat is zero with no fresh mass and rises monotonically', () => {
  assert.equal(fermentationHeat(0), 0);
  assert.ok(fermentationHeat(5) > fermentationHeat(1));
  assert.ok(fermentationHeat(10) > fermentationHeat(5));
});

// --- insulation blending -----------------------------------------------------

function dayRange(composter, driver) {
  let temp = IDEAL_TEMP;
  const samples = [];
  for (let day = 0; day < 3; day++) {
    for (let h = 0; h < 24; h++) {
      temp = blendTemperature(temp, driver(h), composter);
      if (day === 2) samples.push(temp);
    }
  }
  return { range: Math.max(...samples) - Math.min(...samples), samples };
}

test('electric holds near ideal while an open tray swings with ambient', () => {
  const ambient = (h) => ambientTemperature(h);
  const electric = dayRange(getComposter('electric'), ambient);
  const tray = dayRange(getComposter('tier2'), ambient);
  assert.ok(electric.range < tray.range, 'electric swings less than the tray');
  for (const t of electric.samples) {
    assert.ok(Math.abs(t - IDEAL_TEMP) < 3, `electric stays near ideal: ${t}`);
  }
});

test('buried swings less than an open tray', () => {
  const ambient = (h) => ambientTemperature(h);
  const buried = dayRange(getComposter('buried'), ambient);
  const tray = dayRange(getComposter('tier2'), ambient);
  assert.ok(buried.range < tray.range, 'buried swings less than the tray');
});

test('injected fresh mass spikes temperature and then decays back', () => {
  const tray = getComposter('tier2');
  const ambient = ambientTemperature(12);
  // settle at steady ambient
  let temp = ambient;
  for (let i = 0; i < 50; i++) temp = blendTemperature(temp, ambient, tray);
  const baseline = temp;

  // inject fresh mass -> fermentation heat raises the target for a few ticks
  const withFood = ambient + fermentationHeat(10);
  let spiked = baseline;
  for (let i = 0; i < 3; i++) spiked = blendTemperature(spiked, withFood, tray);
  assert.ok(spiked > baseline + 1, `temperature spikes: ${spiked} vs ${baseline}`);

  // food gone -> target back to ambient, temperature decays
  let decayed = spiked;
  for (let i = 0; i < 50; i++) decayed = blendTemperature(decayed, ambient, tray);
  assert.ok(decayed < spiked, 'temperature decays after fresh mass is gone');
  assert.ok(Math.abs(decayed - baseline) < 0.5, 'returns near baseline');
});

// --- catalog sanity ----------------------------------------------------------

test('composter catalog has all six models with required numeric fields', () => {
  const ids = ['electric', 'tier2', 'tier3', 'tier4', 'buried', 'eco'];
  assert.equal(listComposters().length, 6);
  const fields = [
    'capacity', 'speed', 'humusRate', 'leachateRate',
    'humusCapacity', 'leachateCapacity', 'tempResponse', 'regulation', 'price',
  ];
  for (const id of ids) {
    const c = getComposter(id);
    assert.ok(c, `missing composter ${id}`);
    assert.equal(c.id, id);
    for (const f of fields) {
      assert.equal(typeof c[f], 'number', `${id}.${f} should be a number`);
    }
  }
});

test('getComposter returns null for an unknown id', () => {
  assert.equal(getComposter('nope'), null);
  assert.equal(getComposter(null), null);
});

// --- engine integration ------------------------------------------------------

test('tick moves bin temperature toward the environment target', () => {
  const s0 = createInitialFarmState({ seed: 1, composterId: 'tier2' });
  const rng = createRng(s0.rngState);
  const s1 = tick(s0, rng);
  assert.equal(typeof s1.env.temperature, 'number');
  assert.notEqual(s1.env.temperature, s0.env.temperature);
  // env object is replaced, not mutated in place
  assert.notEqual(s1.env, s0.env);
  assert.equal(s0.env.temperature, 20);
});

// --- Placement is a real decision (retuned after CP6) ------------------------
// Before the retune the sunniest spot added only ~0.8 °C to the DAILY MEAN, so
// moving the composter changed a 30-day population by less than 3%. The bin
// blends toward a target, and damping changes the swing but never the mean, so
// the only lever is total daily solar energy. These lock the lever's existence
// and rough size WITHOUT pinning SOLAR_MAX, so it stays tunable at T21.

/** Mean solar gain across a full day at a wall position. */
function dailyMeanSolar(position) {
  let sum = 0;
  for (let h = 0; h < 24; h++) sum += solarGain(position, h);
  return sum / 24;
}

test('the sunny centre of the wall beats BOTH shaded ends, which are equal', () => {
  // The patch sweeps 0 -> 1 but peaks at noon, so 0.5 is sunniest and the two
  // ends are the shadiest — and symmetric. (Mis-reading this produced a wrong
  // CP6 finding by comparing 0.0 against 1.0, i.e. shade against shade.)
  const centre = dailyMeanSolar(0.5);
  const left = dailyMeanSolar(0);
  const right = dailyMeanSolar(1);
  assert.ok(centre > left, 'centre must out-gain the left end');
  assert.ok(centre > right, 'centre must out-gain the right end');
  assert.ok(Math.abs(left - right) < 1e-9, 'the two ends are symmetric');
});

test('placement moves the daily mean enough to matter (>= 1 °C spread)', () => {
  const spread = dailyMeanSolar(0.5) - dailyMeanSolar(0);
  assert.ok(spread >= 1, `placement lever collapsed to ${spread.toFixed(2)} °C of daily mean`);
});

test('the FULL placement lever (sun + gradient) is several degrees of daily mean', () => {
  // What the player actually feels is both terms together. The sun contributes
  // ~1.6 °C of daily mean between mid-wall and an end; the gradient adds a signed
  // offset around the clock, so the warm-end/cold-end spread is far larger. This
  // is the assertion that placement is a real decision rather than a rounding
  // error next to species and composter choice.
  const dailyMeanTotal = (p) => {
    let sum = 0;
    for (let h = 0; h < 24; h++) sum += solarGain(p, h) + positionBias(p, 1);
    return sum / 24;
  };
  const spread = dailyMeanTotal(1) - dailyMeanTotal(0);
  assert.ok(spread >= 4, `warm-end vs cold-end spread collapsed to ${spread.toFixed(2)} °C`);
});

test('the sunny spot still cannot cook a well-placed bin on its own', () => {
  // Upper guard: solar alone (no fermentation) must leave headroom under the
  // ~38 °C lethal line, or good care in the sun becomes unsurvivable.
  let peak = 0;
  for (let h = 0; h < 24; h++) peak = Math.max(peak, ambientTemperature(h) + solarGain(0.5, h));
  assert.ok(peak < 38, `bare sun peak reached ${peak.toFixed(1)} °C`);
});

test('NO placement can cook an unfed bin, including where sun and gradient stack', () => {
  // The guard above samples position 0.5 only, and the worst spot is NOT 0.5:
  // the target peaks near 0.66, where the sweeping patch passes overhead just as
  // the ambient cycle crests. That region was never checked before the gradient
  // existed, and it is exactly where the gradient adds its heat.
  //
  // Asserted on the BIN temperature rather than the target, because that is what
  // kills worms — the bin only ever closes `tempResponse` of the gap each tick,
  // so the target running hot is survivable in a way the bin running hot is not.
  // tier2 is the catalog's most exposed model (tempResponse 0.6).
  const tier2 = getComposter('tier2');
  let worst = { temp: -Infinity, pos: 0 };
  for (let p = 0; p <= 1.0001; p += 0.01) {
    let temp = 20;
    for (let d = 0; d < 10; d++) {
      for (let h = 0; h < 24; h++) {
        const target = ambientTemperature(h) + solarGain(p, h) + positionBias(p, 1);
        temp = blendTemperature(temp, target, tier2);
        if (d >= 4 && temp > worst.temp) worst = { temp, pos: p };
      }
    }
  }
  assert.ok(
    worst.temp < 38,
    `an UNFED bin at the worst spot (${worst.pos.toFixed(2)}) reached ${worst.temp.toFixed(2)} °C — ` +
      'placement alone must never be lethal, since the player still has to add food',
  );
});
