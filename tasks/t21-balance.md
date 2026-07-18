# T21 — Second balance pass + constant lock-in

> Deps: CP6 playtest notes (`tasks/cp6-playtest.md`). Method: headless scenario
> simulations through `tick()` with a seeded RNG, in the style of
> `tests/balance.test.js`. Suite after this pass: **222 green** (`node --test
> tests/*.test.js`). No scoring formula or save-schema change — only the electric
> composter price and the `tests/balance.test.js` bounds were touched.

This pass resolves the two OPEN notes CP6 left for T21 (T21-3 electric earnings,
T21-4 africana pairing), then tightens the balance bounds so the tuned constants
are locked by tests. T21-1/T21-2 were already resolved at CP6.

---

## T21-3 — Electric composter earnings — RESOLVED (price cut 350 → 200)

### The problem (from CP6)

The electric composter is the most efficient bin per litre but is out-earned in
absolute coins/day by cheaper, larger bins, so a rational player skips it. CP6's
table (well-fed, 30-day steady state):

| model | price | cap | coins/day | coins/day per litre |
|---|---|---|---|---|
| **electric** | **350** | 20 | 67.2 | **3.36** (best) |
| tier2 | 100 | 30 | 53.9 | 1.80 |
| tier3 | 180 | 45 | 75.6 | 1.68 |
| tier4 | 280 | 60 | 93.9 | 1.56 |
| buried | 300 | 80 | 72.3 | 0.90 |

At 350 (second-highest price) the bin was a **trap**: flagship price, out-earned
by the 100-coin tier2. The efficiency-per-litre lead is real but does not read to
a player who is choosing on raw output.

### Why not the AMBIENT_AMPLITUDE lever

The two candidate levers were (a) a price cut to ~200, or (b) widening
`AMBIENT_AMPLITUDE` to make cold nights genuinely threatening so the electric
bin's regulation defends a real threat. **The amplitude lever does not fix the
stated problem for the common case.** The coins/day comparison above is run with
Vermelha-da-Califórnia, which is cold-tolerant (comfort band 10–30 °C): colder
nights barely touch it, so widening amplitude leaves the whole ranking table
unchanged while adding large blast radius to every californiana chain (the
overfeeding, drying, and good-care bounds are all temperature bounds in
disguise — cp6 note). Amplitude only helps the africana niche (T21-4), not the
earnings gap. It is the wrong tool here.

### Lever chosen: price 350 → 200 (`js/sim/composters.js`)

Least invasive (a price is not read inside `tick()`, so it has **zero** effect on
any failure chain or the good-care run — verified: full suite still green), and
it directly fixes the value proposition. At 200 the electric bin reads as **the
cheapest efficient regulated bin** — a modest premium over tier3 (180), a
sensible first upgrade from tier2 (net upgrade cost 200 − 50 trade-in = 150),
rather than a coins/day trap priced like a flagship.

Its coherent role after the cut: a **specialist side-grade**, not a raw-output
king. It leads the catalog on throughput per worm and per litre, and — the part
no other bin can do — its active regulation is the only thing that keeps a
cold-sensitive species reproducing overnight (see T21-4). Capacity will always
let a bigger bin out-earn it on raw coins/day; that is inherent to the
"capacity gates the colony" design and is acknowledged, not fought.

**Locked by** `tests/balance.test.js` → *"electric is priced as a mid-tier
specialist premium, not a flagship trap"*: asserts `tier3 < electric ≤ tier4`
(180 < 200 ≤ 280). Reverting toward the old 350 (> tier4 280) fails the test.

---

## T21-4 — Africana + sun spot — SPEC ERRATUM (documented; spec left untouched)

### Finding

Spec §2.9 says the Gigante-Africana "pairs with the sun spot or the electric
composter." **The sun-spot half is wrong and cannot be made right without
breaking other locked chains.** Africana's binding constraint is the cold night
(comfort floor 20 °C); `solarGain` is 0 at night by construction (§2.6), so no
wall position lifts the night trough.

Measured night trough for a tended africana colony (min night bin temperature),
`AMBIENT_AMPLITUDE = 8`, `SOLAR_MAX = 12`:

| composter | wall 0.5 (sun) | wall 0.0 (shade) | verdict |
|---|---|---|---|
| tier2 (passive) | 12.3 °C | 12.3 °C | below floor, unchanged by placement |
| tier3 | 12.7 °C | 12.7 °C | below floor |
| tier4 | 13.2 °C | 13.2 °C | below floor |
| buried (most inert) | 16.2 °C | 16.2 °C | below floor |
| **electric** | **20.6 °C** | **20.6 °C** | **in band** |

The sun spot changes the daytime peak but leaves the night trough untouched — a
placement move of 0.5 → 0.0 shifts the trough by < 0.1 °C. Only the electric
bin's active regulation holds the night ≥ 20 °C.

### Why the preferred fix (lower passive `tempResponse`) was rejected

The task's preferred remedy was to lower passive models' `tempResponse` so bins
carry daytime heat overnight — **if** the full suite and all chain timings stay
in bounds. They do not. To hold a sun-spot bin's night trough ≥ 20 °C,
`tempResponse` must drop to ~0.05 (probe: `js/sim/temperature.js` blend math):

| tempResponse | wall 0.5 night min | wall 0.5 day max |
|---|---|---|
| 0.30 | 13.6 °C | 31.3 °C |
| 0.12 (buried) | 17.5 °C | 26.3 °C |
| 0.08 | 19.0 °C | 24.9 °C |
| **0.05** | **20.2 °C** | **23.8 °C** |

At `tempResponse ≈ 0.05` the bin is nearly inert: its midday peak is capped at
~24 °C. That directly breaks the locked chains that need a sunny bin to run hot:

- *OVERFEEDING in the sun cooks the bin before it drowns* — needs peak ≥ 38 °C.
- *the same mistake produces DIFFERENT failure signatures by placement* — needs
  the sunny bin > 5 °C hotter than the shaded one.
- the drying chain leans on temperature-gated evaporation reaching high temps.

The sun spot and thermal inertia are in **direct conflict**: a bin cannot both
run hot at midday (so placement matters and overfeeding cooks it) *and* hold
≥ 20 °C overnight (so it rescues africana). Only active regulation decouples the
two — which is exactly why the electric bin is africana's sole genuine remedy,
and reinforces the T21-3 story that its regulation is a real, unique capability.

### Decision

- **Do not edit the spec** (per the task). The erratum is recorded here.
- **Do not change `tempResponse`** (would break three locked chains for no net
  gain).
- Encode the finding as an executable test so it cannot silently regress:
  `tests/balance.test.js` → *"the sun spot cannot rescue africana from cold
  nights — only the electric bin can"* asserts a passive bin at the sunniest wall
  still drops below africana's 20 °C floor at night (and barely moves with
  placement), while the electric bin holds the night ≥ 20 °C.

**Erratum, for a future spec revision:** §2.9 should read that the
Gigante-Africana pairs with **the electric composter** (active thermal
regulation). The sun spot raises daytime temperature only and does not protect
it from cold nights.

---

## Constant lock-in — tightened `tests/balance.test.js` bounds

All scenarios are deterministic per seed; the measured values below are exact and
reproducible. Bounds were tightened from bare "reaches a terminal state within N
days" toward a narrow window around the measured value, so a constant edit that
materially shifts a chain's timing — in **either** direction — now trips a test.

### §2.8 failure-chain terminal days (each still reachable at 20×)

| chain | scenario (seed / bin / wall) | measured death | old bound | new window |
|---|---|---|---|---|
| leachate saturation | 7 / tier2 / 0.2 | day 13 | ≤ 30 | **10 ≤ d ≤ 16** |
| humus rot | 7 / tier2 / 0.2 | day 16 | ≤ 35 | **12 ≤ d ≤ 22** |
| overfeeding heat | 7 / eco / 0.5 | day 3 | ≤ 15 | **2 ≤ d ≤ 8** |
| toxic food | 7 / tier2 / 0.2 | day 5 | ≤ 20 | **3 ≤ d ≤ 10** |
| drying | 7 / tier2 / 0.5 | day 11 | ≤ 30 | **8 ≤ d ≤ 16** |

The new **lower** bounds are the meaningful addition: they assert each death is a
genuine slow-neglect chain (not an instant kill), so a change that makes any chain
fire too early is now caught. Wall-clock at 20× (≈ 3 s/game-day): the slowest
locked chain (humus rot, ≤ 22 days) is ≤ ~66 s — comfortably one session.

### Good-care envelope (seed 42, tier2, californiana, wall 0.3, 65 days)

| metric | measured | old bound | new bound |
|---|---|---|---|
| end population | 1463 | > 100 | **1150 < pop < 1800** |
| min population | 50 | ≥ 50 | ≥ 50 (kept) |
| max moisture | 0.710 | < 0.97 | **< 0.75** |
| max temperature | 31.76 °C | < 38 | **< 33** |
| min moisture | 0.500 | > 0.28 | **> 0.45** |
| season score | 1962.8 | > 0 | **> 1500** |

The good-care run still survives the full 60+ days with net growth (the primary
constraint), now with its comfort margin and food-supported end size both locked:
a hotter sun patch, wetter food, or a scoring/economy regression shows up here
long before it turns lethal.

### New locking tests added

- *electric is priced as a mid-tier specialist premium, not a flagship trap*
  (T21-3): `tier3 < electric ≤ tier4`.
- *the sun spot cannot rescue africana from cold nights — only the electric bin
  can* (T21-4): passive sun-spot night trough < floor; electric night trough ≥
  floor.

---

## Summary of changes

| file | change |
|---|---|
| `js/sim/composters.js` | electric `price` 350 → 200 (+ rationale comment) |
| `tests/balance.test.js` | tightened 5 chain windows + good-care envelope; 2 new locking tests |
| `tests/production.test.js` | refreshed the stale "second-highest price" comment |

No sim dynamics constants were changed (only a price). The four §2.8 chains stay
reachable in tolerable wall-clock at 20×, and the good-care scenario still
survives 60+ days with net growth.

---

# T24 — Feed-rate pacing: `THROUGHPUT_CAP_PER_LITER`

> Method as above: headless scenarios through `tick()` with a seeded RNG. Suite
> after this pass: **256 green** (`node --test tests/*.test.js`). No scoring
> formula and no save-schema change. The good-care numbers in the T21 section
> above are the **pre-cap** measurements and are superseded by the table here.

## The problem — found in play, not by the suite

This one was **not** caught by any test. It surfaced in hands-on play: at 5×
speed a mature colony devoured the largest portion the UI can serve within a
couple of real seconds, so the player could not keep the bin fed by hand and
feeding stopped reading as a decision. The whole suite was green throughout —
every balance bound is about *survival and terminal days*, and none of them
looks at the **rate** at which a portion disappears in wall-clock time, which is
the thing the player actually experiences. Worth remembering as a coverage gap:
the balance harness locks outcomes, not pacing.

The cause is structural. Demand is linear and unbounded in population
(`active × species.speed × composter.speed × CONSUMPTION_PER_WORM`), so it grows
with `capacity × DENSITY` (50 worms/L, `js/sim/worms.js`), while the largest
portion the ladder offers grows with `capacity` alone. At carrying capacity the
two are badly out of proportion in every bin.

## Lever chosen: a capacity-scaled throughput CEILING

`js/sim/engine.js`, new constant:

```
THROUGHPUT_CAP_PER_LITER = 0.014   // L/tick eaten per liter of bin capacity
ceiling = composter.capacity × composter.speed × species.speed × THROUGHPUT_CAP_PER_LITER
toEat   = min(linear, ceiling)
```

Read as *"only so many worms fit at the working face"*: the box bounds how many
worms can be at the food/bedding interface, while the species and the model still
set how fast each of those works — hence **both** speed traits stay on the
ceiling, exactly as on the linear term. The cap engages at
`0.014 / 0.0005 = 28` worms/L against `DENSITY = 50`, i.e. at **56 % of carrying
capacity**, so it is deliberately inert for small and mid colonies.

The `ration` hunger demand and the actual eating now call one shared helper
(`eatingThroughput`). This is load-bearing: an uncapped demand against capped
eating would read a throttled colony as permanently underfed however full the
bin, hold the laying brake down forever, and settle at a silently different
equilibrium — with every test still green, since nothing asserts on `ration`.

### Why not simply lower `CONSUMPTION_PER_WORM`

Because the defect is **scale-dependent and the lever is not**.
`CONSUMPTION_PER_WORM` is a flat per-worm rate: dividing it by the ~1.8× needed
to fix the late game divides the *early* game by the same factor. A starting
50-worm pack in tier2 already eats only 0.0200 L/tick — 50 ticks, ~2.1 game
days, to clear a single 1 L portion. Halving the rate stretches that to over
four game days, so the opening hours (where feeding is *supposed* to visibly
matter, and where the cap never binds) would read as dead while the runaway is
only linearly delayed. It would also rescale per-model humus output, which the
economy and the coins/day table in T21-3 are calibrated on. The ceiling is the
only lever that is selective in colony size: it leaves the linear branch — and
therefore "more worms process more food" — completely untouched.

## Measured: pacing (the upper wall)

Largest ladder portion (`portionOptions`, `js/ui/actions.js`) at full carrying
capacity, wall-clock at 5× (`MS_PER_TICK = 2500`, `js/ui/speed.js`):

| pairing | portion | uncapped | K = 0.020 | **K = 0.014** |
|---|---|---|---|---|
| electric / africana (fastest) | 7 L | 5.9 ticks — **2.9 s** | 7.4 t — 3.7 s | 10.5 t — **5.3 s** |
| tier2 / californiana (beginner default) | 10 L | 16.7 ticks — **8.3 s** | 20.8 t — 10.4 s | 29.8 t — **14.9 s** |

0.020 was an untested first pass and does **not** clear the complaint: 3.7 s is
still "gone in a couple of seconds".

## Measured: the hunger brake (the lower wall — this is the binding one)

The cap lowers the **denominator** of `ration`, so slower eating makes the same
standing queue read as a *fuller* larder and **reproduction speeds up**.
Good-care scenario (seed 42, tier2, californiana, wall 0.3, 65 days):

| K | end population | active / carryingCapacity | season score |
|---|---|---|---|
| uncapped (pre-T24) | 1463 | 0.96 | 1962.8 |
| 0.020 | 1508 | 0.98 | 1962.0 |
| 0.016 | 1739 | 1.12 | 1958.8 |
| **0.014 (chosen)** | **2034** | **1.31** | **1957.6** |
| 0.013 | 2253 | 1.44 | 1957.0 |
| 0.012 | 2307 | **1.53 — pinned** | 1956.4 |
| 0.010 | 2336 | 1.56 — pinned | 1955.4 |

At `active/cap ≥ 1.5` (`OVERPOP_STALL = 0.5`, `js/sim/worms.js`) **crowding
alone** stalls laying and the food brake goes inert — the colony stops being
food-limited and the population stops responding to the constant at all (0.012 →
0.010 moves it by 29 worms). That would undo the documented CP3 boom-bust fix
("the colony settles at a food-supported size"), so anything ≤ 0.013 is out.
**0.014 is the slowest value still on the food-limited side of that knee**, at
1.31 with real margin.

Score is essentially unmoved (1962.8 → 1957.6, −0.3 %) because the good-care
season is **supply**-limited, not throughput-limited: the cap changes the *pace*
of eating, not the total eaten.

## Measured: the `DECOMP_TICKS` wastage cost — CORRECTED

> ⚠️ **Supersedes the original T24 finding.** The first pass reported "throughput
> 209.2 L → 157.7 L, a 1.33× slowdown against the ~2× the 48-tick window allows"
> and concluded the cap stays inside the wastage budget. **That conclusion was
> unsupported.** The probe behind it could not have detected the effect it was
> written to bound. Re-measured below; `DECOMP_TICKS` is still left at 48 and
> `THROUGHPUT_CAP_PER_LITER` is still 0.014 — the numbers changed, the decision
> did not.

### Why the original probe was blind

It held the bin at **half capacity**. An entry can only age out when the 48-tick
eating budget fails to cover the standing stock:

```
48 × ceiling            <  fill × capacity
48 × K × c.speed × s.speed × capacity  <  fill × capacity
fill  >  48 × K × c.speed × s.speed          ← capacity cancels
```

The leak threshold is **independent of bin size**. At `K = 0.014` with
californiana:

| model | `48 × K × c.speed` | leaks above |
|---|---|---|
| tier2 (0.8) | 0.538 | 53.8 % fill |
| tier3 / buried (1.0) | 0.672 | 67.2 % fill |
| tier4 (1.2) | 0.806 | 80.6 % fill |
| eco (1.4) | 0.941 | 94.1 % fill |
| electric (1.7) | 1.142 | **never** — cannot waste at any fill |

Half fill (0.50) is below **every** entry in that column, so the original probe
was structurally incapable of producing a single dropped liter — at any K the
lower wall left admissible. Half fill only starts to leak below `K ≈ 0.0130`
(tier2), and `K ≤ 0.013` was already excluded by the crowding-stall knee. Second
flaw: it let the population **float** instead of pinning it at carrying capacity,
so the linear branch it compared against was only 1.33× above the ceiling; at
carrying capacity the true tier2 ratio is **1.79×**. Third: "the ~2× the 48-tick
window allows" is wrong in kind — the budget is not a slowdown ratio, it is the
fill inequality above.

### Corrected probe methodology

Any re-probe of this must:

1. run at **high fill** — top the bin back to **full** (and 75 %) every tick, not
   to half;
2. **pin the population at `carryingCapacity`** and `colonyAlive = true` every
   tick, so the linear branch is at its true maximum;
3. **harvest the tray and drain the tank every tick**, so neither overflow chain
   gates eating and confounds the measurement;
4. compare the live source against a copy with `return Math.min(linear, ceiling)`
   reverted to `return linear`;
5. account per tick: `eaten = Δhumus / composter.humusRate`,
   `dropped = standing_before − standing_after − eaten`.

30 game days, californiana, seed 42.

### Corrected measurements

Bin topped back to **full** every tick, 30 days, share of fed liters dropped
uneaten by the `DECOMP_TICKS` filter (no humus, no leachate credit):

| model | fed (L) | eaten (L) | **dropped, K = 0.014** | dropped, uncapped |
|---|---|---|---|---|
| electric | 362.2 | 342.7 | **0.0 L — 0.0 %** | 0.0 % |
| tier2 | 465.8 | 241.9 | **208.1 L — 44.7 %** | 3.8 % |
| tier3 | 704.6 | 453.6 | **221.4 L — 31.4 %** | 0.0 % |
| tier4 | 947.4 | 725.8 | **174.2 L — 18.4 %** | 0.0 % |
| buried | 1252.6 | 806.4 | **393.6 L — 31.4 %** | 0.0 % |
| eco | 1592.1 | 1411.2 | **88.8 L — 5.6 %** | 0.0 % |

At **75 %** fill: tier2 27.1 %, tier3 and buried 9.8 %, electric/tier4/eco 0 % —
each exactly as the threshold table predicts. At **50 %** fill: **0 % for every
model, capped and uncapped** — which is the blindness, reproduced.

Realistic play is untouched. The good-care season (the `tests/balance.test.js`
scenario — tops the bin toward a **quarter** full, well under every threshold),
capped vs uncapped:

| | fed | eaten | dropped | humus | wallet | score | end pop |
|---|---|---|---|---|---|---|---|
| K = 0.014 | 195.0 L | 183.8 L | 11.25 L (5.8 %) | 91.6 L | 1326 | 1957.6 | 2034 |
| uncapped | 195.0 L | 183.8 L | 11.25 L (5.8 %) | 91.9 L | 1329 | 1962.8 | 1463 |

Identical food accounting; humus and coins move by ~0.2 %. That scenario is
**supply**-limited, not throughput-limited.

### Verdict: coherent behaviour, under-communicated

This is **not a simulation defect** and no constant is being changed.

- Surplus food rotting in an overstuffed bin **is** the designed §2.8 overfeeding
  chain — feeding far past what the colony can process is supposed to cost you.
- Dropped liters are **not** silently free: they sit in the queue for their full
  48 ticks loading moisture, pH and toxicity through `queueDynamics`, so
  overfeeding still bites exactly as the spec describes.
- Coin income in supply-limited play is unaffected (table above) — humus output
  is throughput-capped either way.

What was actually wrong is two things, and only one of them is fixed here:

1. **The justification was asserted without evidence that could support it.**
   Fixed: the comment in `js/sim/engine.js` now carries the threshold formula,
   the high-fill numbers, and an explicit warning about the half-fill probe.
2. 🚩 **OPEN — no player feedback that fed waste is expiring uneaten.** A bin
   held near full quietly pays less per liter fed and nothing in the UI says so.
   The player sees food disappear from the queue and cannot tell whether the
   worms ate it (paid) or the 48-tick filter dropped it (unpaid). Deliberately
   **not implemented in this pass** — it is a UI/HUD change, not a balance one.
   Sketch for whoever picks it up: `tick()` would need to surface the dropped
   volume (it is discarded inside the `queue.filter` today), and the HUD or the
   internals panel would need a "rotted uneaten" readout with a pt-BR string in
   `js/strings.js`. Follow-up task, blocks nothing.

## §2.8 chain day-windows after the change — all unchanged

Re-measured against the current source; every chain fires on the same day it did
at the T21 lock-in, so no window needed moving:

| chain | scenario (seed / bin / wall) | death day | locked window |
|---|---|---|---|
| leachate saturation | 7 / tier2 / 0.2 | day 13 | 10 ≤ d ≤ 16 |
| humus rot | 7 / tier2 / 0.2 | day 16 | 12 ≤ d ≤ 22 |
| overfeeding heat | 7 / eco / 0.5 | day 3 | 2 ≤ d ≤ 8 |
| toxic food | 7 / tier2 / 0.2 | day 5 | 3 ≤ d ≤ 10 |
| drying | 7 / tier2 / 0.5 | day 11 | 8 ≤ d ≤ 16 |

The good-care moisture/temperature envelope is bit-identical too (max moisture
0.710, min 0.500, max temperature 31.76 °C), so only the population bound moved.

## Summary of changes

| file | change |
|---|---|
| `js/sim/engine.js` | new `THROUGHPUT_CAP_PER_LITER = 0.014` + `eatingThroughput` helper shared by the `ration` demand and the actual eating (+ rationale comments) |
| `js/ui/actions.js` | portion ladder widened so the top rung stays servable against the capped rate |
| `tests/balance.test.js` | good-care `endPop` `(1150, 1800)` → `(1750, 2250)`; **new** assertion `active/carryingCapacity < 1.5` (the property that actually bounds the constant) |
| `tests/production.test.js` | entries re-sized under the ceiling; new assertion that 5000 vs 1000 adults eat identically once capped |
| `tests/overflow.test.js` | leachate seed changed to 4 × 15 L staggered — one entry can never out-produce the tank before `DECOMP_TICKS` drops it |
| `docs/game-reference.md` | §7 `ration` + §8 throughput/ceiling/gating/`DECOMP_TICKS` transcribed |

**A real regression fixed on the way, not a bound:** the first-pass ceiling omitted
`species.speed`, which made every species eat identically once the cap bound and
silently erased africana's defining trait for any mature colony. Locked by the
species-ordering test in `tests/production.test.js`.
