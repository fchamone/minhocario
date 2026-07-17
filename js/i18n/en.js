// English catalog — mirrors the exact nested shape of the reference locale
// (pt-BR.js); the parity test enforces identical key sets. `appTitle` is the
// proper noun "Minhocário" and stays identical in every locale. Pure data — no
// DOM, no browser globals; Node-importable.

/**
 * English string catalog. Resolved through the i18n runtime (`t('home.play')`);
 * never imported directly by UI components.
 */
export const en = {
  appTitle: 'Minhocário',

  devNav: {
    label: 'Navigation (dev)',
    home: 'Home',
    shop: 'Shop',
    setup: 'Setup',
    game: 'Farm',
  },

  home: {
    title: 'Minhocário',
    subtitle: 'Tend your worm farm and turn trash into black gold.',
    play: 'Play',
    continue: 'Continue',
    rankingTitle: 'Local ranking (top 10)',
    rankingEmpty: 'No farms yet. Start yours!',
    rankingHeaderNick: 'Nickname',
    rankingHeaderScore: 'Points',
    rankingHeaderDays: 'Days',
    reroll: 'Change nickname',
  },

  shop: {
    title: 'Composter shop',
    subtitle: 'Pick a model to get started.',
    walletLabel: 'Balance',
    buy: 'Buy',
    cannotAfford: 'Not enough coins',
    back: 'Back',
  },

  setup: {
    title: 'Composter setup',
    subtitle: 'Choose the worms, build the bedding, and add the first waste.',
    speciesLabel: 'Worm species',
    beddingLabel: 'Bedding mix',
    firstWasteLabel: 'First waste',
    placementLabel: 'Wall position',
    confirm: 'Start farm',
  },

  game: {
    // HUD
    hudScore: 'Points',
    hudMoney: 'Balance',
    hudDay: 'Day',
    hudTime: 'Time',
    hudStatus: 'Status',
    statusOk: 'All good',
    // Actions panel
    actionsTitle: 'Actions',
    addWaste: 'Add waste',
    addSawdust: 'Add sawdust',
    addWorms: 'Buy worms',
    drain: 'Drain leachate',
    harvest: 'Harvest humus',
    move: 'Move composter',
    openShop: 'Shop',
    xrayToggle: 'X-ray view',
    // Speed control
    speedLabel: 'Speed',
    speedPaused: 'Paused',
  },

  // Generic / shared
  common: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    close: 'Close',
    liters: 'L',
    coins: 'coins',
  },
};

export default en;
