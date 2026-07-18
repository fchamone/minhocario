# CP6 — DOM-only playtest (complete game, minus 3D)

> Gate for Phase 2. Source criteria: spec §1 "Acceptance criteria" + §6 "Manual
> playtest checklist", excluding everything 3D (Phase 3: T16–T20).
> Tuning notes collected here feed **T21** (second balance pass).

## Automated verification (done — 211 tests green)

| Check | Result |
|---|---|
| `node --test tests/*.test.js` | 211 pass, 0 fail |
| `Math.random` inside `js/sim/` | clean (only a comment mentioning it) |
| DOM/browser globals inside `js/sim/` | clean |
| Three.js imports inside `js/sim/` | clean |
| Hardcoded user-facing literals in `js/ui/`, `js/main.js` | clean — all text via `t()` |
| Locale catalog key parity (pt-BR / en / es) | green |
| `data-string` keys in `index.html` resolve in all 3 locales | green |
| Food entries expose `name` only (no suitability signal) | green |
| Ranking record matches spec §2.1 five-field shape | fixed + locked by test |

> Node on this machine needs `node --test tests/*.test.js` (the bare `tests/`
> directory form fails) — see the memory note.

## Manual checklist — tick during the playthrough

### Core loop (spec §1 acceptance criteria)
- [ ] Runs from the static server with no build step; no console errors
- [ ] No non-same-origin network requests (DevTools → Network)
- [ ] Full loop: buy → setup → simulate → feed → drain → harvest → sell → upgrade → score rises
- [ ] State survives closing and reopening the browser (resumes at the saved hour, no catch-up)

### Home
- [ ] First visit generates a nickname; reroll changes it; reload keeps it
- [ ] Ranking lists the live run while a farm is running
- [ ] Restart freezes the finished run and the new run ranks separately
- [ ] Top-10 ordering is by score descending

### Shop / setup
- [ ] Unaffordable models are disabled with a localized reason
- [ ] Starting wallet buys the cheapest composter and still affords 50 worms
- [ ] Mid-farm: prices show net-of-trade-in; the model in use is flagged and unbuyable
- [ ] Upgrade carries population, food queue, bedding, and colony age; old contents auto-sold

### Game screen
- [ ] HUD tracks score / money / day / time / status
- [ ] Speeds 0.25× / 0.5× / 1× / 5× / 20× change the tick rate only
- [ ] **Pause** stops the clock; "PAUSADO" shows; resuming does not burst-simulate
- [ ] Hiding the tab freezes the clock
- [ ] X-ray panel names the composter model and tracks an upgrade
- [ ] Gauges turn red when a variable leaves its comfort band
- [ ] Add waste → food list carries **no** suitability hint (ordering, grouping, labels)
- [ ] Add sawdust lowers moisture; drain/harvest report volume, coins, points
- [ ] Wall-position slider moves the composter and shifts temperature at midday
- [ ] Colony death: banner appears, clock stops, repopulate revives and resumes time
- [ ] Restart asks for confirmation first

### Failure chains (§2.8) — all reachable by neglect
- [ ] Only unsuitable food → toxicity → colony dies
- [ ] Never harvest → tray full → processing halts → queue rots → toxicity → dies
- [ ] Never drain → tank full → bedding re-saturates → dies
- [ ] Overfeed → bin saturates → dies *(see tuning note T21-1 — mechanism differs from spec)*

### i18n
- [ ] `setLang('en')` / `setLang('es')` from the console swap all chrome
- [ ] Default render is pt-BR; nickname stays pt-BR-flavored in every language

---

## Tuning notes for T21

Measured by simulating the pure sim engine headlessly (seeded, deterministic).
Wall-clock figures assume 20× (one game day ≈ 3 s).

### Chain timings — all four terminate by pure neglect

| Chain | Milestones (game day) | Death | At 20× |
|---|---|---|---|
| Only unsuitable food (meat) | toxicity > 0.1 on d4 | d9 | ~27 s |
| Never harvest humus | tray full d20, toxicity d25 | d34 | ~102 s |
| Never drain leachate | tank full d12 | d21 | ~63 s |
| Overfeed (max fresh mass) | toxicity d3, tank full d4 | d4 | ~12 s |
| Total neglect (feed once, walk away) | dries below 0.4 on d16 | d26 | ~78 s |

All comfortably reachable in one session at 20×. At 1× the slowest chain
(never-harvest) takes ~34 real minutes — acceptable, since 20× is the
management speed by design.

### T21-1 — Overfeeding kills by drowning, not by heat *(highest-value finding)*

Spec §2.8 says: *"Overfeeding: large fresh mass → fermentation heat →
temperature spike → mortality (worse in the sun spot / poorly insulated
models)."* The sim does not currently behave that way.

Isolating the mechanism (overfeeding with a zero-toxicity food) shows moisture
pinning at **1.000 by day 3** while temperature oscillates **15.8–20.8 °C**,
comfortably *inside* the 10–30 °C comfort band. The colony drowns:

```
day  temp  moist   tox   pop
  2  20.8  0.833  0.000    66
  3  15.8  1.000  0.000    33
  4  20.8  1.000  0.000    11
  ...
  9  15.8  1.000  0.000     0   <-- COLONY DEAD
```

Peak *intra-day* temperature under maximum overfeeding reaches only ~35–36 °C,
short of the ~38 °C where mortality begins (band max 30 + `TEMP_STALL` 4 ×
`LETHAL_RATIO` 2). So fermentation heat stalls reproduction but never kills.

Two consequences worth fixing at T21:

1. **The sun spot barely matters here** — 34.9 °C shaded vs 36.0 °C in full sun
   is a ~1.1 °C spread. The placement mechanic is a headline feature (§2.6) but
   contributes almost nothing to this chain.
2. **The electric composter's premium does not read.** It correctly suppresses
   the heat (peak 23.1 °C vs 36.0 °C), yet the colony still dies — *slightly
   faster*, on day 7 — because the killer is water, not heat. A player paying
   350 coins for thermal regulation sees no benefit in the scenario it is
   supposed to protect against.

Candidate levers (all in `js/sim/`): raise `fermentationHeat` output per liter
of fresh mass, widen `solarGain`'s contribution, or lower the lethal temperature
threshold. Any of these should be checked against the good-care scenario so a
well-tended sunny farm does not start cooking.

### T21-2 — Economy pacing (informational, looks healthy)

A well-tended tier2 farm (fed daily, drained and harvested when ready):

| Milestone | Game day |
|---|---|
| Affords tier3 upgrade (net 130) | d10 |
| Affords tier4 / buried (net 230–250) | d19–21 |
| Affords eco (net 400) | d35 |

Score and population climb steadily to d60+ with no boom-bust. No change
proposed — recorded as the baseline T21 tightens against.
