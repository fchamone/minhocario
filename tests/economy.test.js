import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialFarmState,
  HUMUS_PRICE_PER_LITER,
  LEACHATE_PRICE_PER_LITER,
  STARTING_WALLET,
  wormPackPrice,
  sellHumus,
  sellLeachate,
  harvestAndSell,
  drainAndSell,
  buyWormPack,
  repopulateColony,
  migrateToComposter,
} from '../js/sim/engine.js';
import { listComposters, getComposter } from '../js/sim/composters.js';
import { listSpecies } from '../js/sim/worms.js';
import { scorePoints } from '../js/sim/scoring.js';

// A farm with a live colony. Individual tests override the fields they exercise.
function farm(overrides = {}) {
  const base = createInitialFarmState({
    seed: 1,
    composterId: 'tier2',
    speciesId: 'californiana',
  });
  return {
    ...base,
    population: { cocoons: 0, juveniles: 0, adults: 500 },
    ...overrides,
  };
}

const cheapestComposter = () => listComposters().reduce((a, b) => (a.price <= b.price ? a : b));
const cheapestSpecies = () => listSpecies().reduce((a, b) => (a.price <= b.price ? a : b));

// --- auto-sell prices --------------------------------------------------------

test('sellHumus / sellLeachate return liters × the fixed per-liter price', () => {
  assert.equal(sellHumus(3), 3 * HUMUS_PRICE_PER_LITER);
  assert.equal(sellLeachate(3), 3 * LEACHATE_PRICE_PER_LITER);
  assert.equal(sellHumus(0), 0);
  // humus is worth much more than leachate (§2.2)
  assert.ok(HUMUS_PRICE_PER_LITER > LEACHATE_PRICE_PER_LITER * 3);
});

test('harvestAndSell empties the tray, credits liters × price, and banks age-scaled points', () => {
  const s = farm({ humus: 4, colonyAgeDays: 30 });
  const r = harvestAndSell(s, 100);
  assert.equal(r.harvested, 4, 'reports the liters removed');
  assert.equal(r.coins, 4 * HUMUS_PRICE_PER_LITER, 'coins = liters × humus price');
  assert.equal(r.wallet, 100 + 4 * HUMUS_PRICE_PER_LITER, 'wallet credited');
  assert.equal(r.state.humus, 0, 'tray emptied');
  assert.equal(r.points, scorePoints(4, 30), 'points = age-scaled score');
  assert.equal(r.state.score, s.score + scorePoints(4, 30), 'score banked');
  assert.equal(s.humus, 4, 'input state not mutated');
});

test('drainAndSell empties the tank and credits leachate coins but NO score', () => {
  const s = farm({ leachate: 5, score: 42 });
  const r = drainAndSell(s, 10);
  assert.equal(r.drained, 5);
  assert.equal(r.coins, 5 * LEACHATE_PRICE_PER_LITER);
  assert.equal(r.wallet, 10 + 5 * LEACHATE_PRICE_PER_LITER);
  assert.equal(r.state.leachate, 0, 'tank emptied');
  assert.equal(r.state.score, 42, 'leachate never scores (§2.10)');
});

// --- buying worm packs -------------------------------------------------------

test('wormPackPrice scales by pack size with a bulk discount; invalid -> Infinity', () => {
  const sp = cheapestSpecies();
  const p50 = wormPackPrice(sp.id, 50);
  const p100 = wormPackPrice(sp.id, 100);
  const p200 = wormPackPrice(sp.id, 200);
  assert.equal(p50, sp.price, 'a 50-pack is the base species price');
  assert.ok(p100 > p50 && p200 > p100, 'bigger packs cost more in absolute terms');
  assert.ok(p100 < p50 * 2, 'a 100-pack is cheaper per worm than two 50-packs');
  assert.ok(p200 < p50 * 4, 'a 200-pack is cheaper per worm still');
  assert.equal(wormPackPrice('nope', 50), Infinity, 'unknown species -> Infinity');
  assert.equal(wormPackPrice(sp.id, 75), Infinity, 'unsupported size -> Infinity');
});

test('buyWormPack adds worms as adults, deducts price, and keeps a LIVE colony age', () => {
  const s = farm({ population: { cocoons: 0, juveniles: 0, adults: 500 }, colonyAgeDays: 12 });
  const price = wormPackPrice('californiana', 100);
  const r = buyWormPack(s, price + 50, 'californiana', 100);
  assert.equal(r.ok, true);
  assert.equal(r.state.population.adults, 600, '+100 worms as adults');
  assert.equal(r.wallet, 50, 'price deducted');
  assert.equal(r.state.colonyAgeDays, 12, 'adding to a LIVE colony keeps its age');
  assert.equal(s.population.adults, 500, 'input state not mutated');
});

test('buyWormPack is rejected when the wallet is short (state + wallet unchanged)', () => {
  const s = farm();
  const price = wormPackPrice('californiana', 200);
  const r = buyWormPack(s, price - 1, 'californiana', 200);
  assert.equal(r.ok, false);
  assert.equal(r.wallet, price - 1, 'wallet unchanged');
  assert.deepEqual(r.state, s, 'state unchanged');
});

test('buyWormPack rejects an unknown species and an unsupported pack size', () => {
  const s = farm();
  assert.equal(buyWormPack(s, 1e6, 'nope', 50).ok, false);
  assert.equal(buyWormPack(s, 1e6, 'californiana', 75).ok, false);
});

test('repopulating a DEAD colony resets age to 0 but keeps banked totals (§2.1)', () => {
  const dead = farm({
    population: { cocoons: 0, juveniles: 0, adults: 0 },
    colonyAlive: false,
    colonyAgeDays: 25,
    score: 500,
    humus: 2,
    leachate: 1,
  });
  const price = wormPackPrice('californiana', 50);
  const r = repopulateColony(dead, price, 'californiana', 50);
  assert.equal(r.ok, true);
  assert.equal(r.state.colonyAlive, true, 'colony is alive again');
  assert.equal(r.state.colonyAgeDays, 0, 'age reset to zero');
  assert.equal(r.state.population.adults, 50, 'worms added as adults');
  assert.equal(r.state.score, 500, 'banked score kept');
  assert.equal(r.state.humus, 2, 'humus kept');
  assert.equal(r.state.leachate, 1, 'leachate kept');
  assert.equal(r.wallet, 0, 'price deducted');
});

// --- mid-farm composter migration (§2.2) ------------------------------------

test('migrateToComposter carries the colony, sells the old bin, and credits the trade-in', () => {
  const s = farm({
    composterId: 'tier2',
    population: { cocoons: 3, juveniles: 7, adults: 500 },
    queue: [{ foodId: 'vegetableScraps', liters: 5, addedAtTick: 0 }],
    colonyAgeDays: 18,
    score: 250,
    humus: 3,
    leachate: 2,
  });
  const oldC = getComposter('tier2');
  const newC = getComposter('tier4'); // larger + more expensive
  const tradeIn = 0.5 * oldC.price;
  const sale = sellHumus(3) + sellLeachate(2);
  const wallet0 = newC.price; // comfortably covers the net cost (newPrice − tradeIn)

  const r = migrateToComposter(s, wallet0, 'tier4');
  assert.equal(r.ok, true);
  assert.equal(r.state.composterId, 'tier4', 'switched model');
  assert.deepEqual(r.state.population, s.population, 'population carried');
  assert.equal(r.state.colonyAgeDays, 18, 'colony age carried');
  assert.equal(r.state.colonyAlive, true, 'colony-alive flag carried');
  assert.equal(r.state.score, 250, 'score carried');
  assert.deepEqual(r.state.queue, s.queue, 'queue carried (fits the new capacity)');
  assert.deepEqual(r.state.env, s.env, 'bedding (env) carried');
  assert.equal(r.state.humus, 0, 'old humus auto-sold -> new bin empty');
  assert.equal(r.state.leachate, 0, 'old leachate auto-sold -> new bin empty');
  assert.equal(
    r.wallet,
    wallet0 + sale + tradeIn - newC.price,
    'wallet = start + old-bin sale + trade-in − new price',
  );
});

test('migrateToComposter is rejected for an unknown or same model, and when short', () => {
  const s = farm({ composterId: 'tier2', humus: 0, leachate: 0 });
  assert.equal(migrateToComposter(s, 1e6, 'nope').ok, false, 'unknown model rejected');
  assert.equal(migrateToComposter(s, 1e6, 'tier2').ok, false, 'same model rejected');

  const eco = getComposter('eco'); // the priciest model
  const tradeIn = 0.5 * getComposter('tier2').price;
  const short = migrateToComposter(s, eco.price - tradeIn - 1, 'eco');
  assert.equal(short.ok, false, 'wallet below net cost -> rejected');
  assert.deepEqual(short.state, s, 'state unchanged on rejection');
});

test('migrating to a SMALLER bin trims the carried queue oldest-first to capacity', () => {
  // eco (capacity 100) down to electric (capacity 20): a 32 L queue must be
  // trimmed to 20 L, keeping the oldest entries (closest to becoming humus) and
  // discarding the newest overflow.
  const electric = getComposter('electric');
  const s = farm({
    composterId: 'eco',
    queue: [
      { foodId: 'vegetableScraps', liters: 8, addedAtTick: 0 },
      { foodId: 'vegetableScraps', liters: 8, addedAtTick: 5 },
      { foodId: 'vegetableScraps', liters: 8, addedAtTick: 9 },
      { foodId: 'vegetableScraps', liters: 8, addedAtTick: 13 },
    ],
    humus: 0,
    leachate: 0,
  });
  const r = migrateToComposter(s, 1e6, 'electric');
  assert.equal(r.ok, true);
  const carried = r.state.queue.reduce((a, e) => a + e.liters, 0);
  assert.ok(carried <= electric.capacity + 1e-9, `queue trimmed to capacity: ${carried}`);
  assert.equal(r.state.queue[0].addedAtTick, 0, 'the oldest entry is kept');
  assert.ok(r.state.queue.length < s.queue.length, 'newest overflow discarded');
});

// --- starting budget affords the cheapest viable start (§2.2) ---------------

test('STARTING_WALLET affords cheapest composter + a 50-worm cheapest-species pack + bedding, with slack', () => {
  const composter = cheapestComposter();
  const species = cheapestSpecies();
  const packPrice = wormPackPrice(species.id, 50);
  const beddingCost = 0; // bedding is FREE (§2.2)
  const minStart = composter.price + packPrice + beddingCost;

  assert.ok(
    STARTING_WALLET >= minStart,
    `affords the cheapest start (${STARTING_WALLET} >= ${minStart})`,
  );
  assert.ok(STARTING_WALLET > minStart, 'leaves some slack over the bare minimum');
  assert.ok(
    STARTING_WALLET - minStart <= composter.price,
    'the slack is modest — not enough for a second composter',
  );
});
