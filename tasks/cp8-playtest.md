# CP7 / CP8 — full-feature playtest (3D render layer + spec §6)

> Gate for Phase 3. Source criteria: spec §1 "Acceptance criteria" + spec §6
> "Manual playtest checklist" — this time **including everything 3D** (T16–T20:
> meshes, day/night, sun patch, drag-move, 3D x-ray). CP7 focuses on the visual
> readability of the placement mechanic; CP8 is the whole spec §6 checklist on
> desktop plus one mobile browser.
>
> The automated portion below was verified by this pass. The manual boxes are
> left **unchecked** for the human playtester.

## Sign-off

**CP7 and CP8 approved by the maintainer on 2026-07-20.** The manual checklist
below was walked in that session; the boxes are left as written rather than
back-ticked, since the attestation — not a per-line re-verification — is what
closes the gate. The automated table was re-run against HEAD (`15b2f34`) on the
same date and every row still holds.

## Automated verification (re-run 2026-07-20 at `15b2f34` — 282 tests green)

| Check | Result |
|---|---|
| `node --test tests/*.test.js` (19 files) | 282 pass, 0 fail |
| `Math.random` inside `js/sim/` | clean (only a comment in `rng.js` naming the ban) |
| DOM / browser globals (`document`, `window`, `localStorage`, `navigator`) in `js/sim/` | clean — none |
| Three.js imports inside `js/sim/` | clean — none |
| `js/render/` mutates sim state | clean — render only reads `state.*` (`===` comparisons), no assignment / array mutation |
| `js/render/` imports from `js/sim/` | **all pure** — `solarGain` (scene), `getComposter` (scene→composter3d, xray), `decompositionFraction` (xray). See "Audit notes" — wider than "solarGain only" but every import is a pure function, no state mutation. |
| User-facing literals outside `js/strings.js` + `js/i18n/` | clean — `js/ui/*`, `js/main.js`, `js/render/*` route all text through `t()`; render is canvas-only (no DOM text writes) |
| Runtime external URLs (CDN / network) | clean — the only URL in shipped files is the version/source header comment in `vendor/three.module.min.js` |
| Food list suitability signal — names, all 3 locales | clean — each food exposes `{name}` only (labeling guard test); names are neutral in pt-BR / en / es |
| Food list suitability signal — ordering | resolved — catalog reshuffled into a non-uniform mix (no parity pattern); guarded by `tests/foods.test.js` "not a strict alternation" |
| Locale catalog key parity (pt-BR / en / es) | green — parity + no-empty-values tests |
| `data-string` keys in `index.html` resolve in all 3 locales | green |
| Ranking record matches spec §2.1 five-field shape | green (locked by test) |

> Node on this machine needs `node --test tests/*.test.js` (the bare `tests/`
> directory form fails on this Node version) — see the memory note.

## Manual checklist — tick during the playthrough

### Core loop (spec §1 acceptance criteria)
- [ ] Runs from the static server (`npx serve .`) with no build step; no console errors
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

### Game screen (HUD + DOM controls)
- [ ] HUD tracks score / money / day / time / status
- [ ] Speeds 0.25× / 0.5× / 1× / 5× / 20× change the tick rate only
- [ ] **Pause** stops the clock; "PAUSADO" shows; resuming does not burst-simulate
- [ ] Hiding the tab freezes the clock
- [ ] DOM x-ray panel names the composter model and tracks an upgrade
- [ ] Gauges turn red when a variable leaves its comfort band
- [ ] Add waste → food list carries **no** suitability hint (ordering, grouping, labels)
- [ ] Add sawdust lowers moisture; drain/harvest report volume, coins, points
- [ ] Wall-position slider moves the composter and shifts temperature at midday
- [ ] Colony death: banner appears, clock stops, repopulate revives and resumes time
- [ ] Restart asks for confirmation first

### 3D scene (spec §6 — Phase 3, T16–T20)
- [ ] All **6 composter meshes are visually distinct** — cycle every model via the shop and confirm silhouettes differ (tier counts visible; buried sits in the ground; electric distinct)
- [ ] Mid-farm upgrade swaps the mesh live (no reload)
- [ ] **[CP7 human review]** Day → dusk → night → dawn is perceivable at 1× within one real minute; scene lighting tracks the clock
- [ ] **[CP7 human review]** The **sun patch** sweeps the wall during the day, vanishes at night, and makes the placement mechanic **readable** — a bin in the sunny centre vs a shaded end shows the matching temperature difference in the x-ray panel
- [ ] **Drag-move**: dragging the composter along the wall moves it, and the actions-panel slider follows (and vice-versa — slider moves the mesh)
- [ ] Drag + slider stay in sync; releasing the pointer outside the canvas does not wedge drag state; `wallPosition` persists after reload
- [ ] **Touch**: drag works under DevTools touch emulation (and on the real mobile browser below)
- [ ] **3D x-ray during ticking**: toggling the 3D x-ray reveals internals (humus/leachate fill, worm-stage hints, food-queue chunks) and **never pauses the sim** — the day counter keeps advancing; fill volumes track drain/harvest live

### Failure chains (§2.8) — all reachable by neglect
- [ ] Only unsuitable food → toxicity → colony dies
- [ ] Never harvest → tray full → processing halts → queue rots → toxicity → dies
- [ ] Never drain → tank full → bedding re-saturates → dies
- [ ] Overfeed → fermentation heat spike in the sun spot → dies *(placement-dependent: shaded bins drown instead — see `tasks/cp6-playtest.md` retune note)*

### i18n
- [ ] Home language selector switches all visible home chrome (Português / English / Español) and persists across reload in its own `minhocario.lang` key
- [ ] `setLang('en')` / `setLang('es')` from the console swap all chrome
- [ ] Default render is pt-BR; nickname stays pt-BR-flavored in every language
- [ ] Language is fixed once a farm is running (home-only selector)

### Cross-platform (spec §1 + §6)
- [ ] **Offline reload**: after first load, go offline (DevTools → Network → Offline) and reload — the game still loads and runs (Three.js vendored, no external calls)
- [ ] **One mobile browser**: the full loop plays on at least one real mobile browser — scene renders, actions work, drag-move works by touch

---

## Audit notes (for the human / orchestrator — not fixed in this pass)

These are precise observations from the automated boundary audit. Neither is a
hard-boundary violation; both are design calls left to a human rather than
refactored blind during an audit.

1. **`js/render/` imports three pure sim functions, not "solarGain only".**
   `scene.js` imports `solarGain` (`sim/temperature.js`); `composter3d.js` and
   `xray.js` import `getComposter` (`sim/composters.js`); `xray.js` also imports
   `decompositionFraction` (`sim/foods.js`). All three are **pure** (catalog
   lookups / a pure ramp function) with no state mutation, so the hard boundary
   ("`js/sim/` pure; render reads state, never mutates") holds. The stricter
   "render imports only `solarGain`" expectation does not — the mesh builder
   legitimately needs catalog dimensions and the 3D x-ray needs the decomposition
   fraction. Consistent with the plan's own "pure fn — allowed" note for
   `solarGain`. No change recommended; flagged for awareness.

2. **The `FOODS` catalog order strictly alternated suitable/harmful.** RESOLVED.
   Previously indices 0,2,4,… were benign (`toxicity ≈ 0`) and 1,3,5,… harmful,
   so a player who had discovered a few foods could infer a position-parity
   pattern. Names and grouping already carried **zero** signal (verified in all
   three locales), but a *perfect* alternation is itself a latent ordering
   regularity. The catalog has been reshuffled into a non-uniform mix — adjacent
   runs of two suitable / two harmful foods break the parity pattern, so index no
   longer predicts suitability. This is a data-only change (all 14 foods keep
   their exact effect numbers; only their positions move), so the balance,
   parity, and labeling-guard tests are unaffected. A new guard test in
   `tests/foods.test.js` ("not a strict alternation") locks it against regressing
   to a regular pattern. Closes the manual box "food list carries no suitability
   hint (ordering, grouping, labels)".
