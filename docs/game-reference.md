# Minhocário — Game Reference (behavior & constants)

> **What this is.** A single reference describing what the shipped simulation
> *actually does* right now: the tick/clock model, the full catalogs, the
> environment dynamics, the population pipeline, the production/overflow rules,
> the scoring formula, the economy, and the save schema. Every number cites the
> module and named constant it is transcribed from, so it can be re-verified
> against source.
>
> **Version described:** commit `8207a4e` (branch `master`). The balance
> constants were locked at T21; this doc was written afterward (T21b) to match
> the locked numbers.
>
> **Scope note.** This document describes *mechanics* only. The add-waste food
> list deliberately mixes items whose behavior the player must discover through
> play; this reference lists each food's raw effect numbers **in catalog order**
> and never ranks, labels, groups, or judges any food as suitable or unsuitable.
> The numbers are the mechanics — reading meaning into them is the gameplay.

All simulation logic lives in `js/sim/` (pure, Node-testable, no DOM/Three.js,
no `Math.random`). The browser clock and speed control live in `js/ui/speed.js`
and `js/main.js`. Persistence lives in `js/storage.js`.

---

## 1. Tick & clock model

- **One sim tick = one game hour.** `tick(state, rng)` in `js/sim/engine.js`
  advances the clock by one hour and returns a **new** state (never mutates the
  input). 24 ticks = 1 game day. The hour wraps `23 → 0` and increments `day`.
- **Absolute tick index:** `absoluteTick(state) = (day − 1) × 24 + hour`
  (`js/sim/engine.js`). Day 1 hour 0 = tick 0. Food entries are stamped with
  this index and decomposition is measured against it.
- **Real-time cadence:** `MS_PER_TICK = 2500` (`js/ui/speed.js`) — one tick every
  2.5 real seconds at 1×. The effective tick length is `MS_PER_TICK / speed`, so
  speed scales **only** the timer; the sim step is identical at every speed.
- **Speed multipliers:** `SPEEDS = [0.25, 0.5, 1, 5, 20]`, `DEFAULT_SPEED = 1`
  (`js/ui/speed.js`). Pause is a separate control (`PAUSED`), not a member of
  `SPEEDS`.

| Speed | ms/tick (`MS_PER_TICK/speed`) | Real seconds per game day (24 ticks) |
|------:|------------------------------:|-------------------------------------:|
| 0.25× | 10 000 | 240 s (4 min) |
| 0.5×  | 5 000  | 120 s |
| 1×    | 2 500  | 60 s |
| 5×    | 500    | 12 s |
| 20×   | 125    | 3 s |

- **No offline/catch-up progress.** The accumulator (`drainTicks` in
  `js/ui/speed.js`) converts banked real time into whole ticks; a backlog beyond
  `MAX_TICKS_PER_FRAME = 100` (`js/main.js`) is **dropped**, and a single frame
  is capped at `MAX_FRAME_MS = 250`. The clock freezes on `visibilitychange`
  (tab hidden) and resumes at the saved hour — closing the browser freezes the
  farm exactly as saved.
- **Colony-death auto-pause.** `clockForColony` (`js/ui/speed.js`) drops the
  clock to `PAUSED` when the colony dies (a dead colony produces nothing) and
  restores the previous speed once it is repopulated.

---

## 2. Composter catalog

Source: `js/sim/composters.js` (`COMPOSTERS`, shop display order: appliance →
largest). Field meanings are documented in that module's header.

| id | capacity (L) | humusCap (L) | leachateCap (L) | speed | humusRate | leachateRate | tempResponse | regulation | price |
|----|-----:|-----:|-----:|----:|-----:|-----:|-----:|-----:|-----:|
| `electric` | 20  | 8  | 4  | 1.7 | 0.78 | 0.15 | 0.5  | 0.9  | 200 |
| `tier2`    | 30  | 12 | 6  | 0.8 | 0.5  | 0.18 | 0.6  | 0    | 100 |
| `tier3`    | 45  | 18 | 9  | 1.0 | 0.52 | 0.2  | 0.45 | 0    | 180 |
| `tier4`    | 60  | 24 | 12 | 1.2 | 0.55 | 0.22 | 0.35 | 0    | 280 |
| `buried`   | 80  | 32 | 16 | 1.0 | 0.58 | 0.15 | 0.12 | 0    | 300 |
| `eco`      | 100 | 40 | 20 | 1.4 | 0.6  | 0.22 | 0.3  | 0.05 | 450 |

- **capacity** bounds the food queue (§7). **humusCapacity / leachateCapacity**
  drive the two overflow chains (§8).
- **speed** multiplies eating throughput; **humusRate / leachateRate** are the
  fractions of eaten food converted to humus / leachate.
- **tempResponse** (0..1) is the fraction of the temperature gap closed per tick
  — high = tracks ambient closely, low = thermally stable. **regulation** (0..1)
  is the active pull of the blend target toward `IDEAL_TEMP`; only `electric`
  (0.9) and `eco` (0.05) regulate, all others are passive (0). See §6.
- Display names/descriptions are **not** in the sim; they live per-locale under
  `catalog.composters[id]` in `js/i18n/{pt-BR,en,es}.js`.

---

## 3. Worm species catalog

Source: `js/sim/worms.js` (`SPECIES`, setup display order). Comfort bands are
per-species; the pH and toxicity bands (§6) are shared by all species.

| id | latin | reproduction (cocoons/adult/tick) | speed | temp comfort (°C) | moisture comfort | price (50-pack) |
|----|-------|-----:|----:|:-----:|:-----:|-----:|
| `californiana` | *Eisenia fetida*     | 0.02  | 1.0 | 10 – 30 | 0.40 – 0.85 | 40 |
| `africana`     | *Eudrilus eugeniae*  | 0.022 | 1.4 | 20 – 34 | 0.45 – 0.80 | 70 |
| `azul`         | *Perionyx excavatus* | 0.035 | 1.1 | 15 – 32 | 0.55 – 0.72 | 55 |

- `reproduction` is base cocoons laid per adult per tick under ideal conditions
  (scaled down by `reproductionFactor`, §7). `speed` multiplies both eating
  throughput and food demand.
- `latin` is a language-neutral data field (the one display-adjacent string
  allowed in `js/sim/`); localized `name`/`desc` live under `catalog.worms[id]`
  in the i18n catalogs.
- Structural relationships the tests lock: `africana` eats fastest (speed 1.4)
  and is the most cold-sensitive (comfort floor 20 °C); `azul` breeds fastest
  (0.035) with the narrowest moisture band (0.55–0.72).

---

## 4. Food catalog

Source: `js/sim/foods.js` (`FOODS`). **Order below is the catalog order** — it
is an intentionally irregular mix (not grouped good-then-bad, and deliberately
not a strict suitable/harmful alternation, so a food's index never predicts its
suitability) and carries no meaning. Each entry's fields are the raw per-liter
effect numbers released **gradually** as the entry decomposes; `heat` is a
fermentation-heat multiplier applied while the entry is still fresh. No
suitability field exists in the data shape.

| id (catalog order) | moisture /L | ph /L (− acid, + alkaline) | toxicity /L | heat (fresh) |
|--------------------|-----:|-----:|-----:|-----:|
| `fruitPeels`      | 0.05 | −0.02 | 0.00 | 1.0 |
| `onionGarlic`     | 0.04 | −0.05 | 0.03 | 1.0 |
| `coffeeGrounds`   | 0.03 | −0.03 | 0.00 | 1.1 |
| `vegetableScraps` | 0.06 |  0.00 | 0.00 | 1.0 |
| `meat`            | 0.03 |  0.00 | 0.15 | 1.8 |
| `eggshells`       | 0.00 |  0.04 | 0.00 | 0.9 |
| `cookedPasta`     | 0.05 |  0.00 | 0.06 | 1.4 |
| `citrus`          | 0.05 | −0.15 | 0.01 | 1.0 |
| `wetCardboard`    | 0.07 |  0.00 | 0.00 | 0.8 |
| `dairy`           | 0.04 | −0.02 | 0.12 | 1.6 |
| `teaLeaves`       | 0.04 | −0.01 | 0.00 | 1.0 |
| `pumpkinGuts`     | 0.08 |  0.00 | 0.00 | 1.1 |
| `oilyFood`        | 0.02 |  0.00 | 0.13 | 1.7 |
| `saltyLeftovers`  | 0.03 |  0.00 | 0.10 | 1.2 |

- **Decomposition:** `DECOMP_TICKS = 48` (`js/sim/foods.js`) — an entry fully
  breaks down over 48 ticks (2 game days). `decompositionFraction(ageTicks)` is
  a linear ramp `ageTicks / DECOMP_TICKS`, clamped to `[0, 1]`.
- **Gradual release:** `queueDynamics(queue, prevTick, newTick)` releases each
  effect in proportion to the decomposition fraction gained this tick
  (`(newFrac − prevFrac) × liters × field`). `freshHeatMass` is the still-fresh,
  heat-weighted mass driving fermentation heat (§6).
- **Queue entry shape:** `{ foodId, liters, addedAtTick }`; minimum portion
  `MIN_PORTION_LITERS = 0.25 L` (`js/sim/engine.js`). `addFood` rejects unknown
  foods and sub-minimum portions, and clamps an over-capacity add to the space
  left (or rejects it when less than one minimum portion remains).
- Localized `name` (only) lives under `catalog.foods[id]` in the i18n catalogs —
  **no** category/ordering/suitability signal in any locale.

---

## 5. Bedding mix → initial environment

Source: `js/sim/engine.js` (`BEDDING_COMPONENTS`, `RECOMMENDED_BEDDING`,
`beddingEnv`). The guided setup mix seeds the bin's starting moisture and pH as
a volume-weighted blend of three components:

| component | moisture | pH | recommended default (L) |
|-----------|-----:|----:|-----:|
| `sawdust`   | 0.15 | 6.2 | 1.5 |
| `peels`     | 0.85 | 5.0 | 1.0 |
| `cardboard` | 0.80 | 7.2 | 2.5 |

`beddingEnv(mix)` returns `{ moisture, ph }` = the liter-weighted average of the
components (empty mix → neutral `{ moisture: 0.5, ph: 7 }`). The recommended mix
is tuned so the blend lands inside every species' comfort band. Initial
toxicity is 0 and initial temperature 20 °C (`createInitialFarmState` base env).

---

## 6. Environment dynamics & comfort bands

Each tick updates four bin-wide variables (`env: { moisture, ph, toxicity,
temperature }`). All update math is in `tick()` (`js/sim/engine.js`) unless a
temperature helper is cited from `js/sim/temperature.js`.

### 6.1 Temperature

The blend target for the new hour is:

```
target = ambientTemperature(hour) + solarGain(wallPosition, hour) + fermentationHeat(freshHeatMass)
newTemp = blendTemperature(prevTemp, target, composter)
```

- **Ambient cycle** (`ambientTemperature`, `js/sim/temperature.js`): sinusoid,
  `AMBIENT_MEAN = 20`, `AMBIENT_AMPLITUDE = 8`, `AMBIENT_PEAK_HOUR = 15`. Night
  low ≈ 12 °C (pre-dawn), day high ≈ 28 °C (mid-afternoon); periodic over 24 h.
- **Solar gain** (`solarGain`, `js/sim/temperature.js`): **0 at night** (hour ≤
  `SUNRISE_HOUR = 6` or ≥ `SUNSET_HOUR = 18`). During the day a bright patch
  sweeps the wall from position 0 at sunrise to 1 at sunset; intensity peaks at
  solar noon. `SOLAR_MAX = 12` °C peak, `PATCH_WIDTH = 0.35` (half-width in wall
  units). A composter at the patch centre at midday gets the full contribution;
  the shaded ends get 0. This is the **single source of truth** the render layer
  samples for the sun patch, so sim and visuals cannot drift.
- **Fermentation heat** (`fermentationHeat`, `js/sim/temperature.js`):
  `FERMENT_COEF = 0.35` °C per liter of fresh (heat-weighted) food mass —
  monotonic in mass, 0 when empty. This is the overfeeding chain's driver (§8).
- **Blend** (`blendTemperature`, `js/sim/temperature.js`): regulated models bias
  the target toward `IDEAL_TEMP = 22` first —
  `effectiveTarget = target + regulation × (IDEAL_TEMP − target)` — then close
  `tempResponse` of the remaining gap:
  `new = current + tempResponse × (effectiveTarget − current)`. With no
  composter the defaults are `response = 0.5`, `regulation = 0`.

**Temperature comfort band is per-species** (§3): `californiana` 10–30,
`africana` 20–34, `azul` 15–32 °C.

### 6.2 Moisture (0..1)

```
moisture = clamp01(prev + released + eatenMoisture + spillMoisture − evaporation)
           then percolation drains excess into the leachate tank
```

- **Released** from decomposing food (`queueDynamics`, §4).
- **eatenMoisture:** water in *eaten* food still enters the bedding — only the
  share not already released via decomposition is credited
  (`food.moisture × eatenHere × (1 − decompFraction)`), so each liter releases
  its water exactly once whether it rots in place or is eaten.
- **Evaporation** is temperature-gated: `EVAP_COEF = 0.0006` per °C above
  `EVAP_THRESHOLD = 24` °C, using the pre-tick temperature. A cool bin barely
  dries; a hot/sun-baked bin dries into lethal territory.
- **Sawdust** (`addSawdust`): removes `SAWDUST_DRY_PER_LITER = 0.03` moisture per
  liter added (a direct action, not a queue entry).
- **spillMoisture** comes from the leachate-overflow chain (§8).
- **Percolation** (the water OUT-path of a cool bin): when
  `moisture > FIELD_CAPACITY = 0.75` **and** the leachate tank has room,
  `PERCOLATION_RATE = 0.3` of the excess drains down, converted at
  `MOISTURE_TO_LEACHATE_LITERS = 8` L of leachate per 1.0 moisture unit, capped
  by remaining tank room. When the tank is full, percolation backs up and the
  bedding saturates — this is what makes the never-drain chain terminal.

**Moisture comfort band is per-species** (§3): `californiana` 0.40–0.85,
`africana` 0.45–0.80, `azul` 0.55–0.72.

### 6.3 pH (0..14)

```
ph = clamp(prev + (NEUTRAL_PH − prev) × PH_DRIFT_RATE + phPush, 0, 14)
```

`NEUTRAL_PH = 7`, `PH_DRIFT_RATE = 0.02` (`js/sim/engine.js`): the bin eases 2%
of the way back to neutral each tick, then takes the signed food push
(`phPush` from `queueDynamics`). **pH comfort band = `PH_COMFORT` 6–8**
(`js/sim/worms.js`), shared by all species.

### 6.4 Toxicity (0..1)

```
toxicity = clamp01(prev × (1 − TOX_DECAY_RATE) + released + rotToxicity)
```

`TOX_DECAY_RATE = 0.001` (`js/sim/engine.js`) — deliberately very slow decay, so
toxicity is the long-term punishment. `released` is the food toxicity load (§4);
`rotToxicity` comes from the humus-overflow chain (§8). **Toxicity is
comfortable below `TOX_THRESHOLD = 0.1`** (`js/sim/worms.js`).

### 6.5 Comfort / stress calibration (summary)

Source: `js/sim/worms.js`. A variable's normalized **stress** is its distance
outside its comfort band divided by that variable's *stall span*. Stress `1` =
laying fully stalled; stress `LETHAL_RATIO = 2` = mortality onset.

| variable | comfort band | stall span | lethal onset (2× stall outside band) |
|----------|--------------|-----------:|--------------------------------------|
| temperature | per-species | `TEMP_STALL = 4` °C | 8 °C outside the band |
| moisture    | per-species | `MOISTURE_STALL = 0.06` | 0.12 outside the band |
| pH          | 6 – 8       | `PH_STALL = 1` | pH < 4 or > 10 |
| toxicity    | ≤ 0.1       | `TOX_STALL = 0.15` | toxicity ≥ 0.4 |
| overpopulation | ≤ carrying cap | `OVERPOP_STALL = 0.5` | `active ≥ 2 × carrying capacity` |
| hunger      | — | capped at 1 | **never lethal** (see §7) |

---

## 7. Population pipeline & mortality

Source: `js/sim/worms.js` (`populationStep`, `reproductionFactor`,
`mortalityRate`). Three-stage cohort model: **cocoons → juveniles → adults**.
All fractional flows are stochastically rounded through the seeded RNG so counts
stay integer and deterministic per seed.

Per-tick flows (computed from the pre-tick snapshot, order-independent):

| flow | formula |
|------|---------|
| laid (new cocoons) | `adults × species.reproduction × reproductionFactor` |
| hatched (cocoons → juveniles) | `cocoons / HATCH_TICKS`, `HATCH_TICKS = 48` (~2 days) |
| matured (juveniles → adults)  | `juveniles / MATURE_TICKS`, `MATURE_TICKS = 72` (~3 days) |
| deaths per stage | `stageCount × mortalityRate` |

Empty-pipeline recovery lag = `HATCH_TICKS + MATURE_TICKS` = 120 ticks (~5 days):
after conditions are fixed, adults return only once cocoons hatch and juveniles
mature, so neglect keeps hurting after recovery.

- **`reproductionFactor` ∈ [0,1]** = `min` over all six stresses of
  `clamp01(1 − stress)` — laying drops to 0 as the **worst single** variable
  reaches its stall distance.
- **`mortalityRate` ∈ [0,1]** = `Σ max(0, stress − LETHAL_RATIO) × MORT_SLOPE`,
  clamped, with `LETHAL_RATIO = 2`, `MORT_SLOPE = 0.08`. Mortality is 0 until a
  variable passes its lethal distance, so **laying always stalls before dying**.
- **Carrying capacity** = `composter.capacity × DENSITY`, `DENSITY = 50`
  worms/L (`carryingCapacity`). Overpopulation stress =
  `max(0, active/cap − 1) / OVERPOP_STALL`.
- **Nutrition (`ration`)** = `clamp01(standing / (demand × RATION_TICKS))`,
  `RATION_TICKS = 24` (`js/sim/worms.js`), where `demand = active ×
  species.speed × composter.speed × CONSUMPTION_PER_WORM` (computed in `tick`).
  Hunger stress = `clamp01(1 − ration)` — **capped at the stall distance (1)**,
  so hunger brakes reproduction but is **never lethal**: a starving colony stops
  growing and ages out, it is not struck down.

### Mortality triggers (each kills independently)

Every one of these, on its own, can drive `mortalityRate > 0` once past its
lethal onset (§6.5 table):

1. **Overheat / cold** — temperature ≥ 8 °C outside the species band.
2. **Dryness / over-wetness** — moisture ≥ 0.12 outside the species band.
3. **pH extreme** — pH below 4 or above 10.
4. **Toxicity** — toxicity ≥ 0.4.
5. **Overpopulation** — active worms ≥ 2× carrying capacity.

Hunger is intentionally excluded (capped below lethal).

### Colony lifecycle

Source: `js/sim/engine.js` (`tick`) and `js/sim/engine.js` economy functions.

- `colonyAgeDays` increments once per game-day rollover **while the colony
  lives**; a dead colony freezes at the age it reached.
- **Death is a transition:** a colony that *had* worms (pre-tick total > 0) and
  now has none flips `colonyAlive → false`. An empty pre-setup farm (never had
  worms) never makes that transition. A dead colony produces nothing.
- **Repopulate** (`buyWormPack` / `repopulateColony`): buying a worm pack into a
  dead colony sets `colonyAlive → true` and resets `colonyAgeDays → 0`, while
  score / humus / leachate totals are kept. Buying into a **live** colony does
  **not** reset the age.

---

## 8. Production, consumption & overflow chains

Source: `js/sim/engine.js` (`tick`). Consumption uses the pre-tick population and
is fully deterministic (no RNG).

- **Eating throughput per tick:**
  `toEat = active × species.speed × composter.speed × CONSUMPTION_PER_WORM`,
  `CONSUMPTION_PER_WORM = 0.0005` L/worm/tick.
- **Oldest-first:** the queue is eaten from the front; a fully consumed entry is
  removed, a partially eaten one keeps its remainder in place.
- **Output:** `humus += eaten × composter.humusRate`;
  `leachate += eaten × composter.leachateRate`.
- **Gating:** worm processing runs only when a species is set, `active > 0`, the
  humus tray is **not** full, and `colonyAlive` is true. Fully decomposed food
  (age ≥ `DECOMP_TICKS`) is worked into the bedding and leaves the queue when
  eating runs; it yields **no** humus (humus is only what worms make).
- **Player actions** (all pure, no RNG): `addFood`, `addSawdust`,
  `drainLeachate` (instant, empties the tank fully), `harvestHumus` (empties the
  tray at any time — re-enables processing after a tray-full halt).

### The four §2.8 failure chains

Each chain's trigger and terminal state (all end in colony death — production
stops once `colonyAlive → false`):

| # | Chain | Trigger → mechanism | Terminal state |
|---|-------|---------------------|----------------|
| 1 | **Leachate overflow** | Never draining: percolation fills the tank (`leachateCapacity`); once full, percolation backs up and leachate past capacity re-saturates the bedding — `spillMoisture = (leachate − leachateCapacity) × LEACHATE_SPILL_TO_MOISTURE (0.05)`, tank clamps at capacity. Moisture climbs ≥ 0.12 past the band. | Over-wetness mortality → colony death |
| 2 | **Humus overflow** | Never harvesting: `humus ≥ humusCapacity` sets `trayFull`, halting all processing. The stranded queue rots anaerobically: `rotToxicity = strandedLiters × ROT_RATE (0.0002)` per tick. Toxicity climbs ≥ 0.4. | Toxicity mortality → colony death |
| 3 | **Overfeeding** | A large fresh-food mass drives `fermentationHeat = FERMENT_COEF (0.35) × freshHeatMass`, spiking the temperature target — worse in the sun patch or a low-insulation model. Temperature passes 8 °C beyond the species band. | Overheat mortality → colony death |
| 4 | **Only unsuitable food** | Feeding only high-toxicity items accrues toxicity faster than `TOX_DECAY_RATE (0.001)` removes it. Reproduction stalls first (toxicity stress ≥ 1 at 0.25), then mortality begins (toxicity ≥ 0.4). | Reproduction stall → toxicity mortality → colony death |

---

## 9. Scoring

Source: `js/sim/scoring.js`. **Frozen at v1 ship — "ask first" to change.**

```
points += litersHarvested × POINTS_PER_LITER × (1 + colonyAgeDays / AGE_BONUS_DAYS)
```

with `POINTS_PER_LITER = 10` and `AGE_BONUS_DAYS = 30`. A day-0 colony scores
×1; a 30-day colony scores ×2; the multiplier grows without bound with age.

- Only **humus harvest** scores; **leachate drain earns coins but no points**
  (§10).
- Negative/NaN inputs floor to 0, so `scorePoints` is always ≥ 0 and the running
  `score` is **monotonic — it never decreases** (`applyHarvestScore`).
- **Colony death resets the multiplier** (age → 0) but keeps banked points.
- The score couples production and longevity: idling earns nothing (you must
  harvest); harvest-then-restart throws away the age multiplier.

---

## 10. Economy

Source: `js/sim/engine.js` (economy section). All pure and deterministic. The
**wallet lives on the player profile** (save schema §11), not on `FarmState`, so
it survives farm restarts.

- **Starting wallet:** `STARTING_WALLET = 200` coins — enough for the cheapest
  composter (`tier2` = 100) + a 50-worm `californiana` pack (40) + free bedding,
  with slack.
- **Auto-sell prices:** `HUMUS_PRICE_PER_LITER = 12`,
  `LEACHATE_PRICE_PER_LITER = 2`. Harvested humus and drained leachate sell
  instantly — no inventory. Bedding and household waste/sawdust are free.
- **Worm packs:** `WORM_PACK_SIZES = [50, 100, 200]`. Price = `round(species.price
  × (packSize/50) × discount)`, where `discount = max(0.5, 1 −
  BULK_DISCOUNT_PER_STEP × (steps − 1))`, `steps = packSize/50` (1, 2, 4),
  `BULK_DISCOUNT_PER_STEP = 0.03`. `species.price` is the base 50-pack price.
  Worked prices (base 50-pack = catalog `price`):

| species | 50-pack | 100-pack (×1.94) | 200-pack (×3.64) |
|---------|-----:|-----:|-----:|
| `californiana` (40) | 40 | 78  | 146 |
| `africana` (70)     | 70 | 136 | 255 |
| `azul` (55)         | 55 | 107 | 200 |

  Worms are added as **adults**. An invalid species or pack size returns
  `Infinity` (unaffordable). See §7 for the repopulate age-reset rule.
- **Mid-farm upgrade** (`migrateToComposter`): trade-in = `0.5 ×
  oldComposter.price`; net cost = `newPrice − tradeIn` (rejected if the wallet
  can't cover it, or on an unknown/same model). On success the old bin's humus +
  leachate are auto-sold, the trade-in is credited, the new price deducted, and
  **worms / food queue / bedding (env) / colonyAgeDays / score / colonyAlive all
  carry across**. Humus and leachate start at 0 in the new bin. If the new bin's
  capacity is smaller, the carried queue is trimmed **oldest-first** to fit
  (the straddling entry is truncated, newest overflow discarded). One composter
  owned at a time.

---

## 11. Persistence & save schema

Source: `js/storage.js`. Single save slot under localStorage key
`SAVE_KEY = 'minhocario.save'`; current format `CURRENT_VERSION = 1`.

```
{
  v: 1,
  profile: { nickname, wallet },
  farm:    { ...FarmState },        // or null between runs
  ranking: [ { nickname, score, composterId, daysSurvived, createdAt }, ... ]
}
```

### FarmState (persisted farm), `js/sim/engine.js`

| field | type | notes |
|-------|------|-------|
| `day` | number | game day, starts at 1 |
| `hour` | number | 0..23 |
| `rngState` | number | serialized uint32 RNG state (resumes the exact sequence) |
| `composterId` | string \| null | catalog id |
| `speciesId` | string \| null | catalog id |
| `wallPosition` | number | 0..1 along the wall |
| `population` | object | `{ cocoons, juveniles, adults }` |
| `env` | object | `{ moisture, ph, toxicity, temperature }` |
| `queue` | array | `[{ foodId, liters, addedAtTick }]`, oldest first |
| `humus` | number | liters in the tray |
| `leachate` | number | liters in the tank |
| `colonyAgeDays` | number | days since the current colony started |
| `colonyAlive` | boolean | false once the population hits zero |
| `score` | number | live monotonic score |
| `createdAt` | number | wall-clock ms at farm creation (injected by the browser; the sim never reads the clock) |

- The whole payload is plain JSON, so it round-trips losslessly and — because
  `rngState` is carried — resumes deterministically after save/load.
- **Ranking record** (`{ nickname, score, composterId, daysSurvived, createdAt }`,
  built by `rankingEntry` in `js/ui/home.js`) is the frozen §2.1 shape and the
  phase-2 API payload — do not add or drop fields. `daysSurvived` = the farm's
  `day`; `score` is rounded. The current farm updates its row live (high-water
  mark); restart freezes it (`freezeRun`) and starts a new one. Home shows top 10.
- **Autosave** fires on every player action, every game-day boundary, and
  `visibilitychange`.
- **Migrations** (`MIGRATIONS` registry, applied by `migrate`): keyed by version
  `n → n+1`; a v0 (pre-versioned, flat `{ nickname, wallet, farm }`) payload
  migrates to v1's nested `profile` + `ranking` shape. `load` never discards or
  rewrites: a corrupt save reports `CORRUPT`, a newer-than-us save reports
  `FUTURE`, and `save` refuses to overwrite either unless forced.

### Language key (outside the save)

The active language is stored in its **own** localStorage key
`minhocario.lang` (`LANG_STORAGE_KEY` in `js/main.js`), values `pt-BR` / `en` /
`es`. It is deliberately **not** part of the game save and is exempt from the
save-schema freeze, so changing language never modifies or invalidates a farm.
`resolveLang` (`js/strings.js`) picks the locale: stored key → browser language
→ `pt-BR` fallback (the reference locale).

---

## 12. Determinism (RNG)

Source: `js/sim/rng.js`. The generator is **mulberry32**; its entire internal
state is a single uint32 (`rngState`), so it serializes into the farm state and
a resumed save continues the exact same sequence. Every stochastic flow in the
sim (cohort rounding in `populationStep`) draws from the RNG passed into
`tick()` — never `Math.random()`. **Same seed + same actions ⇒ same state**, which
is what the whole test suite relies on.
