// Spanish catalog — mirrors the exact nested shape of the reference locale
// (pt-BR.js); the parity test enforces identical key sets. `appTitle` is the
// proper noun "Minhocário" and stays identical in every locale. Pure data — no
// DOM, no browser globals; Node-importable.

/**
 * Spanish string catalog. Resolved through the i18n runtime (`t('home.play')`);
 * never imported directly by UI components.
 */
export const es = {
  appTitle: 'Minhocário',

  devNav: {
    label: 'Navegación (dev)',
    home: 'Inicio',
    shop: 'Tienda',
    setup: 'Preparación',
    game: 'Granja',
  },

  home: {
    title: 'Minhocário',
    subtitle: 'Cuida tu criadero de lombrices y convierte la basura en oro negro.',
    play: 'Jugar',
    continue: 'Continuar',
    rankingTitle: 'Ranking local (top 10)',
    rankingEmpty: 'Aún no hay granjas. ¡Empieza la tuya!',
    rankingHeaderNick: 'Apodo',
    rankingHeaderScore: 'Puntos',
    rankingHeaderDays: 'Días',
    nicknameLabel: 'Tu apodo',
    reroll: 'Cambiar apodo',
    languageLabel: 'Idioma',
  },

  shop: {
    title: 'Tienda de compostadoras',
    subtitle: 'Elige un modelo para empezar.',
    walletLabel: 'Saldo',
    capacityLabel: 'Capacidad',
    priceLabel: 'Precio',
    buy: 'Comprar',
    cannotAfford: 'Saldo insuficiente',
    upgradeSubtitle: 'Cambia de compostadora — la colonia, la fila y la edad te acompañan.',
    tradeInLabel: 'Cambio por tu modelo actual',
    listPriceLabel: 'precio de lista',
    currentModel: 'Modelo actual',
    back: 'Volver',
  },

  setup: {
    title: 'Preparación de la compostadora',
    subtitle: 'Elige las lombrices, arma el lecho y coloca el primer residuo.',
    speciesLabel: 'Especie de lombriz',
    beddingLabel: 'Mezcla del lecho',
    beddingSawdust: 'Aserrín',
    beddingPeels: 'Cáscaras/paja',
    beddingCardboard: 'Cartón mojado',
    firstWasteLabel: 'Primer residuo',
    amountLabel: 'Cantidad',
    placementLabel: 'Posición en la pared',
    confirm: 'Iniciar granja',
  },

  game: {
    // HUD
    hudScore: 'Puntos',
    hudMoney: 'Saldo',
    hudDay: 'Día',
    hudTime: 'Hora',
    hudStatus: 'Estado',
    statusOk: 'Todo bien',
    statusColonyDead: 'La colonia murió',
    statusTrayFull: 'Bandeja de humus llena',
    statusTankFull: 'Tanque de lixiviado lleno',
    // Actions panel
    actionsTitle: 'Acciones',
    addWaste: 'Agregar residuo',
    addSawdust: 'Agregar aserrín',
    addWorms: 'Comprar lombrices',
    drain: 'Drenar lixiviado',
    harvest: 'Cosechar humus',
    move: 'Mover compostadora',
    openShop: 'Tienda',
    xrayToggle: 'Vista de rayos X',
    // Action dialogs. The food chooser lists the catalog as-is: NO suitability
    // label, grouping, or ordering hint (§2.7 — discovery is the gameplay).
    chooseFood: '¿Qué residuo agregar?',
    choosePortion: '¿Qué porción?',
    chooseWormPack: '¿Qué paquete de lombrices?',
    // Action feedback
    wasteAdded: 'Residuo agregado',
    wasteRejected: 'No cupo en la compostadora',
    sawdustAdded: 'Aserrín agregado',
    wormsBought: 'Lombrices agregadas',
    cannotAffordWorms: 'Saldo insuficiente',
    noSpecies: 'No hay especie en la compostadora',
    harvested: 'Humus cosechado',
    nothingToHarvest: 'Todavía no hay humus para cosechar',
    drained: 'Lixiviado drenado',
    nothingToDrain: 'Todavía no hay lixiviado para drenar',
    // Internals (x-ray data) panel
    internalsTitle: 'Interior de la compostadora',
    popTitle: 'Población',
    popCocoons: 'Capullos',
    popJuveniles: 'Jóvenes',
    popAdults: 'Adultas',
    popTotal: 'Total / capacidad',
    envTitle: 'Ambiente',
    envMoisture: 'Humedad',
    envPh: 'pH',
    envToxicity: 'Toxicidad',
    envTemperature: 'Temperatura',
    tanksTitle: 'Humus y lixiviado',
    humusLabel: 'Humus',
    leachateLabel: 'Lixiviado',
    queueTitle: 'Residuos descomponiéndose',
    queueEmpty: 'Nada descomponiéndose',
    queueMore: 'más',
    // Statistics panel (score detail). Labels only — the population, tank and
    // unit strings are shared with the internals panel and `common` above, so
    // the two readouts never drift apart in wording.
    statsTitle: 'Estadísticas',
    statsScoreTitle: 'Puntuación y saldo',
    statsNextHarvest: 'Cosechar ahora vale',
    statsAgeMultiplier: 'Multiplicador de edad',
    statsDays: 'días',
    statsFarmDays: 'Días de esta granja',
    statsQueued: 'Residuos en cola',
    // Run lifecycle (T15): colony death, restart, upgrade feedback
    colonyDeadTitle: 'La colonia murió',
    colonyDeadBody: 'La producción se detuvo. Compra lombrices para repoblar la compostadora.',
    repopulate: 'Repoblar colonia',
    restart: 'Reiniciar',
    restartConfirm: '¿Reiniciar? La granja actual termina y entra en el ranking.',
    upgraded: 'Compostadora cambiada',
    upgradeRejected: 'Saldo insuficiente para el cambio',
    // Speed control
    speedPause: 'Pausar',
    speedLabel: 'Velocidad',
    speedPaused: 'Pausado',
  },

  // Generic / shared
  common: {
    confirm: 'Confirmar',
    cancel: 'Cancelar',
    close: 'Cerrar',
    liters: 'L',
    coins: 'monedas',
    points: 'puntos',
  },

  // Save-slot prompts (spec §2.11 — a corrupt or newer-than-us save is shown to
  // the player, never silently discarded). Wired into the home screen at T10.
  storage: {
    corruptTitle: 'Partida dañada',
    corruptBody:
      'No se pudo leer tu partida guardada. No se ha borrado. ¿Empezar una partida nueva de todos modos?',
    futureTitle: 'Partida de una versión más nueva',
    futureBody:
      'Esta partida fue creada por una versión más reciente del juego y no se puede abrir aquí. No se sobrescribirá nada.',
    startNew: 'Empezar nueva',
    keepSave: 'Mantener partida',
  },

  // Catalog display text, keyed by sim id (js/sim/composters.js). Descriptions
  // paraphrase each model's traits (regulation/insulation, capacity, speed).
  composters: {
    electric: {
      name: 'Compostadora eléctrica',
      desc: 'Electrodoméstico con calefacción que mantiene la temperatura casi ideal.',
    },
    tier2: {
      name: 'Compostadora de 2 bandejas',
      desc: 'Bandejas abiertas que siguen la temperatura ambiente; capacidad modesta.',
    },
    tier3: {
      name: 'Compostadora de 3 bandejas',
      desc: 'Bandejas abiertas con más capacidad que la de 2 bandejas.',
    },
    tier4: {
      name: 'Compostadora de 4 bandejas',
      desc: 'Bandejas abiertas más grandes; más masa da más inercia térmica.',
    },
    buried: {
      name: 'Compostadora enterrada',
      desc: 'Enterrada en el suelo, muy estable térmicamente; retiene humedad.',
    },
    eco: {
      name: 'Compostadora eco',
      desc: 'La más grande y rápida del catálogo.',
    },
  },

  // Species display text, keyed by sim id (js/sim/worms.js). Names are the
  // localized common names; descriptions paraphrase the §2.9 archetypes.
  worms: {
    californiana: {
      name: 'Roja Californiana',
      desc: 'Versátil, tolerante y barata — la opción para empezar.',
    },
    africana: {
      name: 'Gigante Africana',
      desc: 'Come más rápido y hace el mejor humus; amante del calor, muere en noches frías.',
    },
    azul: {
      name: 'Lombriz Azul',
      desc: 'Se reproduce más rápido pero necesita una franja estrecha de humedad.',
    },
  },

  // Food names ONLY, keyed by sim id (js/sim/foods.js). No description and no
  // suitability hint — the mixed list is unlabeled on purpose (§2.7).
  foods: {
    fruitPeels: { name: 'Cáscaras de fruta' },
    citrus: { name: 'Cítricos' },
    coffeeGrounds: { name: 'Posos de café' },
    meat: { name: 'Carne' },
    vegetableScraps: { name: 'Restos de verdura' },
    onionGarlic: { name: 'Cebolla y ajo' },
    eggshells: { name: 'Cáscaras de huevo' },
    dairy: { name: 'Lácteos' },
    wetCardboard: { name: 'Cartón mojado' },
    oilyFood: { name: 'Comida grasosa' },
    teaLeaves: { name: 'Hojas de té' },
    saltyLeftovers: { name: 'Sobras saladas' },
    pumpkinGuts: { name: 'Tripas de calabaza' },
    cookedPasta: { name: 'Pasta cocida' },
  },
};

export default es;
