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
