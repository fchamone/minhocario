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

  // Document-level text: the tab title and the <meta name="description">, both
  // written by applyStrings() so a language switch updates them too. Distinct
  // from `appTitle`, which is the WORDMARK — a proper noun that does not
  // translate and says nothing about what the game is. A search result needs
  // the second thing, so the title here is descriptive and per-locale.
  //
  // The description is what a search result and a link preview quote. Kept
  // under ~160 characters, the point at which Google starts truncating.
  // tests/seo.test.js holds these identical to the static copies in index.html.
  meta: {
    title: 'Minhocário — simulador de compostagem com minhocas',
    description:
      'Simulador de minhocário no navegador: compre uma composteira, crie minhocas e transforme restos de comida em húmus. De graça, sem instalar nada.',
  },

  // Author credit, linking back to the root domain this game is a subdomain of.
  credit: {
    by: 'por Fabiano Chamone',
  },

  // Desktop-only gate — the only text a phone or tablet ever sees. Says what the
  // game needs and what to do about it; it is a wall, so it must not read as an
  // error the player could have caused.
  //
  // `about` and `features` were added for SEO and are load-bearing for it:
  // Googlebot renders with a smartphone viewport, so this notice is the ONLY
  // content it can index (css/screens.css hides #app under the same query). A
  // wall was all it could ever have found. These two lines are also simply
  // better for the human holding the phone — they say what they would be
  // opening a computer FOR.
  desktopOnly: {
    title: 'Só no computador',
    body: 'O Minhocário é feito para tela grande e para arrastar a composteira com o mouse. Abra este endereço em um computador para jogar.',
    about: 'Um simulador de compostagem: você compra uma composteira, povoa com minhocas e cuida da colônia dia após dia. Alimentar, drenar o chorume e colher o húmus é o jogo inteiro.',
    features: 'Seis modelos de composteira, três espécies de minhoca, temperatura que muda conforme o sol atravessa a parede, e uma visão de raio-x que abre a caixa por dentro.',
  },

  // Developer navigation — jumps between screens without playing through the
  // flow. Gated behind `?dev=1`; players never see it (see main.js).
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
    nicknameLabel: 'Seu apelido',
    reroll: 'Trocar apelido',
    languageLabel: 'Idioma',
  },

  shop: {
    title: 'Loja de composteiras',
    subtitle: 'Escolha um modelo para começar.',
    walletLabel: 'Saldo',
    capacityLabel: 'Capacidade',
    priceLabel: 'Preço',
    buy: 'Comprar',
    cannotAfford: 'Saldo insuficiente',
    // Shown when the wallet DOES cover the bin but nothing would be left to
    // stock the first colony. Distinct from `cannotAfford` because at the
    // starting balance the electric bin costs exactly what the player holds.
    needsWormReserve: 'Dá para a composteira, mas não sobra para as minhocas',
    shortfallLabel: 'faltam',
    upgradeSubtitle: 'Troque de composteira — a colônia, a fila e a idade vão junto.',
    tradeInLabel: 'Troca do modelo atual',
    listPriceLabel: 'preço cheio',
    currentModel: 'Modelo atual',
    back: 'Voltar',
  },

  setup: {
    title: 'Preparação da composteira',
    subtitle: 'Escolha as minhocas, monte o berço e coloque o primeiro resíduo.',
    speciesLabel: 'Espécie de minhoca',
    beddingLabel: 'Mistura do berço',
    beddingSawdust: 'Serragem',
    beddingPeels: 'Cascas/palha',
    beddingCardboard: 'Papelão molhado',
    firstWasteLabel: 'Primeiro resíduo',
    amountLabel: 'Quantidade',
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
    statusColonyDead: 'Colônia morreu',
    statusTrayFull: 'Bandeja de húmus cheia',
    statusTankFull: 'Tanque de chorume cheio',
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
    // Action dialogs. The food chooser lists the catalog as-is: NO suitability
    // label, grouping, or ordering hint (§2.7 — discovery is the gameplay).
    chooseFood: 'Qual resíduo adicionar?',
    choosePortion: 'Qual porção?',
    chooseWormPack: 'Qual pacote de minhocas?',
    // Action feedback
    wasteAdded: 'Resíduo adicionado',
    wasteRejected: 'Não coube na composteira',
    sawdustAdded: 'Serragem adicionada',
    wormsBought: 'Minhocas adicionadas',
    cannotAffordWorms: 'Saldo insuficiente',
    noSpecies: 'Nenhuma espécie na composteira',
    harvested: 'Húmus colhido',
    nothingToHarvest: 'Ainda não há húmus para colher',
    drained: 'Chorume drenado',
    nothingToDrain: 'Ainda não há chorume para drenar',
    // Internals (x-ray data) panel
    internalsTitle: 'Interior da composteira',
    popTitle: 'População',
    popCocoons: 'Casulos',
    popJuveniles: 'Jovens',
    popAdults: 'Adultas',
    popTotal: 'Total / capacidade',
    envTitle: 'Ambiente',
    envMoisture: 'Umidade',
    envPh: 'pH',
    envToxicity: 'Toxicidade',
    envTemperature: 'Temperatura',
    tanksTitle: 'Húmus e chorume',
    humusLabel: 'Húmus',
    leachateLabel: 'Chorume',
    queueTitle: 'Resíduos em decomposição',
    queueEmpty: 'Nada em decomposição',
    queueMore: 'mais',
    // Statistics panel (score detail). Labels only — the population, tank and
    // unit strings are shared with the internals panel and `common` above, so
    // the two readouts never drift apart in wording.
    statsTitle: 'Estatísticas',
    statsScoreTitle: 'Pontuação e saldo',
    statsNextHarvest: 'Colher agora vale',
    statsAgeMultiplier: 'Multiplicador de idade',
    statsDays: 'dias',
    statsFarmDays: 'Dias desta fazenda',
    statsQueued: 'Resíduo na fila',
    // Run lifecycle (T15): colony death, restart, upgrade feedback
    colonyDeadTitle: 'A colônia morreu',
    colonyDeadBody: 'A produção parou. Compre minhocas para repovoar a composteira.',
    repopulate: 'Repovoar colônia',
    restart: 'Recomeçar',
    restartConfirm: 'Recomeçar? A fazenda atual será encerrada e entrará no ranking.',
    upgraded: 'Composteira trocada',
    upgradeRejected: 'Saldo insuficiente para a troca',
    // Speed control
    speedPause: 'Pausar',
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
    points: 'pontos',
  },

  // Save-slot prompts (spec §2.11 — a corrupt or newer-than-us save is shown to
  // the player, never silently discarded). Wired into the home screen at T10.
  storage: {
    corruptTitle: 'Save danificado',
    corruptBody:
      'Não foi possível ler seu jogo salvo. Ele não foi apagado. Deseja começar um jogo novo mesmo assim?',
    futureTitle: 'Save de uma versão mais nova',
    futureBody:
      'Este save foi criado por uma versão mais recente do jogo e não pode ser aberto aqui. Nada será sobrescrito.',
    startNew: 'Começar novo',
    keepSave: 'Manter save',
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

// Nickname word banks (spec §1 — "adjective + animal + number", rendered like
// the spec's example "MinhocaVeloz42": animal + adjective + a two-digit number).
// Deliberately pt-BR-flavored and LANGUAGE-INDEPENDENT — the nickname keeps the
// same flavor regardless of the selected UI locale (spec C-0002, I2). Kept OUT
// of the parity-checked `ptBR` catalog (whose leaves must all be strings): these
// are separate array exports. Adjectives are gender-invariant (end in -e/-l/-z)
// so they read naturally after any animal.
export const NICKNAME_ANIMALS = [
  'Minhoca',
  'Besouro',
  'Tatu',
  'Lesma',
  'Grilo',
  'Formiga',
  'Joaninha',
  'Caracol',
  'Sapo',
  'Coruja',
  'Coelho',
  'Galinha',
];

export const NICKNAME_ADJECTIVES = [
  'Veloz',
  'Feliz',
  'Voraz',
  'Ágil',
  'Forte',
  'Valente',
  'Gigante',
  'Radiante',
  'Elegante',
  'Vibrante',
  'Nobre',
  'Verde',
];
