import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialFarmState,
  tick,
} from '../js/sim/engine.js';
import { COMPOSTERS, getComposter } from '../js/sim/composters.js';
import { createRng } from '../js/sim/rng.js';

// Build a farm with a live colony and a directly-seeded food queue. The queue is
// set on the state (bypassing addFood's capacity clamp) so identical inputs can
// be fed to composters of different sizes for the ordering test.
function farm(overrides = {}) {
  const base = createInitialFarmState({
    seed: 1,
    composterId: 'electric',
    speciesId: 'californiana',
  });
  return {
    ...base,
    population: { cocoons: 0, juveniles: 0, adults: 1000 },
    ...overrides,
  };
}

function entry(foodId, liters, addedAtTick = 0) {
  return { foodId, liters, addedAtTick };
}

const queueVolume = (s) => s.queue.reduce((sum, e) => sum + e.liters, 0);

/** Advance n ticks with a fresh RNG seeded from the state's own rngState. */
function run(state, n) {
  const rng = createRng(state.rngState);
  for (let i = 0; i < n; i++) state = tick(state, rng);
  return state;
}

// --- oldest-first consumption + removal ------------------------------------

test('worms consume the oldest queue entry first and remove it when depleted', () => {
  // A tiny oldest entry plus a large fresh one: one tick should finish the old
  // entry (removing it) and only nibble the new one.
  const s = farm({
    population: { cocoons: 0, juveniles: 0, adults: 3000 },
    queue: [entry('vegetableScraps', 0.5, 0), entry('vegetableScraps', 100, 1)],
  });
  const before = queueVolume(s);
  const s1 = run(s, 1);

  assert.equal(s1.queue.length, 1, 'the depleted oldest entry is removed');
  assert.equal(s1.queue[0].addedAtTick, 1, 'the surviving entry is the newer one');
  assert.ok(s1.queue[0].liters < 100, 'the newer entry was partially eaten');
  assert.ok(queueVolume(s1) < before, 'total queue volume dropped by what was eaten');
  assert.ok(s1.humus > 0, 'eaten food produced humus');
  assert.equal(s.queue.length, 2, 'input state was not mutated');
});

test('a single small entry is fully consumed and the queue empties', () => {
  const s = farm({
    population: { cocoons: 0, juveniles: 0, adults: 5000 },
    queue: [entry('vegetableScraps', 0.5, 0)],
  });
  const s1 = run(s, 1);
  assert.equal(s1.queue.length, 0, 'the only entry is fully eaten and removed');
});

// --- production converts eaten food into humus + leachate ------------------

test('eaten volume converts to humus and leachate at the composter rates', () => {
  const c = getComposter('electric');
  const s = farm({ queue: [entry('vegetableScraps', 100, 0)] });
  const s1 = run(s, 1);
  const eaten = 100 - queueVolume(s1);
  assert.ok(eaten > 0);
  assert.ok(Math.abs(s1.humus - eaten * c.humusRate) < 1e-9, 'humus = eaten x humusRate');
  assert.ok(
    Math.abs(s1.leachate - eaten * c.leachateRate) < 1e-9,
    'leachate = eaten x leachateRate',
  );
});

// --- per-model humus output ordering tracks the catalog --------------------

test('per-model humus output ordering matches humusRate x speed', () => {
  // Feed an identical population + queue to every composter for one tick and
  // collect humus per model; ordering must track composter.speed x humusRate.
  const humusById = {};
  const productById = {};
  for (const c of COMPOSTERS) {
    const s = farm({ composterId: c.id, queue: [entry('vegetableScraps', 100, 0)] });
    const s1 = run(s, 1);
    humusById[c.id] = s1.humus;
    productById[c.id] = c.speed * c.humusRate;
    assert.ok(s1.humus < c.humusCapacity, `${c.id} did not hit its tray cap`);
  }

  const byHumus = [...COMPOSTERS.map((c) => c.id)].sort(
    (a, b) => humusById[a] - humusById[b],
  );
  const byProduct = [...COMPOSTERS.map((c) => c.id)].sort(
    (a, b) => productById[a] - productById[b],
  );
  assert.deepEqual(byHumus, byProduct, 'humus ordering follows humusRate x speed');

  // and a concrete pair: the fast eco tray out-produces the slow 2-tier
  assert.ok(humusById.eco > humusById.tier2, 'eco out-produces tier2');
});

// --- consumption scales with population and species speed ------------------

test('consumption scales with the active worm population', () => {
  const few = farm({
    population: { cocoons: 0, juveniles: 0, adults: 500 },
    queue: [entry('vegetableScraps', 100, 0)],
  });
  const many = farm({
    population: { cocoons: 0, juveniles: 0, adults: 1500 },
    queue: [entry('vegetableScraps', 100, 0)],
  });
  const eatenFew = 100 - queueVolume(run(few, 1));
  const eatenMany = 100 - queueVolume(run(many, 1));
  assert.ok(eatenMany > eatenFew, `more worms eat more: ${eatenMany} vs ${eatenFew}`);
});

test('a faster-eating species processes more of the queue', () => {
  const slow = farm({ speciesId: 'californiana', queue: [entry('vegetableScraps', 100, 0)] });
  const fast = farm({ speciesId: 'africana', queue: [entry('vegetableScraps', 100, 0)] });
  const eatenSlow = 100 - queueVolume(run(slow, 1));
  const eatenFast = 100 - queueVolume(run(fast, 1));
  assert.ok(eatenFast > eatenSlow, `africana out-eats californiana: ${eatenFast} vs ${eatenSlow}`);
});

test('an empty or dead colony consumes nothing', () => {
  const dead = farm({
    population: { cocoons: 0, juveniles: 0, adults: 0 },
    queue: [entry('vegetableScraps', 10, 0)],
  });
  const s1 = run(dead, 1);
  assert.equal(queueVolume(s1), 10, 'no worms -> queue untouched');
  assert.equal(s1.humus, 0, 'no worms -> no humus');
  assert.equal(s1.leachate, 0, 'no worms -> no leachate');
});

// --- determinism -----------------------------------------------------------

test('production replays identically per seed and stays JSON-serializable', () => {
  const build = () =>
    farm({
      population: { cocoons: 4, juveniles: 12, adults: 800 },
      queue: [entry('vegetableScraps', 50, 0), entry('coffeeGrounds', 30, 2)],
    });
  const a = run(build(), 20);
  const b = run(build(), 20);
  assert.deepEqual(a, b, 'same seed + same actions -> identical state');
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a, 'state round-trips through JSON');
});
