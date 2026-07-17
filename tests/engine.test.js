import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialFarmState, tick } from '../js/sim/engine.js';
import { createRng } from '../js/sim/rng.js';

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
