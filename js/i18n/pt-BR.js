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

  // Catalog display text, keyed by sim id (js/sim/composters.js). Descriptions
  // paraphrase each model's traits (regulation/insulation, capacity, speed).
  composters: {
    electric: {
      name: 'Composteira elétrica',
      desc: 'Eletrodoméstico aquecido que mantém a temperatura perto do ideal.',
    },
    tier2: {
      name: 'Composteira de 2 caixas',
      desc: 'Bandejas abertas que acompanham a temperatura ambiente; capacidade modesta.',
    },
    tier3: {
      name: 'Composteira de 3 caixas',
      desc: 'Bandejas abertas com mais capacidade que o modelo de 2 caixas.',
    },
    tier4: {
      name: 'Composteira de 4 caixas',
      desc: 'Bandejas abertas maiores; mais massa dá mais inércia térmica.',
    },
    buried: {
      name: 'Composteira enterrada',
      desc: 'Enterrada no solo, muito estável termicamente; retém umidade.',
    },
    eco: {
      name: 'Composteira eco',
      desc: 'A maior e mais rápida do catálogo.',
    },
  },

  // Species display text, keyed by sim id (js/sim/worms.js). Names are the
  // localized common names; descriptions paraphrase the §2.9 archetypes.
  worms: {
    californiana: {
      name: 'Vermelha-da-Califórnia',
      desc: 'Espécie versátil e tolerante, barata — a escolha para começar.',
    },
    africana: {
      name: 'Gigante-Africana',
      desc: 'Come mais rápido e faz o melhor húmus; adora calor e morre nas noites frias.',
    },
    azul: {
      name: 'Minhoca-Azul',
      desc: 'Reproduz mais rápido, mas exige uma faixa estreita de umidade.',
    },
  },

  // Food names ONLY, keyed by sim id (js/sim/foods.js). No description and no
  // suitability hint — the mixed list is unlabeled on purpose (§2.7).
  foods: {
    fruitPeels: { name: 'Cascas de fruta' },
    citrus: { name: 'Frutas cítricas' },
    coffeeGrounds: { name: 'Borra de café' },
    meat: { name: 'Carne' },
    vegetableScraps: { name: 'Restos de vegetais' },
    onionGarlic: { name: 'Cebola e alho' },
    eggshells: { name: 'Cascas de ovo' },
    dairy: { name: 'Laticínios' },
    wetCardboard: { name: 'Papelão molhado' },
    oilyFood: { name: 'Comida gordurosa' },
    teaLeaves: { name: 'Folhas de chá' },
    saltyLeftovers: { name: 'Sobras salgadas' },
    pumpkinGuts: { name: 'Tripas de abóbora' },
    cookedPasta: { name: 'Macarrão cozido' },
  },
};

export default ptBR;
