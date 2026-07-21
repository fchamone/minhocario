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

// --- Why a model is out of reach, not just that it is -------------------------
//
// Reported from play: with the starting 200 coins the electric bin (price 200)
// shows "Saldo insuficiente" / "Not enough coins" — while the wallet reads 200.
// From the player's side that is simply false, and it is the exact boundary
// where the message matters most: they CAN buy the bin, they just cannot then
// buy a single worm, and nothing on the card says so.
//
// The rule is unchanged (it is the T7 starting-budget invariant); what changes
// is that the two ways of being unaffordable are now distinguishable, so the UI
// can say which one applies.

test('a model priced within the wallet but not within the reserve is flagged separately', () => {
  const reserve = startingWormReserve();
  const model = listComposters()[0];

  // Exactly the reported case: wallet == price, so the bin alone is coverable.
  const atPrice = affordability(model.price, [model], reserve)[0];
  assert.equal(atPrice.affordable, false, 'still not startable — no worms could be bought');
  assert.equal(
    atPrice.blockedByReserve,
    true,
    'the wallet covers the bin; it is the worm reserve that is missing',
  );
  assert.equal(atPrice.shortfall, reserve, 'shortfall is exactly the missing reserve');
});

test('a model priced beyond the wallet is not blamed on the worm reserve', () => {
  const reserve = startingWormReserve();
  const model = listComposters()[0];
  const wallet = model.price - 10;

  const row = affordability(wallet, [model], reserve)[0];
  assert.equal(row.affordable, false);
  assert.equal(row.blockedByReserve, false, 'the bin itself is out of reach — plain shortfall');
  assert.equal(row.shortfall, model.price + reserve - wallet);
});

test('an affordable model reports no shortfall and no reserve block', () => {
  const model = listComposters().reduce((a, b) => (a.price <= b.price ? a : b));
  const row = affordability(model.price + startingWormReserve(), [model])[0];
  assert.equal(row.affordable, true);
  assert.equal(row.blockedByReserve, false);
  assert.equal(row.shortfall, 0);
});

test('at the starting wallet the electric bin is blocked by the reserve, not its price', () => {
  // The reported case, asserted against the real catalog and the real wallet
  // rather than a constructed one — so a retune of either number keeps this
  // honest instead of quietly making it vacuous.
  const rows = affordability(STARTING_WALLET);
  const electric = rows.find((r) => r.composter.id === 'electric');
  assert.ok(electric, 'the catalog should still carry the electric model');

  if (STARTING_WALLET >= electric.composter.price) {
    assert.equal(electric.affordable, false);
    assert.equal(electric.blockedByReserve, true);
  } else {
    // If a future retune puts the bin itself out of reach, the message should
    // go back to the plain one — and this test should say so rather than fail.
    assert.equal(electric.blockedByReserve, false);
  }
});

test('the upgrade shop never blames the worm reserve — it has none', () => {
  // Mid-farm there is no reserve at all (the colony migrates), so a blocked
  // upgrade is always a plain price shortfall. Getting this wrong would show
  // "leaves you no worms" to a player whose worms are already in the bin.
  for (const offer of upgradeOffers('tier2', 0)) {
    assert.equal(offer.blockedByReserve ?? false, false);
  }
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
