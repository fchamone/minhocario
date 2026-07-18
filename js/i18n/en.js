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
    nicknameLabel: 'Your nickname',
    reroll: 'Change nickname',
  },

  shop: {
    title: 'Composter shop',
    subtitle: 'Pick a model to get started.',
    walletLabel: 'Balance',
    capacityLabel: 'Capacity',
    priceLabel: 'Price',
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

  // Save-slot prompts (spec §2.11 — a corrupt or newer-than-us save is shown to
  // the player, never silently discarded). Wired into the home screen at T10.
  storage: {
    corruptTitle: 'Corrupted save',
    corruptBody:
      'Your saved game could not be read. It was not deleted. Start a new game anyway?',
    futureTitle: 'Save from a newer version',
    futureBody:
      'This save was created by a newer version of the game and cannot be opened here. Nothing will be overwritten.',
    startNew: 'Start new',
    keepSave: 'Keep save',
  },

  // Catalog display text, keyed by sim id (js/sim/composters.js). Descriptions
  // paraphrase each model's traits (regulation/insulation, capacity, speed).
  composters: {
    electric: {
      name: 'Electric composter',
      desc: 'Heated appliance that holds the temperature near ideal.',
    },
    tier2: {
      name: 'Two-tray composter',
      desc: 'Open trays that track ambient temperature; modest capacity.',
    },
    tier3: {
      name: 'Three-tray composter',
      desc: 'Open trays with more capacity than the two-tray.',
    },
    tier4: {
      name: 'Four-tray composter',
      desc: 'Larger open trays; more mass means more thermal inertia.',
    },
    buried: {
      name: 'Buried composter',
      desc: 'Sunk underground, very thermally stable; retains moisture.',
    },
    eco: {
      name: 'Eco composter',
      desc: 'The largest and fastest in the catalog.',
    },
  },

  // Species display text, keyed by sim id (js/sim/worms.js). Names are the
  // localized common names; descriptions paraphrase the §2.9 archetypes.
  worms: {
    californiana: {
      name: 'California Red Worm',
      desc: "Versatile, tolerant, and cheap — the beginner's choice.",
    },
    africana: {
      name: 'African Nightcrawler',
      desc: 'Eats fastest and makes the best humus; heat-loving, dies on cold nights.',
    },
    azul: {
      name: 'Blue Worm',
      desc: 'Reproduces fastest but needs a narrow moisture band.',
    },
  },

  // Food names ONLY, keyed by sim id (js/sim/foods.js). No description and no
  // suitability hint — the mixed list is unlabeled on purpose (§2.7).
  foods: {
    fruitPeels: { name: 'Fruit peels' },
    citrus: { name: 'Citrus' },
    coffeeGrounds: { name: 'Coffee grounds' },
    meat: { name: 'Meat' },
    vegetableScraps: { name: 'Vegetable scraps' },
    onionGarlic: { name: 'Onion and garlic' },
    eggshells: { name: 'Eggshells' },
    dairy: { name: 'Dairy' },
    wetCardboard: { name: 'Wet cardboard' },
    oilyFood: { name: 'Oily food' },
    teaLeaves: { name: 'Tea leaves' },
    saltyLeftovers: { name: 'Salty leftovers' },
    pumpkinGuts: { name: 'Pumpkin guts' },
    cookedPasta: { name: 'Cooked pasta' },
  },
};

export default en;
