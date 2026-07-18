import test from 'node:test';
import assert from 'node:assert/strict';
import { startingWormReserve, affordability } from '../js/ui/shop.js';
import { STARTING_WALLET, wormPackPrice } from '../js/sim/engine.js';
import { listComposters } from '../js/sim/composters.js';
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
