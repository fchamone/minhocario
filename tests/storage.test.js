import test from 'node:test';
import assert from 'node:assert/strict';
import {
  save,
  load,
  migrate,
  createMemoryBackend,
  SAVE_KEY,
  CURRENT_VERSION,
  LOAD_STATUS,
} from '../js/storage.js';
import { createInitialFarmState, tick } from '../js/sim/engine.js';
import { createRng } from '../js/sim/rng.js';

// A farm whose clock and RNG have actually advanced, so the round-trip test
// proves the serializable RNG state (a non-default number) survives save/load —
// the whole point of storing rngState inside the farm (js/sim/rng.js header).
function farmWithHistory() {
  let state = createInitialFarmState({
    seed: 12345,
    composterId: 'tier2',
    speciesId: 'californiana',
    wallPosition: 0.4,
  });
  // Seed a real colony so populationStep draws the RNG each tick.
  state = { ...state, population: { cocoons: 10, juveniles: 20, adults: 30 } };
  for (let i = 0; i < 50; i++) {
    const rng = createRng(state.rngState);
    state = tick(state, rng);
  }
  return state;
}

function samplePayload() {
  return {
    v: CURRENT_VERSION,
    profile: { nickname: 'MinhocaVeloz42', wallet: 173 },
    farm: farmWithHistory(),
    ranking: [
      {
        nickname: 'MinhocaVeloz42',
        score: 420,
        composterId: 'tier2',
        daysSurvived: 12,
        createdAt: 1000,
      },
    ],
  };
}

// --- round-trip (AC: save→load deep-equal, including RNG state) --------------

test('save→load round-trips deep-equal, RNG state included', () => {
  const backend = createMemoryBackend();
  const payload = samplePayload();

  const res = save(payload, backend);
  assert.equal(res.ok, true);

  const loaded = load(backend);
  assert.equal(loaded.status, LOAD_STATUS.OK);
  assert.deepEqual(loaded.save, payload);

  // The RNG state specifically: it advanced away from the seed and survived.
  assert.notEqual(payload.farm.rngState, 12345 >>> 0, 'rngState should have advanced');
  assert.equal(loaded.save.farm.rngState, payload.farm.rngState);
});

test('save stamps the current version even if the payload omits it', () => {
  const backend = createMemoryBackend();
  const payload = samplePayload();
  delete payload.v;
  save(payload, backend);
  const stored = JSON.parse(backend.getItem(SAVE_KEY));
  assert.equal(stored.v, CURRENT_VERSION);
});

// --- migration (AC: stubbed v0 payload migrates to valid v1) -----------------

test('migrate upgrades a flat v0 payload into the nested v1 shape', () => {
  // v0 = pre-versioned prototype: flat player fields, no ranking, no `v`.
  const v0 = { nickname: 'Old42', wallet: 88, farm: { day: 3, hour: 5 } };
  const up = migrate(v0);
  assert.equal(up.v, 1);
  assert.equal(up.profile.nickname, 'Old42');
  assert.equal(up.profile.wallet, 88);
  assert.deepEqual(up.farm, { day: 3, hour: 5 });
  assert.deepEqual(up.ranking, []);
});

test('migrate is a no-op on a current-version payload', () => {
  const v1 = {
    v: 1,
    profile: { nickname: 'X', wallet: 0 },
    farm: null,
    ranking: [],
  };
  assert.deepEqual(migrate(v1), v1);
});

test('load migrates a stored v0 save to a valid v1 without rewriting it', () => {
  const v0 = { nickname: 'Old42', wallet: 150, farm: { day: 3 } };
  const backend = createMemoryBackend({ [SAVE_KEY]: JSON.stringify(v0) });

  const loaded = load(backend);
  assert.equal(loaded.status, LOAD_STATUS.OK);
  assert.equal(loaded.save.v, 1);
  assert.equal(loaded.save.profile.nickname, 'Old42');
  assert.equal(loaded.save.profile.wallet, 150);
  assert.deepEqual(loaded.save.farm, { day: 3 });
  assert.deepEqual(loaded.save.ranking, []);

  // load is read-only: the stored bytes are untouched (T10 persists the upgrade
  // through a normal autosave, not as a load side effect).
  assert.deepEqual(JSON.parse(backend.getItem(SAVE_KEY)), v0);
});

// --- future / corrupt: never silently discard (AC) ---------------------------

test('load surfaces a future-version save instead of discarding it', () => {
  const future = {
    v: CURRENT_VERSION + 1,
    profile: { nickname: 'FromTheFuture', wallet: 999 },
    farm: {},
    ranking: [],
  };
  const backend = createMemoryBackend({ [SAVE_KEY]: JSON.stringify(future) });

  const loaded = load(backend);
  assert.equal(loaded.status, LOAD_STATUS.FUTURE);
  assert.deepEqual(loaded.save, future, 'the future save is handed back, not dropped');
});

test('save refuses to overwrite a future-version save unless forced', () => {
  const future = {
    v: CURRENT_VERSION + 1,
    profile: { nickname: 'FromTheFuture', wallet: 999 },
    farm: {},
    ranking: [],
  };
  const backend = createMemoryBackend({ [SAVE_KEY]: JSON.stringify(future) });

  const refused = save(samplePayload(), backend);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'future');
  assert.deepEqual(
    JSON.parse(backend.getItem(SAVE_KEY)),
    future,
    'the future save must be left intact',
  );

  const forced = save(samplePayload(), backend, { force: true });
  assert.equal(forced.ok, true);
  assert.equal(JSON.parse(backend.getItem(SAVE_KEY)).v, CURRENT_VERSION);
});

test('load reports a corrupt (unparseable) save without discarding it', () => {
  const backend = createMemoryBackend({ [SAVE_KEY]: '{ this is not: json' });
  const loaded = load(backend);
  assert.equal(loaded.status, LOAD_STATUS.CORRUPT);
  // still there, untouched
  assert.equal(backend.getItem(SAVE_KEY), '{ this is not: json');
});

test('save refuses to overwrite a corrupt save unless forced', () => {
  const backend = createMemoryBackend({ [SAVE_KEY]: '{ broken' });
  const refused = save(samplePayload(), backend);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'corrupt');
  assert.equal(backend.getItem(SAVE_KEY), '{ broken', 'corrupt save left intact');

  const forced = save(samplePayload(), backend, { force: true });
  assert.equal(forced.ok, true);
});

// --- empty slot --------------------------------------------------------------

test('load reports an empty slot when nothing is stored', () => {
  assert.equal(load(createMemoryBackend()).status, LOAD_STATUS.EMPTY);
});

test('save into an empty slot succeeds and is immediately loadable', () => {
  const backend = createMemoryBackend();
  const payload = samplePayload();
  assert.equal(save(payload, backend).ok, true);
  assert.equal(load(backend).status, LOAD_STATUS.OK);
});

// --- injectable backend ------------------------------------------------------

test('createMemoryBackend implements the getItem/setItem/removeItem contract', () => {
  const backend = createMemoryBackend();
  assert.equal(backend.getItem('k'), null);
  backend.setItem('k', 'v');
  assert.equal(backend.getItem('k'), 'v');
  backend.removeItem('k');
  assert.equal(backend.getItem('k'), null);
});
