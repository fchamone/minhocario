# Minhocário — Referência do Jogo (comportamento e constantes)

> **O que é isto.** Uma referência única que descreve o que a simulação
> publicada *realmente faz* hoje: o modelo de tick/relógio, os catálogos
> completos, a dinâmica do ambiente, o pipeline populacional, as regras de
> produção/transbordo, a fórmula de pontuação, a economia e o esquema de save.
> Cada número cita o módulo e a constante nomeada de onde foi transcrito, para
> que possa ser reverificado contra o código-fonte.
>
> **Versão descrita:** branch `master`, depois de **T25**. As constantes de
> balanceamento foram travadas em T21; este documento foi escrito em seguida
> (T21b) para casar com os números travados, e foi mantido atualizado ao longo
> de T24 (ritmo de alimentação) e T25 (ambiente normalizado por volume +
> throughput sublinear em caixas grandes).
>
> **Contraparte em inglês:** `docs/game-reference.md` é o mesmo documento em
> inglês. Os dois formam um **par casado** — mesma estrutura, mesmos números,
> idioma da prosa diferente. Atualize ambos juntos ou nenhum.
>
> **Nota de escopo.** Este documento descreve *mecânicas* apenas. A lista de
> resíduos para alimentação mistura deliberadamente itens cujo comportamento o
> jogador precisa descobrir jogando; esta referência lista os números brutos de
> efeito de cada alimento **na ordem do catálogo** e nunca classifica, rotula,
> agrupa ou julga qualquer alimento como adequado ou inadequado. Os números são
> a mecânica — extrair significado deles é a jogabilidade.

Toda a lógica de simulação vive em `js/sim/` (pura, testável no Node, sem
DOM/Three.js, sem `Math.random`). O relógio do navegador e o controle de
velocidade vivem em `js/ui/speed.js` e `js/main.js`. A persistência vive em
`js/storage.js`.

---

## 1. Modelo de tick e relógio

- **Um tick de simulação = uma hora de jogo.** `tick(state, rng)` em
  `js/sim/engine.js` avança o relógio em uma hora e retorna um **novo** estado
  (nunca muta a entrada). 24 ticks = 1 dia de jogo. A hora dá a volta `23 → 0` e
  incrementa `day`.
- **Índice absoluto de tick:** `absoluteTick(state) = (day − 1) × 24 + hour`
  (`js/sim/engine.js`). Dia 1 hora 0 = tick 0. As entradas de alimento são
  carimbadas com esse índice e a decomposição é medida contra ele.
- **Cadência em tempo real:** `MS_PER_TICK = 2500` (`js/ui/speed.js`) — um tick a
  cada 2,5 segundos reais em 1×. A duração efetiva do tick é
  `MS_PER_TICK / speed`, então a velocidade escala **apenas** o timer; o passo da
  simulação é idêntico em qualquer velocidade.
- **Multiplicadores de velocidade:** `SPEEDS = [0.25, 0.5, 1, 5, 20]`,
  `DEFAULT_SPEED = 1` (`js/ui/speed.js`). A pausa é um controle separado
  (`PAUSED`), não um membro de `SPEEDS`.

| Velocidade | ms/tick (`MS_PER_TICK/speed`) | Segundos reais por dia de jogo (24 ticks) |
|------:|------------------------------:|-------------------------------------:|
| 0.25× | 10 000 | 240 s (4 min) |
| 0.5×  | 5 000  | 120 s |
| 1×    | 2 500  | 60 s |
| 5×    | 500    | 12 s |
| 20×   | 125    | 3 s |

- **Sem progresso offline/recuperação.** O acumulador (`drainTicks` em
  `js/ui/speed.js`) converte tempo real acumulado em ticks inteiros; um acúmulo
  além de `MAX_TICKS_PER_FRAME = 100` (`js/main.js`) é **descartado**, e um único
  quadro é limitado a `MAX_FRAME_MS = 250`. O relógio congela no
  `visibilitychange` (aba oculta) e retoma na hora salva — fechar o navegador
  congela o minhocário exatamente como salvo.
- **Auto-pausa por morte da colônia.** `clockForColony` (`js/ui/speed.js`) baixa o
  relógio para `PAUSED` quando a colônia morre (uma colônia morta não produz
  nada) e restaura a velocidade anterior assim que ela é repovoada.

---

## 2. Catálogo de composteiras

Fonte: `js/sim/composters.js` (`COMPOSTERS`, ordem de exibição na loja:
eletrodoméstico → maior). O significado dos campos está documentado no cabeçalho
daquele módulo.

| id | capacity (L) | humusCap (L) | leachateCap (L) | speed | humusRate | leachateRate | tempResponse | regulation | price |
|----|-----:|-----:|-----:|----:|-----:|-----:|-----:|-----:|-----:|
| `electric` | 20  | 8  | 4  | 1.7 | 0.78 | 0.15 | 0.5  | 0.9  | 200 |
| `tier2`    | 30  | 12 | 6  | 0.8 | 0.5  | 0.18 | 0.6  | 0    | 100 |
| `tier3`    | 45  | 18 | 9  | 1.0 | 0.52 | 0.2  | 0.45 | 0    | 180 |
| `tier4`    | 60  | 24 | 12 | 1.2 | 0.55 | 0.22 | 0.35 | 0    | 280 |
| `buried`   | 80  | 32 | 16 | 1.0 | 0.58 | 0.15 | 0.12 | 0    | 300 |
| `eco`      | 100 | 40 | 20 | 1.4 | 0.6  | 0.22 | 0.3  | 0.05 | 450 |

- **capacity** limita a fila de alimentos (§7). **humusCapacity /
  leachateCapacity** movem as duas cadeias de transbordo (§8).
- **speed** multiplica o throughput de consumo; **humusRate / leachateRate** são
  as frações do alimento consumido convertidas em húmus / chorume.
- **capacity também define dois fatores relativos à capacidade** (T25), ambos
  ancorados em `BIN_REFERENCE_CAPACITY = 30` — a caixa `tier2` — de modo que
  ambos valem exatamente **1.0** ali e só os outros modelos se movem:

  | id | capacity | diluição do ambiente (§6) | queda de throughput (§8) |
  |----|-----:|-----:|-----:|
  | `electric` | 20  | 1.000 (limitado) | 1.063 |
  | `tier2`    | 30  | 1.000 | 1.000 |
  | `tier3`    | 45  | 0.667 | 0.941 |
  | `tier4`    | 60  | 0.500 | 0.901 |
  | `buried`   | 80  | 0.375 | 0.863 |
  | `eco`      | 100 | 0.300 | 0.835 |
- **tempResponse** (0..1) é a fração da diferença de temperatura fechada por tick
  — alto = acompanha o ambiente de perto, baixo = termicamente estável.
  **regulation** (0..1) é a atração ativa do alvo de mistura em direção a
  `IDEAL_TEMP`; só `electric` (0.9) e `eco` (0.05) regulam, todos os outros são
  passivos (0). Veja §6.
- Nomes/descrições de exibição **não** estão na simulação; vivem por locale sob
  `catalog.composters[id]` em `js/i18n/{pt-BR,en,es}.js`.

---

## 3. Catálogo de espécies de minhoca

Fonte: `js/sim/worms.js` (`SPECIES`, ordem de exibição no setup). As faixas de
conforto são por espécie; as faixas de pH e toxicidade (§6) são compartilhadas
por todas as espécies.

| id | latin | reproduction (casulos/adulto/tick) | speed | conforto de temperatura (°C) | conforto de umidade | price (pacote de 50) |
|----|-------|-----:|----:|:-----:|:-----:|-----:|
| `californiana` | *Eisenia fetida*     | 0.02  | 1.0 | 10 – 30 | 0.40 – 0.85 | 40 |
| `africana`     | *Eudrilus eugeniae*  | 0.022 | 1.4 | 20 – 34 | 0.45 – 0.80 | 70 |
| `azul`         | *Perionyx excavatus* | 0.035 | 1.1 | 15 – 32 | 0.55 – 0.72 | 55 |

- `reproduction` é a base de casulos postos por adulto por tick sob condições
  ideais (reduzida por `reproductionFactor`, §7). `speed` multiplica tanto o
  throughput de consumo quanto a demanda por alimento.
- `latin` é um campo de dados neutro em relação ao idioma (a única string
  adjacente à exibição permitida em `js/sim/`); `name`/`desc` localizados vivem
  sob `catalog.worms[id]` nos catálogos de i18n.
- Relações estruturais que os testes travam: `africana` come mais rápido (speed
  1.4) e é a mais sensível ao frio (piso de conforto 20 °C); `azul` se reproduz
  mais rápido (0.035) com a faixa de umidade mais estreita (0.55–0.72).

---

## 4. Catálogo de alimentos

Fonte: `js/sim/foods.js` (`FOODS`). **A ordem abaixo é a ordem do catálogo** —
é uma mistura intencionalmente irregular (não agrupada bom-depois-ruim, e
deliberadamente não uma alternância estrita adequado/nocivo, de modo que o índice
de um alimento nunca prevê sua adequação) e não carrega significado. Os campos de
cada entrada são os números brutos de efeito por litro liberados
**gradualmente** conforme a entrada se decompõe; `heat` é um multiplicador de
calor de fermentação aplicado enquanto a entrada ainda está fresca. Nenhum campo
de adequação existe no formato dos dados.

`toxicity /L` tem **sinal**: entradas positivas adicionam toxicidade conforme se
decompõem, e entradas negativas a removem (veja §6.4 — o motor limita a
toxicidade da caixa em 0, então uma entrada negativa é simplesmente inerte numa
caixa limpa).

| id (ordem do catálogo) | moisture /L | ph /L (− ácido, + alcalino) | toxicity /L | heat (fresco) |
|--------------------|-----:|-----:|-----:|-----:|
| `fruitPeels`      | 0.05 | −0.02 | 0.00 | 1.0 |
| `onionGarlic`     | 0.04 | −0.05 | 0.03 | 1.0 |
| `coffeeGrounds`   | 0.03 | −0.03 | −0.03 | 1.1 |
| `vegetableScraps` | 0.06 |  0.00 | 0.00 | 1.0 |
| `meat`            | 0.03 |  0.00 | 0.15 | 1.8 |
| `eggshells`       | 0.00 |  0.04 | −0.05 | 0.9 |
| `cookedPasta`     | 0.05 |  0.00 | 0.06 | 1.4 |
| `citrus`          | 0.05 | −0.15 | 0.01 | 1.0 |
| `wetCardboard`    | 0.07 |  0.00 | 0.00 | 0.8 |
| `dairy`           | 0.04 | −0.02 | 0.12 | 1.6 |
| `teaLeaves`       | 0.04 | −0.01 | 0.00 | 1.0 |
| `pumpkinGuts`     | 0.08 |  0.00 | 0.00 | 1.1 |
| `oilyFood`        | 0.02 |  0.00 | 0.13 | 1.7 |
| `saltyLeftovers`  | 0.03 |  0.00 | 0.10 | 1.2 |

- **Decomposição:** `DECOMP_TICKS = 48` (`js/sim/foods.js`) — uma entrada se
  decompõe totalmente ao longo de 48 ticks (2 dias de jogo).
  `decompositionFraction(ageTicks)` é uma rampa linear `ageTicks / DECOMP_TICKS`,
  limitada a `[0, 1]`.
- **Liberação gradual:** `queueDynamics(queue, prevTick, newTick)` libera cada
  efeito em proporção à fração de decomposição ganha neste tick
  (`(newFrac − prevFrac) × liters × field`). `freshHeatMass` é a massa ainda
  fresca, ponderada por calor, que move o calor de fermentação (§6).
- **Formato da entrada da fila:** `{ foodId, liters, addedAtTick }`; porção
  mínima `MIN_PORTION_LITERS = 0.25 L` (`js/sim/engine.js`). `addFood` rejeita
  alimentos desconhecidos e porções abaixo do mínimo, e limita uma adição acima
  da capacidade ao espaço restante (ou a rejeita quando resta menos que uma
  porção mínima).
- O `name` localizado (apenas) vive sob `catalog.foods[id]` nos catálogos de
  i18n — **nenhum** sinal de categoria/ordenação/adequação em qualquer locale.

---

## 5. Mistura de substrato → ambiente inicial

Fonte: `js/sim/engine.js` (`BEDDING_COMPONENTS`, `RECOMMENDED_BEDDING`,
`beddingEnv`). A mistura guiada do setup semeia a umidade e o pH iniciais da
caixa como uma mescla ponderada por volume de três componentes:

| componente | moisture | pH | padrão recomendado (L) |
|-----------|-----:|----:|-----:|
| `sawdust`   | 0.15 | 6.2 | 1.5 |
| `peels`     | 0.85 | 5.0 | 1.0 |
| `cardboard` | 0.80 | 7.2 | 2.5 |

`beddingEnv(mix)` retorna `{ moisture, ph }` = a média ponderada por litros dos
componentes (mistura vazia → neutro `{ moisture: 0.5, ph: 7 }`). A mistura
recomendada é ajustada para que a mescla caia dentro da faixa de conforto de
todas as espécies. A toxicidade inicial é 0 e a temperatura inicial 20 °C
(ambiente base de `createInitialFarmState`).

---

## 6. Dinâmica do ambiente e faixas de conforto

Cada tick atualiza quatro variáveis de toda a caixa (`env: { moisture, ph,
toxicity, temperature }`). Toda a matemática de atualização está em `tick()`
(`js/sim/engine.js`), a menos que um auxiliar de temperatura seja citado de
`js/sim/temperature.js`.

### 6.1 Temperatura

O alvo de mistura para a nova hora é:

```
target = ambientTemperature(hour) + solarGain(wallPosition, hour)
         + positionBias(wallPosition, hotSide) + fermentationHeat(freshHeatMass)
newTemp = blendTemperature(prevTemp, target, composter)
```

- **Ciclo ambiente** (`ambientTemperature`, `js/sim/temperature.js`): senoide,
  `AMBIENT_MEAN = 20`, `AMBIENT_AMPLITUDE = 8`, `AMBIENT_PEAK_HOUR = 15`. Mínima
  noturna ≈ 12 °C (antes do amanhecer), máxima diurna ≈ 28 °C (meio da tarde);
  periódico ao longo de 24 h.
- **Ganho solar** (`solarGain`, `js/sim/temperature.js`): **0 à noite** (hora ≤
  `SUNRISE_HOUR = 6` ou ≥ `SUNSET_HOUR = 18`). Durante o dia uma mancha
  luminosa varre a parede da posição 0 no nascer do sol até 1 no pôr do sol; a
  intensidade tem pico no meio-dia solar. `SOLAR_MAX = 12` °C de pico,
  `PATCH_WIDTH = 0.35` (semilargura em unidades de parede). Uma composteira no
  centro da mancha ao meio-dia recebe a contribuição total; as pontas
  sombreadas recebem 0. Esta é a **única fonte de verdade** que a camada de
  renderização amostra para a mancha de sol, então simulação e visuais não podem
  divergir.
- **Gradiente da parede** (`positionBias`, `js/sim/temperature.js`): um gradiente
  fixo ponta-quente / ponta-fria ao longo da parede, `POSITION_BIAS_MAX = 3` °C
  na ponta quente, −3 °C na ponta fria, 0 no meio da parede — uma **amplitude de
  6 °C de ponta a ponta aplicada a toda hora, inclusive à noite**. É isso que faz
  do posicionamento uma decisão real: o sol move a *média* diária em apenas
  ≈1,6 °C (fica desligado por doze horas e passa depressa por qualquer ponto),
  então antes deste termo as duas pontas da parede eram termicamente idênticas
  por construção e o eixo era só centro-versus-pontas.
  - Qual ponta é quente está em `farm.hotSide` (1 = posição 1, 0 = posição 0),
    sorteado **uma vez por minhocário** a partir de sua semente por
    `hotSideFromSeed` (`js/sim/engine.js`) e fixo para a partida — então a
    garagem de cada partida precisa ser aprendida. Leia através de `hotSideOf`,
    que resolve saves anteriores ao gradiente a partir do imutável `createdAt`.
  - **Deliberadamente não desenhado** em lugar nenhum: sem tinta na parede, sem
    rótulo, sem leitura. O jogador descobre pelo termômetro movendo a caixa, do
    mesmo jeito que a lista de alimentos é descoberta (§2.7). É por isso que é um
    termo separado de `solarGain` em vez de embutido nele — `solarGain` é o que a
    camada de renderização amostra para a mancha de sol visível, e precisa
    permanecer simétrico e zero à noite.
  - `POSITION_BIAS_MAX` está firmemente delimitado e não deveria ser elevado sem
    remedir ambas as guardas: uma caixa `tier2` sem alimentação no pior ponto
    (posição ≈0,66, onde sol e gradiente se somam) tem pico de **37.0 °C** contra
    a linha letal de 38 °C da californiana, e o vale noturno da ponta quente
    (≈15 °C) precisa ficar abaixo do piso de 20 °C da Gigante-Africana ou
    substituiria silenciosamente a regulação da composteira elétrica. Ambos estão
    travados por testes.
- **Calor de fermentação** (`fermentationHeat`, `js/sim/temperature.js`):
  `FERMENT_COEF = 0.35` °C por litro de massa de alimento fresco (ponderada por
  calor) — monotônico na massa, 0 quando vazio. Este é o motor da cadeia de
  superalimentação (§8).
- **Mistura** (`blendTemperature`, `js/sim/temperature.js`): modelos regulados
  primeiro enviesam o alvo em direção a `IDEAL_TEMP = 22` —
  `effectiveTarget = target + regulation × (IDEAL_TEMP − target)` — depois fecham
  `tempResponse` da diferença restante:
  `new = current + tempResponse × (effectiveTarget − current)`. Sem composteira
  os padrões são `response = 0.5`, `regulation = 0`.

**A faixa de conforto de temperatura é por espécie** (§3): `californiana` 10–30,
`africana` 20–34, `azul` 15–32 °C.

### 6.2 Umidade (0..1)

```
moisture = clamp01(prev + (released + eatenMoisture + spillMoisture) × dilution
                        − evaporation)
           then percolation drains excess into the leachate tank
```

- **dilution** (`envDilution`, `js/sim/engine.js`, T25) —
  `min(1, BIN_REFERENCE_CAPACITY / capacity)`, ou seja, **1.0 na âncora de 30 L
  ou abaixo dela e menor para caixas maiores** (tabela em §2). `moisture`, `ph` e
  `toxicity` são *concentrações* no substrato, mas a fila de alimentos contribui
  com *quantidades* (litros × força por litro); dividir pelo volume da caixa é a
  conversão de unidade que faltava. Sem isso uma caixa maior não diluía uma
  alimentação, então o mesmo clique de porção na UI significava coisas muito
  diferentes por modelo — medido numa colônia em meia-vida, um clique do degrau
  mais alto movia a umidade **+0.284 em `tier2` mas +0.425 em `eco`** (chegando a
  0.925, além do máximo de conforto 0.85 da californiana). Com ela, o mesmo
  clique é **+0.284 … +0.302 em todo o catálogo**.
  Está **limitado em 1** para que só dilua caixas grandes e nunca concentre as
  pequenas: o valor não limitado de 1.5 na `electric` saturava aquela caixa em
  umidade 1.0 e lhe custava a invariante de preço da §10.
- **Released** vem do alimento em decomposição (`queueDynamics`, §4).
- **eatenMoisture:** a água do alimento *consumido* ainda entra no substrato —
  apenas a parcela ainda não liberada via decomposição é creditada
  (`food.moisture × eatenHere × (1 − decompFraction)`), então cada litro libera
  sua água exatamente uma vez, quer apodreça no lugar, quer seja comido.
- **Evaporação** é regida pela temperatura: `EVAP_COEF = 0.0006` por °C acima de
  `EVAP_THRESHOLD = 24` °C, usando a temperatura anterior ao tick. Uma caixa fria
  mal seca; uma caixa quente/assada pelo sol seca até território letal. O
  posicionamento portanto alcança a umidade tanto quanto a temperatura: uma caixa
  estacionada na ponta quente da parede (§6.1) fica mais perto do limiar de
  evaporação o tempo todo.
- **Serragem** (`addSawdust`): remove `SAWDUST_DRY_PER_LITER = 0.04` de umidade
  por litro adicionado, **× o mesmo fator de diluição** — uma dose são litros
  contra uma força por litro, exatamente como o alimento, então carrega a unidade
  idêntica. (Uma ação direta, não uma entrada de fila: aplica-se imediatamente e
  por completo, sem rampa de decomposição.) A UI já escala o clique com a
  capacidade (0.5 L em `tier2`, 1.75 L em `eco`), então diluir mantém um clique
  valendo aproximadamente o mesmo em todo lugar — medido **−0.019 … −0.021** de
  `tier2` a `eco`. Sem diluição teria secado uma caixa grande em cerca de um
  terço dos cliques que a âncora precisa, e descontado a limpeza de toxicidade
  pelo mesmo fator. A mesma ação também remove toxicidade (§6.4).
- **spillMoisture** vem da cadeia de transbordo de chorume (§8).
- **Percolação** (o caminho de SAÍDA da água numa caixa fria): quando
  `moisture > FIELD_CAPACITY = 0.75` **e** o tanque de chorume tem espaço,
  `PERCOLATION_RATE = 0.3` do excesso escorre, convertido a
  `MOISTURE_TO_LEACHATE_LITERS = 8` L de chorume por 1.0 unidade de umidade,
  limitado pelo espaço restante no tanque. Quando o tanque está cheio, a
  percolação represa e o substrato satura — é isso que torna terminal a cadeia de
  nunca-drenar.

**A faixa de conforto de umidade é por espécie** (§3): `californiana` 0.40–0.85,
`africana` 0.45–0.80, `azul` 0.55–0.72.

### 6.3 pH (0..14)

```
ph = clamp(prev + (NEUTRAL_PH − prev) × PH_DRIFT_RATE + phPush × dilution, 0, 14)
```

`NEUTRAL_PH = 7`, `PH_DRIFT_RATE = 0.02` (`js/sim/engine.js`): a caixa volta 2%
do caminho de volta ao neutro a cada tick, depois recebe o empurrão com sinal do
alimento (`phPush` de `queueDynamics`), normalizado por volume pela mesma
`dilution` da umidade (§6.2). **Faixa de conforto de pH = `PH_COMFORT` 6–8**
(`js/sim/worms.js`), compartilhada por todas as espécies.

### 6.4 Toxicidade (0..1)

```
per tick:    toxicity = clamp01(prev × (1 − TOX_DECAY_RATE)
                                + (released + rotToxicity) × dilution)
addSawdust:  toxicity = clamp01(prev − SAWDUST_TOX_PER_LITER × liters × dilution)
```

Os dois lados carregam a mesma `dilution` da umidade (§6.2), então a **razão**
entre uma carga tóxica e seu remédio é independente da caixa mesmo que as
magnitudes não sejam — o que é o que mantém a remediação uma alavanca utilizável
depois de um upgrade (travado por `tests/foods.test.js`).

`TOX_DECAY_RATE = 0.001` (`js/sim/engine.js`) — decaimento deliberadamente muito
lento, de modo que a toxicidade é a punição de longo prazo. Deixada a decair
sozinha, uma toxicidade letal de 0.4 leva ~470 ticks (19,6 dias) para chegar a
0.25 e ~1386 ticks (57,8 dias) para reentrar na faixa de conforto. `rotToxicity`
vem da cadeia de transbordo de húmus (§8). **A toxicidade é confortável abaixo de
`TOX_THRESHOLD = 0.1`** (`js/sim/worms.js`).

`released` é a carga de toxicidade do alimento (§4) e tem **sinal** — as entradas
de `toxicity` negativa subtraem aqui, o que é o que faz delas remediadoras. Junto
com o `SAWDUST_TOX_PER_LITER = 0.01` por litro do `addSawdust`, esses são os
únicos dois caminhos que removem toxicidade mais rápido que `TOX_DECAY_RATE`, e
levam uma recuperação de 0.4 → 0.1 sob manejo ativo para poucos dias de jogo.

Ambos os caminhos passam por `clamp01`, então a toxicidade nunca pode ficar
abaixo de 0: uma remediadora dada a uma caixa limpa não faz nada, e nenhuma
quantidade de serragem acumula margem negativa contra uma má alimentação futura.

### 6.5 Calibração de conforto / estresse (resumo)

Fonte: `js/sim/worms.js`. O **estresse** normalizado de uma variável é sua
distância fora da faixa de conforto dividida pelo *vão de estagnação* daquela
variável. Estresse `1` = postura totalmente estagnada; estresse
`LETHAL_RATIO = 2` = início da mortalidade.

| variável | faixa de conforto | vão de estagnação | início letal (2× o vão fora da faixa) |
|----------|--------------|-----------:|--------------------------------------|
| temperatura | por espécie | `TEMP_STALL = 4` °C | 8 °C fora da faixa |
| umidade     | por espécie | `MOISTURE_STALL = 0.06` | 0.12 fora da faixa |
| pH          | 6 – 8       | `PH_STALL = 1` | pH < 4 ou > 10 |
| toxicidade  | ≤ 0.1       | `TOX_STALL = 0.15` | toxicidade ≥ 0.4 |
| superpopulação | ≤ capacidade de suporte | `OVERPOP_STALL = 0.5` | `active ≥ 2 × capacidade de suporte` |
| fome        | — | limitada em 1 | **nunca letal** (veja §7) |

---

## 7. Pipeline populacional e mortalidade

Fonte: `js/sim/worms.js` (`populationStep`, `reproductionFactor`,
`mortalityRate`). Modelo de coortes em três estágios: **casulos → juvenis →
adultos**. Todos os fluxos fracionários são arredondados estocasticamente através
do RNG semeado, de modo que as contagens permanecem inteiras e determinísticas
por semente.

Fluxos por tick (calculados a partir do retrato anterior ao tick, independentes
de ordem):

| fluxo | fórmula |
|------|---------|
| postos (novos casulos) | `adults × species.reproduction × reproductionFactor` |
| eclodidos (casulos → juvenis) | `cocoons / HATCH_TICKS`, `HATCH_TICKS = 48` (~2 dias) |
| amadurecidos (juvenis → adultos)  | `juveniles / MATURE_TICKS`, `MATURE_TICKS = 72` (~3 dias) |
| mortes por estágio | `stageCount × mortalityRate` |

Atraso de recuperação com pipeline vazio = `HATCH_TICKS + MATURE_TICKS` = 120
ticks (~5 dias): depois que as condições são corrigidas, os adultos só voltam
quando os casulos eclodem e os juvenis amadurecem, então o descuido continua
doendo depois da recuperação.

- **`reproductionFactor` ∈ [0,1]** = `min` sobre todos os seis estresses de
  `clamp01(1 − stress)` — a postura cai a 0 conforme a **pior variável isolada**
  atinge sua distância de estagnação.
- **`mortalityRate` ∈ [0,1]** = `Σ max(0, stress − LETHAL_RATIO) × MORT_SLOPE`,
  limitado, com `LETHAL_RATIO = 2`, `MORT_SLOPE = 0.08`. A mortalidade é 0 até
  que uma variável passe sua distância letal, então **a postura sempre estagna
  antes de morrer**.
- **Capacidade de suporte** = `composter.capacity × DENSITY`, `DENSITY = 50`
  minhocas/L (`carryingCapacity`, `js/sim/worms.js`). Estresse de superpopulação
  = `max(0, active/cap − 1) / OVERPOP_STALL`, `OVERPOP_STALL = 0.5`
  (`js/sim/worms.js`) — então o **aperto sozinho** estagna a postura em
  `active/cap = 1.5` e vira letal em `2.0` (tabela de mortalidade §7). Uma
  colônia bem cuidada deve se assentar *abaixo* dessa parede, freada por
  **alimento** em vez de aperto: a temporada de bom cuidado travada termina em
  `active/cap = 1.31` (`tests/balance.test.js`). O teto de throughput (§8) move
  essa razão — baixá-lo empurra o equilíbrio **para cima**, na direção da parede
  de aperto, o que é o que limita quanto o teto pode ser reduzido.
- **Nutrição (`ration`)** = `clamp01(standing / (demand × RATION_TICKS))`,
  `RATION_TICKS = 24` (`js/sim/worms.js`), onde `standing` é o volume de alimento
  enfileirado e `demand` é um tick de
  `eatingThroughput(active, species, composter)` (`js/sim/engine.js`) — a
  **mesma expressão limitada** com que `tick` de fato come depois (§8). O
  compartilhamento é estrutural, não asseio: uma demanda *não limitada* medida
  contra um consumo *limitado* faria uma colônia estrangulada ler como
  permanentemente subalimentada por mais cheia que a caixa estivesse, segurando o
  freio de postura para sempre num equilíbrio silenciosamente diferente. Estresse
  de fome = `clamp01(1 − ration)` — **limitado na distância de estagnação (1)**,
  então a fome freia a reprodução mas **nunca é letal**: uma colônia faminta para
  de crescer e envelhece até o fim, não é abatida.

### Gatilhos de mortalidade (cada um mata independentemente)

Cada um destes, por si só, pode levar `mortalityRate > 0` depois de passar seu
início letal (tabela §6.5):

1. **Superaquecimento / frio** — temperatura ≥ 8 °C fora da faixa da espécie.
2. **Secura / encharcamento** — umidade ≥ 0.12 fora da faixa da espécie.
3. **pH extremo** — pH abaixo de 4 ou acima de 10.
4. **Toxicidade** — toxicidade ≥ 0.4.
5. **Superpopulação** — minhocas ativas ≥ 2× a capacidade de suporte.

A fome é intencionalmente excluída (limitada abaixo do letal).

### Ciclo de vida da colônia

Fonte: `js/sim/engine.js` (`tick`) e as funções de economia de
`js/sim/engine.js`.

- `colonyAgeDays` incrementa uma vez por virada de dia de jogo **enquanto a
  colônia vive**; uma colônia morta congela na idade que alcançou.
- **A morte é uma transição:** uma colônia que *tinha* minhocas (total anterior
  ao tick > 0) e agora não tem nenhuma vira `colonyAlive → false`. Um minhocário
  vazio pré-setup (que nunca teve minhocas) nunca faz essa transição. Uma colônia
  morta não produz nada.
- **Repovoar** (`buyWormPack` / `repopulateColony`): comprar um pacote de
  minhocas para uma colônia morta define `colonyAlive → true` e zera
  `colonyAgeDays → 0`, enquanto os totais de pontuação / húmus / chorume são
  mantidos. Comprar para uma colônia **viva** **não** zera a idade.

---

## 8. Produção, consumo e cadeias de transbordo

Fonte: `js/sim/engine.js` (`tick`). O consumo usa a população anterior ao tick e
é totalmente determinístico (sem RNG).

- **Throughput de consumo por tick** (`eatingThroughput`, `js/sim/engine.js` — o
  mesmo auxiliar que a demanda de fome da `ration` chama, §7): `toEat =
  min(linear, ceiling)`, onde
  `linear = active × species.speed × composter.speed × CONSUMPTION_PER_WORM`,
  `CONSUMPTION_PER_WORM = 0.0005` L/minhoca/tick.
- **Teto de throughput** (`binThroughputCeiling`, exportado de
  `js/sim/engine.js` — pergunte a ele em vez de rederivar a fórmula; um espelho
  copiado à mão de `THROUGHPUT_CAP_PER_LITER` em `tests/actions.test.js` ficou
  desatualizado e inverteu silenciosamente a invariante que guardava):
  `ceiling = capacity × falloff × composter.speed × species.speed ×
  THROUGHPUT_CAP_PER_LITER`, com `THROUGHPUT_CAP_PER_LITER = 0.014` L/tick por
  litro de capacidade da caixa e
  `falloff = (BIN_REFERENCE_CAPACITY / capacity) ** CAPACITY_THROUGHPUT_FALLOFF`,
  `CAPACITY_THROUGHPUT_FALLOFF = 0.15` (`js/sim/engine.js`, T25). As minhocas
  comem na **interface** alimento/substrato, e essa interface é uma propriedade
  da caixa, não de quantas minhocas estão empilhadas dentro dela — então o teto
  escala com a capacidade, enquanto **ambos** os traços de velocidade permanecem
  nele porque a espécie e o modelo ainda definem quão rápido cada minhoca naquela
  face trabalha. (Retirar `species.speed` do teto faz todas as espécies comerem
  de forma idêntica assim que o limite ativa, apagando o traço definidor da
  africana para qualquer colônia madura; `tests/production.test.js` trava a
  ordenação das espécies contra exatamente isso.) O limite engaja em
  `THROUGHPUT_CAP_PER_LITER / CONSUMPTION_PER_WORM = 28` minhocas/L contra
  `DENSITY = 50` — **56 % da capacidade de suporte** — então colônias pequenas e
  médias permanecem puramente lineares e alimentar ainda importa visivelmente.
  Medido e delimitado dos dois lados em T24; veja `tasks/t21-balance.md` antes de
  movê-lo.
- **Sublinear na capacidade** (`CAPACITY_THROUGHPUT_FALLOFF = 0.15`, T25): a face
  de trabalho cresce mais devagar que a caixa, então uma caixa com o dobro do
  volume não ganha o dobro da interface utilizável. Antes disso, modelos maiores
  eram melhores em todos os eixos de uma vez — `speed` maior, `humusRate` maior e
  uma capacidade de suporte linear no volume — e uma `eco` madura produzia ~2,1×
  mais que a `tier2` *por litro de capacidade*, além de ser 3,3× maior. A queda se
  aplica **somente ao teto**, nunca ao ramo linear, então só morde em colônias
  maduras (passado o ponto de engate de 56 %) e deixa intacto "mais minhocas
  processam mais alimento"; `carryingCapacity` também permanece linear na
  capacidade, já que isto é sobre taxa de produção e não tamanho da colônia.
  Efeito medido sobre o húmus em regime permanente por litro de capacidade:
  `eco` −16,5 %, `buried` −13,7 %, `tier4` −9,9 %, `tier3` −5,9 %,
  `electric` +6,3 %, `tier2` inalterada (é a âncora).
- **Mais velho primeiro:** a fila é comida pela frente; uma entrada totalmente
  consumida é removida, uma parcialmente comida mantém seu resto no lugar.
- **Saída:** `humus += eaten × composter.humusRate`;
  `leachate += eaten × composter.leachateRate`.
- **Condicionamento:** o processamento pelas minhocas só roda quando uma espécie
  está definida, `active > 0`, a bandeja de húmus **não** está cheia e
  `colonyAlive` é verdadeiro. A medição de `ration` acima **não** é condicionada
  à bandeja nem a `colonyAlive` — ela é tomada antes do consumo, a partir da
  população anterior ao tick.
- **Descarte por `DECOMP_TICKS`:** o alimento que atinge `DECOMP_TICKS = 48`
  ticks de idade (`js/sim/foods.js`) é incorporado ao substrato e sai da fila —
  mas **somente num tick em que o consumo rodou** (a mesma condição), e não rende
  **nenhum** húmus, já que húmus é só o que as minhocas fazem. Quando o
  processamento está parado a matéria encalha na fila e alimenta a cadeia de
  apodrecimento por bandeja cheia abaixo.
- **Desperdício pelo teto de throughput** (corrigido na revisão de T24; a
  alegação anterior aqui de "metade da capacidade … lentidão de 1.33× contra as
  ~2× que a janela de 48 ticks permite" era **sem apoio e está retirada** —
  aquela sonda era estruturalmente cega, veja `tasks/t21-balance.md`). Uma
  entrada só pode envelhecer até o descarte quando o orçamento de consumo de 48
  ticks não cobre o estoque parado:

  ```
  fill > DECOMP_TICKS × binThroughputCeiling(composter, species) / capacity
  ```

  Isto *costumava* reduzir a `48 × K × composter.speed × species.speed`, com a
  capacidade se cancelando inteiramente. Desde T25 o teto é sublinear na
  capacidade, então **a capacidade não se cancela mais** e caixas maiores cruzam
  para o apodrecimento não pago com um enchimento ligeiramente *menor* que antes.
  Remedido com californiana (população fixada na capacidade de suporte, caixa
  mantida num enchimento fixo, 30 dias) — a forma fechada prevê a fronteira do
  vazamento exatamente em todos os 18 casos de modelo × enchimento:

  | modelo | limiar | descartado @100 % | descartado @75 % | descartado @50 % |
  |---|---:|---:|---:|---:|
  | `electric` | >1 (nunca) | 0.0 % | 0.0 % | 0.0 % |
  | `tier2`    | 0.538 | 44.7 % | 27.1 % | 0.0 % |
  | `tier3`    | 0.632 | 35.3 % | 14.9 % | 0.0 % |
  | `tier4`    | 0.727 | 26.1 % |  2.9 % | 0.0 % |
  | `buried`   | 0.580 | 40.5 % | 21.6 % | 0.0 % |
  | `eco`      | 0.785 | 20.4 % |  0.0 % | 0.0 % |

  `tier2` é idêntica à medição de T24, como tem de ser — ela é a âncora, onde
  ambos os fatores de T25 valem exatamente 1. Abaixo de seu limiar uma caixa não
  desperdiça nada; acima dele a perda é grande. O jogo realista fica
  inafetado — a temporada de bom cuidado enche a caixa até cerca de um **quarto**,
  e a contabilidade de alimento com e sem limite é idêntica (195.0 alimentados /
  183.8 comidos / 11.3 descartados L) com húmus 91.6 vs 91.9 L. Este é o
  comportamento **pretendido**, não um defeito: entupir a caixa é a cadeia de
  superalimentação da §2.8, e os litros descartados ainda carregam umidade, pH e
  toxicidade por seus 48 ticks completos. A **lacuna aberta** é que o jogador não
  recebe nenhum retorno de que o resíduo alimentado expirou sem ser comido.
- **Ações do jogador** (todas puras, sem RNG): `addFood`, `addSawdust`,
  `drainLeachate` (instantâneo, esvazia o tanque por completo), `harvestHumus`
  (esvazia a bandeja a qualquer momento — reabilita o processamento depois de uma
  parada por bandeja cheia).

### As quatro cadeias de falha da §2.8

Gatilho e estado terminal de cada cadeia (todas terminam em morte da colônia — a
produção para assim que `colonyAlive → false`):

| # | Cadeia | Gatilho → mecanismo | Estado terminal |
|---|-------|---------------------|----------------|
| 1 | **Transbordo de chorume** | Nunca drenar: a percolação enche o tanque (`leachateCapacity`); uma vez cheio, a percolação represa e o chorume além da capacidade re-satura o substrato — `spillMoisture = (leachate − leachateCapacity) × LEACHATE_SPILL_TO_MOISTURE (0.05)`, depois × `dilution` (§6.2); o tanque é limitado na capacidade. A umidade sobe ≥ 0.12 além da faixa. | Mortalidade por encharcamento → morte da colônia |
| 2 | **Transbordo de húmus** | Nunca colher: `humus ≥ humusCapacity` define `trayFull`, parando todo o processamento. A fila encalhada apodrece anaerobicamente: `rotToxicity = strandedLiters × ROT_RATE (0.0002)` por tick, × `dilution` (§6.2). A toxicidade sobe ≥ 0.4. | Mortalidade por toxicidade → morte da colônia |
| 3 | **Superalimentação** | Uma grande massa de alimento fresco move `fermentationHeat = FERMENT_COEF (0.35) × freshHeatMass`, disparando o alvo de temperatura — pior na mancha de sol, na ponta quente da parede (§6.1) ou num modelo de baixo isolamento. A temperatura passa 8 °C além da faixa da espécie. | Mortalidade por superaquecimento → morte da colônia |
| 4 | **Só alimento inadequado** | Alimentar somente itens de alta toxicidade acumula toxicidade mais rápido do que os caminhos de remoção conseguem limpar. A reprodução estagna primeiro (estresse de toxicidade ≥ 1 em 0.25), depois a mortalidade começa (toxicidade ≥ 0.4). | Estagnação da reprodução → mortalidade por toxicidade → morte da colônia |

As cadeias 2 e 4 terminam ambas em toxicidade, e ambas têm agora uma
**contra-alavanca**: os caminhos de remoção da §6.4 (`addSawdust`, e os alimentos
de `toxicity` negativa) podem puxar uma caixa de volta da beirada em vez de
deixar o decaimento como único recurso. Nenhuma das cadeias é desarmada por
isso — cada uma ainda alcança seu estado terminal dentro de seu limite sob
negligência pura (travado por `tests/balance.test.js`), porque remediar exige que
o jogador realmente aja. O que mudou é que um erro *recuperável* agora é
recuperável em poucos dias de jogo em vez de ~58.

---

## 9. Pontuação

Fonte: `js/sim/scoring.js`. **Congelado no lançamento da v1 — "pergunte antes"
para mudar.**

```
points += litersHarvested × POINTS_PER_LITER × (1 + colonyAgeDays / AGE_BONUS_DAYS)
```

com `POINTS_PER_LITER = 10` e `AGE_BONUS_DAYS = 30`. Uma colônia de dia 0 pontua
×1; uma colônia de 30 dias pontua ×2; o multiplicador cresce sem limite com a
idade.

- Só a **colheita de húmus** pontua; **drenar chorume rende moedas mas nenhum
  ponto** (§10).
- Entradas negativas/NaN caem para 0, então `scorePoints` é sempre ≥ 0 e o
  `score` corrente é **monotônico — nunca decresce** (`applyHarvestScore`).
- **A morte da colônia zera o multiplicador** (idade → 0) mas mantém os pontos
  acumulados.
- A pontuação acopla produção e longevidade: ficar parado não rende nada (é
  preciso colher); colher-e-recomeçar joga fora o multiplicador de idade.

---

## 10. Economia

Fonte: `js/sim/engine.js` (seção de economia). Tudo puro e determinístico. A
**carteira vive no perfil do jogador** (esquema de save §11), não no `FarmState`,
então ela sobrevive a reinícios do minhocário.

- **Carteira inicial:** `STARTING_WALLET = 200` moedas — suficiente para a
  composteira mais barata (`tier2` = 100) + um pacote de 50 minhocas
  `californiana` (40) + substrato grátis, com folga.
- **Preços de venda automática:** `HUMUS_PRICE_PER_LITER = 12`,
  `LEACHATE_PRICE_PER_LITER = 2`. O húmus colhido e o chorume drenado são
  vendidos instantaneamente — sem inventário. Substrato e resíduo
  doméstico/serragem são grátis.
- **Pacotes de minhocas:** `WORM_PACK_SIZES = [50, 100, 200]`. Preço =
  `round(species.price × (packSize/50) × discount)`, onde `discount = max(0.5, 1 −
  BULK_DISCOUNT_PER_STEP × (steps − 1))`, `steps = packSize/50` (1, 2, 4),
  `BULK_DISCOUNT_PER_STEP = 0.03`. `species.price` é o preço base do pacote de
  50. Preços calculados (base do pacote de 50 = `price` do catálogo):

| espécie | pacote de 50 | pacote de 100 (×1.94) | pacote de 200 (×3.64) |
|---------|-----:|-----:|-----:|
| `californiana` (40) | 40 | 78  | 146 |
| `africana` (70)     | 70 | 136 | 255 |
| `azul` (55)         | 55 | 107 | 200 |

  As minhocas são adicionadas como **adultas**. Uma espécie ou tamanho de pacote
  inválido retorna `Infinity` (inacessível). Veja §7 para a regra de zeramento de
  idade ao repovoar.
- **Upgrade no meio da partida** (`migrateToComposter`): valor de troca = `0.5 ×
  oldComposter.price`; custo líquido = `newPrice − tradeIn` (rejeitado se a
  carteira não cobrir, ou num modelo desconhecido/igual). Em caso de sucesso o
  húmus + chorume da caixa antiga são vendidos automaticamente, a troca é
  creditada, o novo preço debitado, e **minhocas / fila de alimentos / substrato
  (env) / colonyAgeDays / score / colonyAlive todos são transferidos**. Húmus e
  chorume começam em 0 na nova caixa. Se a capacidade da nova caixa for menor, a
  fila transferida é aparada **do mais velho primeiro** para caber (a entrada que
  fica a cavaleiro é truncada, o excesso mais novo é descartado). Uma composteira
  possuída por vez.

---

## 11. Persistência e esquema de save

Fonte: `js/storage.js`. Slot de save único sob a chave de localStorage
`SAVE_KEY = 'minhocario.save'`; formato atual `CURRENT_VERSION = 1`.

```
{
  v: 1,
  profile: { nickname, wallet },
  farm:    { ...FarmState },        // or null between runs
  ranking: [ { nickname, score, composterId, daysSurvived, createdAt }, ... ]
}
```

### FarmState (minhocário persistido), `js/sim/engine.js`

| campo | tipo | notas |
|-------|------|-------|
| `day` | number | dia de jogo, começa em 1 |
| `hour` | number | 0..23 |
| `rngState` | number | estado uint32 serializado do RNG (retoma a sequência exata) |
| `composterId` | string \| null | id do catálogo |
| `speciesId` | string \| null | id do catálogo |
| `wallPosition` | number | 0..1 ao longo da parede |
| `hotSide` | number | qual PONTA da parede é quente: 1 = posição 1, 0 = posição 0. Sorteado uma vez por minhocário a partir da semente (§6.1); ausente em saves anteriores ao gradiente, que resolvem via `hotSideOf` |
| `population` | object | `{ cocoons, juveniles, adults }` |
| `env` | object | `{ moisture, ph, toxicity, temperature }` |
| `queue` | array | `[{ foodId, liters, addedAtTick }]`, mais velho primeiro |
| `humus` | number | litros na bandeja |
| `leachate` | number | litros no tanque |
| `colonyAgeDays` | number | dias desde que a colônia atual começou |
| `colonyAlive` | boolean | falso assim que a população chega a zero |
| `score` | number | pontuação monotônica ao vivo |
| `createdAt` | number | ms de relógio de parede na criação do minhocário (injetado pelo navegador; a simulação nunca lê o relógio) |

- Toda a carga é JSON puro, então ela vai e volta sem perdas e — porque
  `rngState` é carregado — retoma deterministicamente depois de salvar/carregar.
- O **registro de ranking** (`{ nickname, score, composterId, daysSurvived,
  createdAt }`, construído por `rankingEntry` em `js/ui/home.js`) é o formato
  congelado da §2.1 e a carga da API da fase 2 — não adicione nem remova campos.
  `daysSurvived` = o `day` do minhocário; `score` é arredondado. O minhocário
  atual atualiza sua linha ao vivo (marca de máxima); reiniciar a congela
  (`freezeRun`) e começa uma nova. A home mostra o top 10.
- **Autosave** dispara a cada ação do jogador, a cada fronteira de dia de jogo, e
  no `visibilitychange`.
- **Migrações** (registro `MIGRATIONS`, aplicado por `migrate`): chaveadas por
  versão `n → n+1`; uma carga v0 (pré-versionada, plana `{ nickname, wallet,
  farm }`) migra para o formato aninhado `profile` + `ranking` da v1. `load`
  nunca descarta nem reescreve: um save corrompido reporta `CORRUPT`, um save
  mais novo que nós reporta `FUTURE`, e `save` se recusa a sobrescrever qualquer
  um dos dois a menos que forçado.

### Chave de idioma (fora do save)

O idioma ativo é armazenado em sua **própria** chave de localStorage
`minhocario.lang` (`LANG_STORAGE_KEY` em `js/main.js`), valores `pt-BR` / `en` /
`es`. Ela deliberadamente **não** faz parte do save do jogo e está isenta do
congelamento do esquema de save, então mudar de idioma nunca modifica nem
invalida um minhocário. `resolveLang` (`js/strings.js`) escolhe o locale: chave
armazenada → idioma do navegador → `pt-BR` como fallback (o locale de
referência).

---

## 12. Determinismo (RNG)

Fonte: `js/sim/rng.js`. O gerador é o **mulberry32**; todo o seu estado interno é
um único uint32 (`rngState`), então ele serializa para dentro do estado do
minhocário e um save retomado continua exatamente a mesma sequência. Todo fluxo
estocástico da simulação (arredondamento de coortes em `populationStep`) sorteia
do RNG passado para `tick()` — nunca de `Math.random()`. **Mesma semente + mesmas
ações ⇒ mesmo estado**, que é o que toda a suíte de testes usa como base.
