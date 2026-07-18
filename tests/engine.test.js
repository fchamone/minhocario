import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialFarmState,
  tick,
  beddingEnv,
  RECOMMENDED_BEDDING,
} from '../js/sim/engine.js';
import { createRng } from '../js/sim/rng.js';
import { getSpecies } from '../js/sim/worms.js';

test('createInitialFarmState starts at day 1, hour 0', () => {
  const s = createInitialFarmState({ seed: 1 });
  assert.equal(s.day, 1);
  assert.equal(s.hour, 0);
});

test('createInitialFarmState applies provided options', () => {
  const s = createInitialFarmState({
    seed: 5,
    composterId: 'electric',
    speciesId: 'californiana',
    wallPosition: 0.3,
  });
  assert.equal(s.composterId, 'electric');
  assert.equal(s.speciesId, 'californiana');
  assert.equal(s.wallPosition, 0.3);
});

test('one tick advances one hour', () => {
  const s0 = createInitialFarmState({ seed: 1 });
  const rng = createRng(s0.rngState);
  const s1 = tick(s0, rng);
  assert.equal(s1.hour, 1);
  assert.equal(s1.day, 1);
});

test('24 ticks advance exactly one day and wrap the hour 23 -> 0', () => {
  let s = createInitialFarmState({ seed: 1 });
  const rng = createRng(s.rngState);
  for (let i = 0; i < 23; i++) s = tick(s, rng);
  assert.equal(s.day, 1);
  assert.equal(s.hour, 23);
  s = tick(s, rng); // 24th tick
  assert.equal(s.day, 2);
  assert.equal(s.hour, 0);
});

test('tick returns a new state and does not mutate the input', () => {
  const s0 = createInitialFarmState({ seed: 1 });
  const rng = createRng(s0.rngState);
  const s1 = tick(s0, rng);
  assert.notEqual(s1, s0);
  assert.equal(s0.day, 1);
  assert.equal(s0.hour, 0);
});

test('tick threads the RNG state into the returned farm state', () => {
  const s0 = createInitialFarmState({ seed: 1 });
  const rng = createRng(s0.rngState);
  const s1 = tick(s0, rng);
  assert.equal(s1.rngState, rng.state);
});

test('farm state round-trips through JSON deep-equal (initial and after ticks)', () => {
  let s = createInitialFarmState({ seed: 99 });
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);

  const rng = createRng(s.rngState);
  for (let i = 0; i < 50; i++) s = tick(s, rng);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

// --- bedding mix -> initial moisture/pH (T12 setup helper) -------------------

test('the recommended bedding mix lands moisture and pH inside the comfort bands', () => {
  const { moisture, ph } = beddingEnv(RECOMMENDED_BEDDING);
  // pH comfort band is 6..8 (worms.js PH_COMFORT).
  assert.ok(ph >= 6 && ph <= 8, `pH inside comfort band: ${ph}`);
  // Moisture must sit inside even the NARROWEST species band (azul 0.55..0.72),
  // so the guided default is comfortable whichever species the player picks.
  const azul = getSpecies('azul').moistureComfort;
  assert.ok(
    moisture >= azul.min && moisture <= azul.max,
    `moisture inside the narrowest band: ${moisture}`,
  );
});

test('deviating the bedding mix shifts moisture and pH predictably', () => {
  const base = beddingEnv(RECOMMENDED_BEDDING);
  const drier = beddingEnv({ ...RECOMMENDED_BEDDING, sawdust: RECOMMENDED_BEDDING.sawdust + 6 });
  const sour = beddingEnv({ ...RECOMMENDED_BEDDING, peels: RECOMMENDED_BEDDING.peels + 6 });
  const wetter = beddingEnv({ ...RECOMMENDED_BEDDING, cardboard: RECOMMENDED_BEDDING.cardboard + 6 });
  assert.ok(drier.moisture < base.moisture, 'more sawdust dries the bin');
  assert.ok(sour.ph < base.ph, 'more fruit peels acidify the bin');
  assert.ok(wetter.moisture > base.moisture, 'more wet cardboard wets the bin');
});

test('beddingEnv falls back to neutral defaults for an empty mix', () => {
  const { moisture, ph } = beddingEnv({ sawdust: 0, peels: 0, cardboard: 0 });
  assert.equal(moisture, 0.5);
  assert.equal(ph, 7);
});

test('createInitialFarmState merges an env override over the defaults', () => {
  const s = createInitialFarmState({ seed: 1, env: { moisture: 0.6, ph: 6.5 } });
  assert.equal(s.env.moisture, 0.6);
  assert.equal(s.env.ph, 6.5);
  assert.equal(s.env.toxicity, 0, 'unspecified env fields keep their defaults');
  assert.equal(s.env.temperature, 20);
});
