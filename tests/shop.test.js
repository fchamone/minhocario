import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startingWormReserve,
  affordability,
  tradeInValue,
  upgradeOffers,
} from '../js/ui/shop.js';
import {
  STARTING_WALLET,
  wormPackPrice,
  createInitialFarmState,
  migrateToComposter,
} from '../js/sim/engine.js';
import { listComposters, getComposter } from '../js/sim/composters.js';
import { listSpecies } from '../js/sim/worms.js';

const cheapestComposter = listComposters().reduce((a, b) => (a.price <= b.price ? a : b));
const cheapestSpecies = listSpecies().reduce((a, b) => (a.price <= b.price ? a : b));

// --- startingWormReserve: the coins kept back for the first colony ------------

test('startingWormReserve equals the cheapest 50-worm pack price (bedding is free)', () => {
  assert.equal(startingWormReserve(), wormPackPrice(cheapestSpecies.id, 50));
});

// --- affordability: a UI mirror of the T7 starting-budget invariant ----------

test('affordability annotates every catalog model in display order', () => {
  const rows = affordability(STARTING_WALLET);
  assert.deepEqual(
    rows.map((r) => r.composter.id),
    listComposters().map((c) => c.id),
  );
  for (const row of rows) assert.equal(typeof row.affordable, 'boolean');
});

test('a first purchase is startable only when it leaves the worm reserve', () => {
  const reserve = startingWormReserve();
  for (const { composter, affordable } of affordability(STARTING_WALLET)) {
    assert.equal(affordable, STARTING_WALLET >= composter.price + reserve);
  }
});

test('the starting wallet can start the cheapest model but not the most expensive', () => {
  const rows = affordability(STARTING_WALLET);
  const cheapest = rows.find((r) => r.composter.id === cheapestComposter.id);
  assert.equal(cheapest.affordable, true, 'cheapest composter is startable');
  assert.ok(rows.some((r) => !r.affordable), 'at least one model is out of reach at the start');
});

test('affordability accepts an explicit reserve (collapses to wallet >= price at 0)', () => {
  for (const { composter, affordable } of affordability(300, listComposters(), 0)) {
    assert.equal(affordable, 300 >= composter.price);
  }
});

test('an empty wallet affords nothing', () => {
  assert.ok(affordability(0).every((r) => !r.affordable));
});

// --- Mid-farm upgrade (T15) ---------------------------------------------------
//
// The shop must quote exactly what `migrateToComposter` will charge. These tests
// cross-check the UI's arithmetic against the ENGINE's accept/reject decision,
// so the two can never drift into quoting a price the engine then refuses.

test('tradeInValue is half the current model price', () => {
  for (const c of listComposters()) {
    assert.equal(tradeInValue(c.id), c.price * 0.5);
  }
});

test('tradeInValue is zero without a current composter', () => {
  assert.equal(tradeInValue(null), 0);
  assert.equal(tradeInValue('nope'), 0);
});

test('upgradeOffers quotes net cost = new price minus the trade-in', () => {
  const current = getComposter('tier2');
  for (const offer of upgradeOffers('tier2', 1000)) {
    assert.equal(offer.netCost, offer.composter.price - current.price * 0.5);
    assert.equal(offer.tradeIn, current.price * 0.5);
  }
});

test('upgradeOffers marks the model already in use, and it is not buyable', () => {
  const offers = upgradeOffers('tier2', 1000);
  const currentOffer = offers.find((o) => o.composter.id === 'tier2');
  assert.equal(currentOffer.isCurrent, true);
  assert.equal(currentOffer.affordable, false, 'cannot migrate to the model you are on');
  for (const other of offers.filter((o) => o.composter.id !== 'tier2')) {
    assert.equal(other.isCurrent, false);
  }
});

test('upgradeOffers agrees with migrateToComposter on every model at every wallet', () => {
  // The real guard: for each (wallet, target) pair, the shop's `affordable`
  // must match whether the engine actually performs the migration.
  const farm = createInitialFarmState({ seed: 3, composterId: 'tier2', speciesId: 'californiana' });
  for (const wallet of [0, 25, 50, 100, 200, 400, 1000]) {
    for (const offer of upgradeOffers('tier2', wallet)) {
      const engine = migrateToComposter(farm, wallet, offer.composter.id);
      assert.equal(
        offer.affordable,
        engine.ok,
        `wallet ${wallet} → ${offer.composter.id}: shop says ${offer.affordable}, engine says ${engine.ok}`,
      );
    }
  }
});

test('a trade-in makes an upgrade cheaper than a first purchase', () => {
  const target = getComposter('eco');
  const offer = upgradeOffers('tier2', 10000).find((o) => o.composter.id === 'eco');
  assert.ok(offer.netCost < target.price, 'the trade-in credit reduces the price');
});

test('upgradeOffers falls back to full price with no current composter', () => {
  for (const offer of upgradeOffers(null, 1000)) {
    assert.equal(offer.tradeIn, 0);
    assert.equal(offer.netCost, offer.composter.price);
  }
});
