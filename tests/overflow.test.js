import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialFarmState,
  tick,
  drainLeachate,
  harvestHumus,
} from '../js/sim/engine.js';
import { getComposter } from '../js/sim/composters.js';
import { createRng } from '../js/sim/rng.js';

// A farm with a live colony (kept under carrying capacity so overpopulation
// mortality does not muddy the overflow chains) and a directly-seeded queue.
function farm(overrides = {}) {
  const base = createInitialFarmState({
    seed: 1,
    composterId: 'electric',
    speciesId: 'californiana',
  });
  return {
    ...base,
    population: { cocoons: 0, juveniles: 0, adults: 900 },
    ...overrides,
  };
}

function entry(foodId, liters, addedAtTick = 0) {
  return { foodId, liters, addedAtTick };
}

const queueVolume = (s) => s.queue.reduce((sum, e) => sum + e.liters, 0);

// --- tank-full chain: moisture spikes ONLY after leachate reaches capacity --

test('leachate never drained spikes moisture only after the tank hits capacity', () => {
  const cap = getComposter('electric').leachateCapacity;
  // Eggshells release NO moisture as they decompose, so the ONLY thing that can
  // move moisture here is leachate backing up once the tank is full.
  let s = farm({ queue: [entry('eggshells', 200, 0)] });
  const m0 = s.env.moisture;
  const rng = createRng(s.rngState);

  let reachedCapAt = -1;
  for (let i = 0; i < 200; i++) {
    s = tick(s, rng);
    // Keep harvesting the tray so processing never halts on a full humus tray;
    // this isolates the leachate (tank) chain.
    s = harvestHumus(s).state;

    if (s.leachate < cap - 1e-6) {
      assert.equal(s.env.moisture, m0, `no moisture spike before the tank is full (tick ${i})`);
    } else if (reachedCapAt < 0) {
      reachedCapAt = i;
    }
  }

  assert.ok(reachedCapAt >= 0, 'the tank eventually reached capacity');
  assert.equal(s.leachate, cap, 'leachate clamps at the tank capacity');
  assert.ok(s.env.moisture > m0, 'moisture spikes once the tank overflows');
});

// --- tray-full chain: production halts, THEN toxicity climbs ----------------

test('humus never harvested halts production, then the stranded queue rots toxicity up', () => {
  const cap = getComposter('electric').humusCapacity;
  // vegetableScraps carry zero toxicity of their own, so any toxicity rise here
  // is purely the anaerobic rot of the stranded, unprocessed queue.
  let s = farm({ queue: [entry('vegetableScraps', 300, 0)] });
  const rng = createRng(s.rngState);

  const humus = [];
  const tox = [];
  for (let i = 0; i < 90; i++) {
    s = tick(s, rng);
    humus.push(s.humus);
    tox.push(s.env.toxicity);
  }

  const last = humus.length - 1;
  const maxHumus = Math.max(...humus);
  assert.ok(maxHumus <= cap + 1e-9, 'humus never exceeds the tray capacity');
  assert.ok(Math.abs(humus[last] - cap) < 1e-6, 'humus reached and held at the tray cap');

  const haltAt = humus.findIndex((h) => h >= cap - 1e-6);
  assert.ok(haltAt > 0, 'production climbed before halting');
  // production is halted from the moment the tray is full: humus stops rising
  for (let i = haltAt; i <= last; i++) {
    assert.ok(Math.abs(humus[i] - cap) < 1e-6, `production stays halted at the cap (tick ${i})`);
  }

  // toxicity was quiet while the tray still had room, then climbs from the rot
  assert.ok(tox[haltAt] < 1e-6, 'no toxicity while the suitable food was still being processed');
  assert.ok(tox[last] > tox[haltAt], 'toxicity climbs after the tray fills and food rots');
  assert.ok(tox[last] > 0.05, `rot drives a clear toxicity climb: ${tox[last]}`);
});

// --- drain and harvest reset levels and re-enable processing ---------------

test('harvestHumus empties the tray, surfaces the volume, and re-enables processing', () => {
  const cap = getComposter('electric').humusCapacity;
  const rng = createRng(1);

  // A full tray: one tick processes nothing (queue untouched, humus pinned).
  let full = farm({ humus: cap, queue: [entry('vegetableScraps', 300, 0)] });
  const stalled = tick(full, rng);
  assert.equal(queueVolume(stalled), 300, 'a full tray halts consumption (queue untouched)');
  assert.equal(stalled.humus, cap, 'humus stays pinned at the cap while halted');

  // Harvest surfaces the volume removed and empties the tray.
  const h = harvestHumus(stalled);
  assert.equal(h.harvested, cap, 'harvest reports the liters removed');
  assert.equal(h.state.humus, 0, 'harvest empties the tray');

  // Processing is re-enabled: the next tick eats and produces again.
  const resumed = tick(h.state, rng);
  assert.ok(queueVolume(resumed) < 300, 'consumption resumes after harvest');
  assert.ok(resumed.humus > 0, 'humus is produced again after harvest');
});

test('drainLeachate empties the tank, surfaces the volume, and relieves the moisture spike', () => {
  const cap = getComposter('electric').leachateCapacity;
  const rng = createRng(1);

  // Tank already full: without draining, the next tick's production overflows
  // and spikes moisture. Eggshells add no moisture of their own.
  const brimming = farm({ leachate: cap, queue: [entry('eggshells', 200, 0)] });
  const m0 = brimming.env.moisture;

  const notDrained = tick(brimming, createRng(1));
  assert.ok(notDrained.env.moisture > m0, 'an undrained full tank spikes moisture');

  const d = drainLeachate(brimming);
  assert.equal(d.drained, cap, 'drain reports the liters removed');
  assert.equal(d.state.leachate, 0, 'drain empties the tank');

  const drainedThenTick = tick(d.state, rng);
  assert.ok(drainedThenTick.leachate < cap, 'tank refills from empty, below capacity');
  assert.equal(drainedThenTick.env.moisture, m0, 'no moisture spike once the tank is drained');
});
