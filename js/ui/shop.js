// Shop screen (first purchase): one card per composter model, wallet display,
// and a Buy action that carries the chosen model to setup. Unaffordable models
// are disabled with a localized reason.
//
// "Affordable" here mirrors the T7 starting-budget invariant: a FIRST purchase
// must leave enough coins to stock the minimum colony at setup (a 50-worm pack
// of the cheapest species; bedding is free, §2.2). The mid-farm trade-in shop
// (net cost = price − 50% trade-in, no worm reserve) arrives at T15.
//
// Layering: a UI module — pulls display copy through the i18n runtime
// (`strings.js`) and reads the composter/species catalogs + economy prices from
// the pure sim layer. `document` is touched ONLY inside the DOM functions, so
// the two pure helpers below are unit-tested under Node.

import { t } from '../strings.js';
import { listComposters, getComposter } from '../sim/composters.js';
import { listSpecies } from '../sim/worms.js';
import { wormPackPrice } from '../sim/engine.js';

/**
 * Coins that must remain AFTER buying a composter so the player can still stock
 * the minimum first colony (50 worms of the cheapest species; bedding is free).
 * @returns {number}
 */
export function startingWormReserve() {
  const cheapest = listSpecies().reduce((a, b) => (a.price <= b.price ? a : b));
  return wormPackPrice(cheapest.id, 50);
}

/**
 * Annotate each composter with whether `wallet` can buy it AND keep `reserve` —
 * i.e. whether it can begin a viable farm. Pure. Default reserve is the starting
 * worm reserve; pass `0` for the mid-farm case where no worms are bought.
 *
 * `blockedByReserve` separates the TWO ways a first purchase can be out of
 * reach, because they need different sentences. A bin the wallet cannot cover at
 * all is "not enough coins". A bin the wallet CAN cover, which would leave
 * nothing for worms, is not — and saying so was actively wrong at the boundary
 * that matters most: with the starting 200 coins the electric bin costs exactly
 * 200, so the card read "not enough coins" beside a wallet showing 200.
 *
 * @param {number} wallet
 * @param {readonly import('../sim/composters.js').Composter[]} [composters]
 * @param {number} [reserve]
 * @returns {{composter: import('../sim/composters.js').Composter, affordable: boolean,
 *   blockedByReserve: boolean, shortfall: number}[]}
 */
export function affordability(wallet, composters = listComposters(), reserve = startingWormReserve()) {
  return composters.map((composter) => {
    const affordable = wallet >= composter.price + reserve;
    return {
      composter,
      affordable,
      blockedByReserve: !affordable && wallet >= composter.price,
      shortfall: affordable ? 0 : composter.price + reserve - wallet,
    };
  });
}

/**
 * Trade-in credit for the model currently in use: half its catalog price.
 *
 * This MUST stay equal to the engine's own trade-in in `migrateToComposter`, or
 * the shop would quote a price the engine then refuses. A test cross-checks the
 * two on every model at a range of wallets rather than trusting this comment.
 * Pure.
 * @param {string|null} composterId the model currently in use
 * @returns {number} coins credited (0 when there is no current model)
 */
export function tradeInValue(composterId) {
  const current = getComposter(composterId);
  return current ? current.price * 0.5 : 0;
}

/**
 * The mid-farm upgrade menu: every model annotated with its trade-in credit, the
 * net cost after that credit, whether it is the model already in use, and
 * whether the wallet covers it.
 *
 * Unlike a first purchase there is NO worm reserve — the colony already exists
 * and migrates with the farm (§2.2), so the whole wallet is available. Pure.
 * @param {string|null} currentComposterId
 * @param {number} wallet
 * @param {readonly import('../sim/composters.js').Composter[]} [composters]
 * @returns {{composter: object, tradeIn: number, netCost: number,
 *   isCurrent: boolean, affordable: boolean}[]}
 */
export function upgradeOffers(currentComposterId, wallet, composters = listComposters()) {
  const tradeIn = tradeInValue(currentComposterId);
  return composters.map((composter) => {
    const isCurrent = composter.id === currentComposterId;
    const netCost = composter.price - tradeIn;
    return {
      composter,
      tradeIn,
      netCost,
      isCurrent,
      // Migrating to the model you are already on is rejected by the engine, so
      // it is never offered as affordable however rich the player is.
      affordable: !isCurrent && wallet >= netCost,
      // Always false here, and stated rather than omitted: mid-farm there IS no
      // worm reserve (the colony migrates with the farm), so a blocked upgrade
      // is always a plain price shortfall. Showing "leaves nothing for worms" to
      // a player whose worms are already in the bin would be nonsense.
      blockedByReserve: false,
      shortfall: isCurrent || wallet >= netCost ? 0 : netCost - wallet,
    };
  });
}

/**
 * Build one shop card for a composter.
 * @param {object} row
 * @param {import('../sim/composters.js').Composter} row.composter
 * @param {boolean} row.affordable
 * @param {number} row.cost          coins actually charged (price, or net cost)
 * @param {number} [row.tradeIn]     trade-in credit applied (upgrade mode)
 * @param {boolean} [row.isCurrent]  the model already in use (upgrade mode)
 * @param {(id: string) => void} onBuy
 * @returns {HTMLElement}
 */
function buildCard(
  { composter, affordable, cost, tradeIn = 0, isCurrent = false, blockedByReserve = false, shortfall = 0 },
  onBuy,
) {
  const card = document.createElement('article');
  card.className = 'shop-card';
  if (!affordable) card.classList.add('shop-card--disabled');
  if (isCurrent) card.classList.add('shop-card--current');

  const name = document.createElement('h3');
  name.textContent = t(`composters.${composter.id}.name`);

  const desc = document.createElement('p');
  desc.className = 'shop-card__desc';
  desc.textContent = t(`composters.${composter.id}.desc`);

  const stats = document.createElement('p');
  stats.className = 'shop-card__stats';
  stats.textContent =
    `${t('shop.capacityLabel')}: ${composter.capacity} ${t('common.liters')} · ` +
    `${t('shop.priceLabel')}: ${Math.round(cost)} ${t('common.coins')}`;

  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'shop-card__buy';
  buy.textContent = t('shop.buy');
  buy.disabled = !affordable;
  if (affordable) {
    buy.addEventListener('click', () => onBuy(composter.id));
  }

  card.append(name, desc, stats);

  // In upgrade mode, show what the trade-in knocks off so the price the player
  // is charged is never a surprise.
  if (tradeIn > 0 && !isCurrent) {
    const credit = document.createElement('p');
    credit.className = 'shop-card__tradein';
    credit.textContent =
      `${t('shop.tradeInLabel')}: −${Math.round(tradeIn)} ${t('common.coins')} ` +
      `(${t('shop.listPriceLabel')} ${composter.price})`;
    card.appendChild(credit);
  }

  card.appendChild(buy);

  if (isCurrent) {
    const badge = document.createElement('p');
    badge.className = 'shop-card__reason';
    badge.textContent = t('shop.currentModel');
    card.appendChild(badge);
  } else if (!affordable) {
    const reason = document.createElement('p');
    reason.className = 'shop-card__reason';
    // Two different sentences for the two different reasons, plus the number
    // that makes either actionable. "Not enough coins" beside a wallet that
    // visibly covers the price is the bug this replaces.
    reason.textContent =
      `${blockedByReserve ? t('shop.needsWormReserve') : t('shop.cannotAfford')} · ` +
      `${t('shop.shortfallLabel')} ${Math.ceil(shortfall)} ${t('common.coins')}`;
    card.appendChild(reason);
  }
  return card;
}

/**
 * Render the shop. Two modes:
 *
 * - **first purchase** (no `currentComposterId`): full price, and a model is only
 *   startable if it leaves the worm reserve for the first colony.
 * - **mid-farm upgrade** (`currentComposterId` set): net cost after the 50%
 *   trade-in, the model in use flagged and unbuyable, no worm reserve — the
 *   colony migrates with the farm.
 *
 * @param {object} deps
 * @param {number} deps.wallet   the player's coins.
 * @param {(composterId: string) => void} deps.onBuy invoked with the chosen id.
 * @param {string|null} [deps.currentComposterId] the model in use, if mid-farm.
 */
export function initShop({ wallet, onBuy, currentComposterId = null }) {
  const walletEl = document.getElementById('shop-wallet');
  const listEl = document.getElementById('shop-list');
  const subtitleEl = document.getElementById('shop-subtitle');
  if (walletEl) walletEl.textContent = `${Math.round(wallet)} ${t('common.coins')}`;
  if (subtitleEl) {
    subtitleEl.textContent = currentComposterId ? t('shop.upgradeSubtitle') : t('shop.subtitle');
  }
  if (!listEl) return;

  const rows = currentComposterId
    ? upgradeOffers(currentComposterId, wallet).map((offer) => ({ ...offer, cost: offer.netCost }))
    : affordability(wallet).map((row) => ({ ...row, cost: row.composter.price }));

  listEl.replaceChildren();
  for (const row of rows) {
    listEl.appendChild(buildCard(row, onBuy));
  }
}
