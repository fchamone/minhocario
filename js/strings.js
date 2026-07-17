// ALL user-facing text lives here in pt-BR — single source of truth for a
// future i18n pass. Never hardcode UI strings in components (see CLAUDE.md).
// Code identifiers and comments stay in English.

/**
 * pt-BR string catalog, grouped by screen/area. Import as `strings` and read
 * nested keys (e.g. `strings.home.play`). Keep this the ONLY place literals live.
 */
export const strings = {
  appTitle: 'Minhocário',

  // Temporary developer navigation (removed before release; used to jump
  // between screens while individual screens are still being built).
  devNav: {
    label: 'Navegação (dev)',
    home: 'Início',
    shop: 'Loja',
    setup: 'Preparação',
    game: 'Fazenda',
  },

  home: {
    title: 'Minhocário',
    subtitle: 'Cuide da sua criação de minhocas e transforme lixo em ouro negro.',
    play: 'Jogar',
    continue: 'Continuar',
    rankingTitle: 'Ranking local (top 10)',
    rankingEmpty: 'Nenhuma fazenda ainda. Comece a sua!',
    rankingHeaderNick: 'Apelido',
    rankingHeaderScore: 'Pontos',
    rankingHeaderDays: 'Dias',
    reroll: 'Trocar apelido',
  },

  shop: {
    title: 'Loja de composteiras',
    subtitle: 'Escolha um modelo para começar.',
    walletLabel: 'Saldo',
    buy: 'Comprar',
    cannotAfford: 'Saldo insuficiente',
    back: 'Voltar',
  },

  setup: {
    title: 'Preparação da composteira',
    subtitle: 'Escolha as minhocas, monte o berço e coloque o primeiro resíduo.',
    speciesLabel: 'Espécie de minhoca',
    beddingLabel: 'Mistura do berço',
    firstWasteLabel: 'Primeiro resíduo',
    placementLabel: 'Posição na parede',
    confirm: 'Iniciar fazenda',
  },

  game: {
    // HUD
    hudScore: 'Pontos',
    hudMoney: 'Saldo',
    hudDay: 'Dia',
    hudTime: 'Hora',
    hudStatus: 'Situação',
    statusOk: 'Tudo bem',
    // Actions panel
    actionsTitle: 'Ações',
    addWaste: 'Adicionar resíduo',
    addSawdust: 'Adicionar serragem',
    addWorms: 'Comprar minhocas',
    drain: 'Drenar chorume',
    harvest: 'Colher húmus',
    move: 'Mover composteira',
    openShop: 'Loja',
    xrayToggle: 'Visão raio-x',
    // Speed control
    speedLabel: 'Velocidade',
    speedPaused: 'Pausado',
  },

  // Generic / shared
  common: {
    confirm: 'Confirmar',
    cancel: 'Cancelar',
    close: 'Fechar',
    liters: 'L',
    coins: 'moedas',
  },
};
