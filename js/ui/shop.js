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
import { listComposters } from '../sim/composters.js';
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
 * @param {number} wallet
 * @param {readonly import('../sim/composters.js').Composter[]} [composters]
 * @param {number} [reserve]
 * @returns {{composter: import('../sim/composters.js').Composter, affordable: boolean}[]}
 */
export function affordability(wallet, composters = listComposters(), reserve = startingWormReserve()) {
  return composters.map((composter) => ({
    composter,
    affordable: wallet >= composter.price + reserve,
  }));
}

/**
 * Build one shop card for a composter.
 * @param {import('../sim/composters.js').Composter} composter
 * @param {boolean} affordable
 * @param {(id: string) => void} onBuy
 * @returns {HTMLElement}
 */
function buildCard(composter, affordable, onBuy) {
  const card = document.createElement('article');
  card.className = 'shop-card';
  if (!affordable) card.classList.add('shop-card--disabled');

  const name = document.createElement('h3');
  name.textContent = t(`composters.${composter.id}.name`);

  const desc = document.createElement('p');
  desc.className = 'shop-card__desc';
  desc.textContent = t(`composters.${composter.id}.desc`);

  const stats = document.createElement('p');
  stats.className = 'shop-card__stats';
  stats.textContent =
    `${t('shop.capacityLabel')}: ${composter.capacity} ${t('common.liters')} · ` +
    `${t('shop.priceLabel')}: ${composter.price} ${t('common.coins')}`;

  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'shop-card__buy';
  buy.textContent = t('shop.buy');
  buy.disabled = !affordable;
  if (affordable) {
    buy.addEventListener('click', () => onBuy(composter.id));
  }

  card.append(name, desc, stats, buy);

  if (!affordable) {
    const reason = document.createElement('p');
    reason.className = 'shop-card__reason';
    reason.textContent = t('shop.cannotAfford');
    card.appendChild(reason);
  }
  return card;
}

/**
 * Render the shop for a first purchase: wallet display + a card per model.
 * @param {object} deps
 * @param {number} deps.wallet   the player's coins.
 * @param {(composterId: string) => void} deps.onBuy invoked with the chosen id.
 */
export function initShop({ wallet, onBuy }) {
  const walletEl = document.getElementById('shop-wallet');
  const listEl = document.getElementById('shop-list');
  if (walletEl) walletEl.textContent = `${wallet} ${t('common.coins')}`;
  if (!listEl) return;

  listEl.replaceChildren();
  for (const { composter, affordable } of affordability(wallet)) {
    listEl.appendChild(buildCard(composter, affordable, onBuy));
  }
}
