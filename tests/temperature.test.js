import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ambientTemperature,
  solarGain,
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
