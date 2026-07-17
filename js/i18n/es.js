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
    rankingEmpty: '¡Aún no hay granjas. ¡Empieza la tuya!',
    rankingHeaderNick: 'Apodo',
    rankingHeaderScore: 'Puntos',
    rankingHeaderDays: 'Días',
    reroll: 'Cambiar apodo',
  },

  shop: {
    title: 'Tienda de compostadoras',
    subtitle: 'Elige un modelo para empezar.',
    walletLabel: 'Saldo',
    buy: 'Comprar',
    cannotAfford: 'Saldo insuficiente',
    back: 'Volver',
  },

  setup: {
    title: 'Preparación de la compostadora',
    subtitle: 'Elige las lombrices, arma el lecho y coloca el primer residuo.',
    speciesLabel: 'Especie de lombriz',
    beddingLabel: 'Mezcla del lecho',
    firstWasteLabel: 'Primer residuo',
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
    // Speed control
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
  },
};

export default es;
