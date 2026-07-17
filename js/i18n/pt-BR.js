// Reference (source) locale — Brazilian Portuguese. Every key is authored here
// first; en.js and es.js mirror this exact nested shape (enforced by the parity
// test). These are the literals relocated verbatim from the original
// js/strings.js. Pure data — no DOM, no browser globals; Node-importable.

/**
 * pt-BR string catalog, grouped by screen/area. Resolved through the i18n
 * runtime (`t('home.play')`); never imported directly by UI components.
 */
export const ptBR = {
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

export default ptBR;
