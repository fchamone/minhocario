# Implementation Plan: Minhocário v1 (C-0001 Worm Farm Simulator)

> Approved via `/devy:plan` on 2026-07-17. Source spec: `.harn/devy/changes/C-0001-worm-farm-simulator/spec.md`.
> Progress tracking: `tasks/todo.md`.
> **Amended 2026-07-17** with Change C-0002 (multi-language i18n) — see the "Change C-0002" section below and `.harn/devy/changes/C-0002-multilanguage-selector/spec.md`.

## Context

The spec is refined and approved; the repository is **greenfield** (no `index.html`, no `js/`, no `tests/`, no vendored Three.js). This plan breaks the full v1 build into 23 small/medium vertically-sliced tasks across 4 phases with 9 checkpoints, so the game can be built incrementally with each task leaving a working, tested state.

## Architecture decisions

- **DOM-first playable loop, 3D later** — the spec mandates a slider fallback for composter movement, so the entire game loop is playable and verifiable with zero 3D. The sim (balance, failure chains) is the real product risk and iterates fastest headlessly under `node --test`. One exception: **T16 (vendor Three.js + minimal scene) runs as an early parallel spike** to retire the vendoring/unbundled-import/canvas-layout unknowns cheaply.
- **Sim engine built one subsystem per task, each landing with its test suite** (T2–T8). All touch `js/sim/engine.js`, so they serialize — they are the critical path anyway.
- **`solarGain(wallPosition, hourOfDay)` lives in `js/sim/temperature.js` and is the single source of truth**: the sim uses it for heat; `js/render/scene.js` samples the same function to draw the sun patch. Sim/visual agreement is structural.
- **Executable balance spec (T8)**: scenario tests assert "good care survives 60+ days" AND "each §2.8 failure chain terminates within bounded days by pure neglect". Constants are tuned until green, then locked by tests. A second playfeel pass (T21) tightens them after the game is playable.
- **Storage lands only after T7 freezes the state shape** (avoids migration churn); `storage.js` takes an injectable backend so tests use an in-memory stub, no browser mocking.
- **Zero Three.js addons** (addons import the bare `'three'` specifier, which needs an import map when unbundled). Fixed camera, core `Raycaster` only.
- **DOM x-ray/internals panel (T14) ships before the 3D x-ray (T20)** — it doubles as the tuning/debugging instrument for T8/T21 and remains as the numeric gauge layer.

## Dependency graph (module level)

```
index.html / css/style.css
    │
js/main.js  (sole orchestrator: routing, tick timer, autosave, action dispatch)
    ├─▶ js/strings.js          (pt-BR; imported by all js/ui/*)
    ├─▶ js/storage.js          (versioned {v:1} save, migrations, injectable backend)
    ├─▶ js/ui/{home,shop,setup,hud,actions,speed}.js   (read sim state + catalogs)
    ├─▶ js/render/{scene,composter3d,xray}.js ─▶ vendor/three.module.min.js
    │        └─ scene.js also imports sim/temperature.solarGain (pure fn — allowed)
    └─▶ js/sim/  (PURE, Node-testable)
          engine.js ─▶ rng, worms, foods, composters, temperature, scoring
          temperature.js ─▶ composters.js      worms/foods/composters/scoring/rng = leaves
tests/*.test.js ─▶ js/sim/*, js/storage.js only
```

Sim-internal build order forced by data flow: clock/RNG → temperature+composters → food queue → population → production/overflow → scoring/economy → balance.

---

## Phase 1 — Skeleton and pure sim core

### T1. Static shell: index.html, screen routing, strings, base CSS — S
Single-page skeleton: four screen sections (home/shop/setup/game) toggled by a tiny router in `main.js`; `strings.js` seeded; `style.css` establishes the game-screen grid (HUD top / side actions / bottom speed bar / canvas area) so later tasks don't rework layout.
- **AC:** home renders via `npx serve .`; dev nav switches all 4 screens, no console errors; zero user-facing literals in JS outside `strings.js`; no non-same-origin requests.
- **Verify:** `npx serve .` → click through screens, watch console + network tab.
- **Deps:** none. **Files:** `index.html`, `css/style.css`, `js/strings.js`, `js/main.js`.

### T2. Seeded RNG + farm state shape + engine clock — S
`rng.js` (e.g. mulberry32) with serializable internal state stored inside farm state (save/load preserves determinism). `engine.js`: full `FarmState` JSDoc typedef (fields stubbed at defaults), `createInitialFarmState(opts)`, `tick(state, rng)` advancing hour/day only.
- **AC:** same seed ⇒ identical sequence, different seeds diverge; 24 ticks = 1 day, hour wraps 23→0; `JSON.parse(JSON.stringify(state))` round-trips deep-equal.
- **Verify:** `node --test tests/rng.test.js tests/engine.test.js`
- **Deps:** none (parallel with T1). **Files:** `js/sim/rng.js`, `js/sim/engine.js`, `tests/rng.test.js`, `tests/engine.test.js`.

### T3. Temperature model + solarGain + composter catalog — M
`composters.js`: 6 models (capacity, speed, production rates, insulation, price). `temperature.js`: ambient day/night cycle, pure `solarGain(wallPosition, hourOfDay)`, fermentation heat as a function of fresh-food mass (parameter now, wired in T4), per-tick bin temperature blending via insulation trait. Wire into `tick`.
- **AC:** `solarGain` = 0 at night, peaks in sunny wall region at midday, 0 at shaded end (point assertions); electric holds near-ideal while tray swings with ambient and buried swings less than tray; injected fresh mass spikes temperature, decays after.
- **Verify:** `node --test tests/temperature.test.js`
- **Deps:** T2. **Files:** `js/sim/temperature.js`, `js/sim/composters.js`, `js/sim/engine.js`, `tests/temperature.test.js`.

### T4. Food queue + foods catalog + bin environment dynamics — M
`foods.js`: ~14 items with per-liter moisture/pH/toxicity/heat numbers — **no suitability flag anywhere in the data shape**. Engine actions `addFood`/`addSawdust`; queue entries `{foodId, liters, addedAtTick}`, min 0.25 L, capacity-bounded; gradual effect release over ticks; sawdust lowers moisture; pH drifts to neutral; toxicity decays very slowly; fermentation heat wired to real fresh mass.
- **AC:** over-capacity add rejected/clamped; effects release gradually (multi-tick moisture trace); citrus acidifies then drifts back while meat toxicity persists much longer; sawdust reduces moisture deterministically.
- **Verify:** `node --test tests/foods.test.js`
- **Deps:** T3. **Files:** `js/sim/foods.js`, `js/sim/engine.js`, `tests/foods.test.js`.

### T5. Population model + species catalog + mortality — M
`worms.js`: 3 species (§2.9 stats) + 3-stage cohort pipeline (cocoons→juveniles→adults, condition-scaled laying, hatch delay, maturation) + mortality per env variable outside comfort band + overpopulation. Reproduction slows before mortality rises (§2.5). RNG used for stochastic rounding.
- **AC:** ideal conditions grow all three stages; bad conditions stall laying to zero *before* mortality dominates; recovery lags by the pipeline delay after conditions are fixed; each trigger (toxicity/dryness/overheat/overpopulation) independently kills; Gigante-Africana dies in cold nights where Californiana survives.
- **Verify:** `node --test tests/population.test.js tests/mortality.test.js`
- **Deps:** T4. **Files:** `js/sim/worms.js`, `js/sim/engine.js`, `tests/population.test.js`, `tests/mortality.test.js`.

### T6. Production, consumption, overflow chains + drain/harvest — M
Oldest-first consumption at species × composter speed → humus; leachate accrual; tray/tank capacities. Chains: tank full → bedding re-saturation → moisture spike; tray full → processing halts → queue rots → toxicity climbs. State-level `drainLeachate` (instant, full) and `harvestHumus` (anytime).
- **AC:** oldest entry consumed first, removed when depleted; per-model humus output ordering matches catalog; never-drain spikes moisture only *after* tank capacity; never-harvest halts production then climbs toxicity; drain/harvest reset levels and re-enable processing.
- **Verify:** `node --test tests/production.test.js tests/overflow.test.js`
- **Deps:** T5. **Files:** `js/sim/engine.js`, `tests/production.test.js`, `tests/overflow.test.js`.

### T7. Scoring + economy + colony death/repopulate + migration — M
`scoring.js`: `points += litersHarvested × 10 × (1 + colonyAgeDays/30)`, monotonic. Engine: wallet, auto-sell on harvest/drain, worm packs (50/100/200), colony-dead state (production stops; `repopulateColony` resets age, keeps totals/banked score), `migrateToComposter` (carries worms/queue/bedding/age; auto-sells old humus+leachate; 50% trade-in; one composter at a time).
- **AC:** formula exact on known inputs, multiplier resets on colony death, score never decreases; migration preserves age/population and credits trade-in + auto-sale, purchase rejected when wallet short; starting wallet affords cheapest composter + 50 worms + bedding with slack (asserted against catalogs).
- **Verify:** `node --test tests/scoring.test.js tests/economy.test.js`
- **Deps:** T6. **Files:** `js/sim/scoring.js`, `js/sim/engine.js`, `tests/scoring.test.js`, `tests/economy.test.js`.

### T8. Balance harness + first tuning pass — M
`tests/balance.test.js`: scripted multi-day scenarios through `tick` + actions. Good-care scenario survives ≥60 days with net growth (beginner species); each §2.8 chain reaches its terminal state within bounded days via pure neglect; stall-recovery lag inside a target window. Tune sim constants until green.
- **AC:** all four failure chains terminate within bounds, deterministically per seed; good-care scenario passes; **entire suite** still green after tuning.
- **Verify:** `node --test tests/`
- **Deps:** T7. **Files:** `tests/balance.test.js` + constant edits in `js/sim/{worms,foods,temperature,engine}.js`.

> **CP1 (after T3):** suites green; shell loads. Human review: `FarmState` typedef + composter catalog numbers.
> **CP2 (after T6):** all sim suites green. Human review: env dynamics + queue semantics.
> **CP3 (after T8):** full suite green. **Human review of balance numbers — most important review of the project.**

## Phase 2 — Persistence and DOM-playable game

### T9. Storage: versioned save, migrations, round-trip — S
`storage.js` with injectable backend (browser `localStorage` in app, in-memory stub in tests). Schema `{v:1, profile:{nickname,wallet}, farm:{...}, ranking:[...]}`. Migration registry keyed by version; prove mechanism with synthetic v0→v1 test. Corrupt/unknown saves are never silently discarded (pt-BR prompt string added now, wired in T10).
- **AC:** save→load round-trips deep-equal including RNG state; stubbed v0 payload migrates to valid v1; unknown future version refuses to overwrite.
- **Verify:** `node --test tests/storage.test.js`
- **Deps:** T7. **Files:** `js/storage.js`, `tests/storage.test.js`.

### T10. Home screen: nickname, ranking, Play/Continue — S/M
`home.js`: random nickname (adjective+animal+number from `strings.js` lists), reroll, persist on profile; top-10 ranking table; Play (new) vs Continue (save exists).
- **AC:** first visit generates nickname, reroll changes it, browser reload keeps it; ranking renders top 10 sorted by score with pt-BR empty state.
- **Verify:** `npx serve .` → reroll, reload; inspect localStorage (single `{v:1,...}` key).
- **Deps:** T1, T9. **Files:** `js/ui/home.js`, `js/strings.js`, `js/main.js`, `index.html`.

### T11. Shop screen (first purchase) — S
`shop.js`: 6 composter cards from `sim/composters.js` (copy via `strings.js`), wallet display, unaffordable models disabled with pt-BR reason, purchase → setup screen. (Mid-farm trade-in UI is T15.)
- **AC:** starting wallet buys the cheapest model and still affords worms+bedding (UI mirror of T7); unaffordable models disabled.
- **Verify:** `npx serve .` → Play → shop → buy → lands on setup.
- **Deps:** T7, T10. **Files:** `js/ui/shop.js`, `js/strings.js`, `js/main.js`, `index.html`.

### T12. Setup screen → farm created and saved — M
`setup.js`: species choice with stats, guided bedding mix pre-filled but editable (ratio → initial moisture/pH via a pure sim helper), first waste from the unlabeled list, wall-position slider, confirm → `createInitialFarmState` → save → game screen.
- **AC:** default mix yields initial moisture/pH inside comfort bands and deviating shifts them (engine test for the helper); vertical slice complete — home→shop→setup→game with day-1 state persisted across reload.
- **Verify:** `npx serve .` full flow; reload after setup. `node --test tests/engine.test.js`.
- **Deps:** T11. **Files:** `js/ui/setup.js`, `js/strings.js`, `js/main.js`, `index.html`.

### T13. Game loop wiring: HUD, speed control, tick timer, autosave — M
`main.js`: accumulator-based tick timer (2.5 s/tick at 1×; 0.25×/0.5×/1×/5×/20× scale the timer only), pause on `visibilitychange`, continuous-clock fraction exposed for the render layer. `hud.js`: score/money/day/time/status. `speed.js`: bottom bar. Autosave on every action, day boundary, and `visibilitychange`.
- **AC:** at 1× a game day ≈ 60 s, at 20× ≈ 3 s, hiding the tab freezes the clock; killing the browser mid-day resumes at the exact saved hour (no catch-up); HUD status strings track sim state via `strings.js`.
- **Verify:** `npx serve .` manual timing; localStorage inspection after each autosave trigger.
- **Deps:** T12, T9. **Files:** `js/ui/hud.js`, `js/ui/speed.js`, `js/main.js`, `js/strings.js`, `index.html`.

### T14. Actions panel + DOM internals (x-ray data) panel — M
`actions.js`: add waste (unlabeled list, ≥0.25 L), add sawdust, worm packs, drain, harvest (shows score gain), wall-position slider, x-ray toggle revealing a live DOM internals panel: population by stage, moisture/pH/toxicity/temperature gauges, recent queue, humus/leachate fill.
- **AC:** every §2.8 chain manually reachable in-browser at 20× and narrated by panel + HUD status; food list carries **zero** suitability labels/grouping/ordering hints (explicit review item); slider changes `wallPosition` and shifts temperature at midday in the sunny region.
- **Verify:** `npx serve .` scripted playthrough of each chain; `node --test tests/` green.
- **Deps:** T13. **Files:** `js/ui/actions.js`, `js/strings.js`, `js/main.js`, `index.html`, `css/style.css`.

### T15. Full lifecycle: colony death/repopulate, mid-farm upgrade, restart, live ranking — M
Colony-dead UI (production-stopped banner, buy-worms CTA, age reset on repopulate); shop reachable mid-farm with trade-in price + migration summary; restart with pt-BR confirmation (freezes ranking entry, starts a new one); live high-water ranking updates on home.
- **AC:** kill colony → repopulate: same farm, totals + banked score kept, next harvest multiplier restarts at 1.0; upgrade credits 50% trade-in + auto-sale and carries population/queue/age; restart freezes old ranking row, top-10 order correct.
- **Verify:** `npx serve .` lifecycle run at 20×; `node --test tests/` green.
- **Deps:** T14. **Files:** `js/ui/shop.js`, `js/ui/home.js`, `js/ui/hud.js`, `js/main.js`, `js/strings.js`.

> **CP4 (after T10):** save round-trip proven + home persists. Human review: **save schema** (freezes at v1 ship).
> **CP5 (after T13):** first end-to-end human playtest (shop→setup→running farm→persistence).
> **CP6 (after T15):** complete game playable DOM-only. Playtest vs spec acceptance criteria minus 3D; collect tuning notes for T21.

## Phase 3 — Three.js render layer

### T16. Vendor Three.js + minimal scene (early parallel spike) — S/M
One-time dev download of the pinned Three.js module build into `vendor/three.module.min.js` (comment header: version + source URL). `scene.js`: renderer, fixed camera framing garage wall + ground, basic lights, canvas mounted in the game screen, `renderState(state, continuousHour)` API, resize handling. No addons.
- **AC:** wall + floor render at 60 fps, zero console errors, Three imported only via relative path; page fully works offline after first load (DevTools offline test).
- **Verify:** `npx serve .` → game screen shows scene; offline reload test.
- **Deps:** T1 (start any time after; integrates fully at T13). **Files:** `vendor/three.module.min.js`, `js/render/scene.js`, `js/main.js`, `index.html`, `css/style.css`.

### T17. Procedural composter meshes (all 6 models) — M
`composter3d.js`: low-poly builders from primitives keyed by `composterId`, flat colors, dimensions derived from catalog capacity; positioned at `state.wallPosition`; mesh swaps on upgrade.
- **AC:** all 6 models visually distinct (tier counts visible; buried sits in ground; electric distinct silhouette); mid-farm upgrade swaps the mesh live.
- **Verify:** `npx serve .` → cycle models via shop (or temporary debug key).
- **Deps:** T16, T3. **Files:** `js/render/composter3d.js`, `js/render/scene.js`.

### T18. Day/night lighting + sun patch driven by solarGain — M
`scene.js` consumes the interpolated `continuousHour`: sky/light color + sun direction across the day; the wall sun patch renders by sampling `solarGain(x, hour)` across positions (gradient overlay updated per frame) — sim and visuals cannot drift.
- **AC:** at 1×, day→dusk→night→dawn perceivable within one real minute; patch sweeps the sunny region and vanishes at night; composter inside vs outside the patch at midday shows the matching temperature difference in the internals panel.
- **Verify:** `npx serve .` at 1× and 5×; cross-check panel temperature; `node --test tests/temperature.test.js` unchanged.
- **Deps:** T16, T3, T13. **Files:** `js/render/scene.js`, `js/main.js`.

### T19. Drag-move via raycast (+ slider sync) — M
Pointer events on canvas: raycast composter mesh to grab, wall-aligned invisible plane to drag, clamp to `[0,1]`, dispatch `setWallPosition` via `main.js`; slider ↔ 3D bidirectional sync; cursor feedback; mouse + touch.
- **AC:** drag moves composter smoothly and slider follows (and vice versa); works under DevTools touch emulation; releasing outside the canvas doesn't wedge drag state; `wallPosition` persists after reload.
- **Verify:** `npx serve .` desktop + device emulation.
- **Deps:** T17, T14. **Files:** `js/render/scene.js`, `js/main.js`, `js/ui/actions.js`.

### T20. 3D x-ray view — M
`xray.js`: toggle swaps composter materials to transparent revealing procedural internals — humus/leachate fill volumes, instanced worm-population hints by stage, food queue chunks. Live while ticking; the DOM panel (T14) stays as the numeric layer.
- **AC:** toggling never pauses/perturbs the sim (day counter keeps advancing); fill volumes track drain/harvest in real time.
- **Verify:** `npx serve .` toggle at 5×, drain/harvest and watch volumes.
- **Deps:** T17, T14. **Files:** `js/render/xray.js`, `js/render/scene.js`, `js/render/composter3d.js`, `js/ui/actions.js`, `js/strings.js`.

> **CP7 (after T18):** 3D + meshes + day/night + sun patch. Human review: visual readability of placement mechanic (spec acceptance criterion).
> **CP8 (after T20):** full feature set. Manual playtest of spec §6 checklist on desktop.

## Phase 4 — Tuning, polish, release

### T21. Second balance pass (playfeel) + constant lock-in — M
Play at all speeds; adjust pacing constants (decomposition, heat spikes, cocoon timing, prices) so 1× feels alive and 20× is the management speed; encode final numbers into `tests/balance.test.js` bounds.
- **AC:** all §2.8 chains reachable in a real session at 20× within tolerable wall-clock time; suite green with tightened bounds.
- **Verify:** `node --test tests/` + timed manual sessions.
- **Deps:** T15, T18 (ideally T20). **Files:** sim constants + `tests/balance.test.js`.

### T21b. Behavior/constants/rules reference doc — S/M
Write `docs/game-reference.md`: a single reference describing what the shipped version actually does — the tick/clock model and speed multipliers; the full catalogs (6 composters, 3 species, ~14 foods) with their numbers; the environment dynamics (temperature/`solarGain`, moisture, pH, toxicity) and their comfort bands; the population pipeline stages and every mortality trigger; production/overflow rules and the §2.8 failure chains; scoring formula and economy rules (prices, auto-sell, 50% trade-in, repopulate); the save schema `{v:1,...}` and the language key. Numbers are transcribed from `js/sim/*` **after T21 locks them** — the doc cites the owning module/constant for each value so it can be re-verified, and states the version/commit it describes.
- **AC:** every constant in the doc matches its source module (spot-check audit); all six composters, three species and every food are covered; each §2.8 chain is documented with its trigger and terminal state; doc is written **after** T21 tuning so no stale numbers ship; **no food suitability verdicts** — the doc describes the mechanics (moisture/pH/toxicity per item) without ranking foods as good/bad, so it never becomes a spoiler table.
- **Verify:** manual cross-read of `docs/game-reference.md` against `js/sim/{composters,worms,foods,temperature,engine,scoring}.js` and `js/storage.js`; `node --test tests/` still green (doc-only change).
- **Deps:** T21. **Files:** `docs/game-reference.md` (new).

### T22. UX/visual polish + audits — S/M
CSS polish (gauges, dialogs, transitions), consistent status messaging, edge states (dead colony, full tanks). Audits: grep for UI literals outside `strings.js`; verify food list has zero suitability signal; grep `Math.random` under `js/sim/` (must be absent).
- **AC:** both grep audits clean; a first-time player completes shop→setup unaided.
- **Verify:** grep audits + manual pass of every screen.
- **Deps:** T20. **Files:** `css/style.css`, `js/strings.js`, assorted `js/ui/*` (≤5 files).

### T23. Release checklist + deploy dry run — S
Execute spec §6 manual checklist (desktop + one mobile browser: render, day/night + patch, x-ray, every action incl. drag, speeds, restart persistence, each failure chain, offline). Deploy dry run: serve a copy minus `tests/`, `.harn/`, `.claude/` and confirm identical behavior (upload = deploy).
- **AC:** every checklist item checked on desktop + one mobile browser; pruned folder runs cold with no 404s and offline after first load.
- **Verify:** `npx serve <deploy-copy>` + checklist; final `node --test tests/`.
- **Deps:** T21, T21b, T22. **Files:** none new (fixes route to owning modules). Exclude `docs/` from the deploy copy alongside `tests/`, `.harn/`, `.claude/` (or keep it — it is static and harmless; decide at the dry run).

### T25. Volume-normalised environment + sublinear big-bin throughput — M
The capacity-scaled portion ladder (`cdfa5d5`) made the food INPUT scale with capacity while `moisture`/`ph`/`toxicity` — which are *concentrations* — did not scale at all, so a bigger bin did not dilute a feeding: one top-rung click moved moisture +0.284 on `tier2` but +0.425 on `eco`. `envDilution` (clamped at 1, anchored on `BIN_REFERENCE_CAPACITY = 30`) divides every liters-dosed input by bin volume — the food queue **and** `addSawdust`, which has the identical unit error. Separately, `CAPACITY_THROUGHPUT_FALLOFF = 0.15` bends the throughput ceiling sublinear in capacity so larger models earn a little less per liter, since they were previously better on every axis at once.
- **AC:** one top-rung click moves moisture within a narrow band on every model (measured 1.06× spread, was 1.50×); larger bins produce measurably less humus per liter of capacity; `tier2` runs are **bit-identical** so all five §2.8 windows and the good-care envelope hold unchanged; the `DECOMP_TICKS` wastage thresholds are re-derived (capacity no longer cancels); no scoring-formula or save-schema change.
- **Verify:** `node --test tests/*.test.js`; per-model 65-day fingerprint diffed before/after for `tier2` bit-identity; high-fill wastage probe (population pinned, T24-corrected methodology) across 18 model × fill cases.
- **Deps:** T24. **Files:** `js/sim/engine.js`, `js/ui/actions.js`, `tests/{actions,foods}.test.js`, `docs/game-reference.md`, `CLAUDE.md`.

### T25b. Portuguese reference doc — S/M
`docs/game-reference-pt.md`: full pt-BR counterpart of `docs/game-reference.md`, same structure/numbers/citations, identifiers left in code form, and the §4 anti-spoiler rule preserved in both languages. Written **after** T25 settles the constants so no stale numbers ship (same discipline as T21b).
- **AC:** structural parity (same sections, tables, formula blocks); every number matches its source module; no food suitability verdicts in either language; `CLAUDE.md` carries the matched-pair rule.
- **Verify:** cross-read against the English original and against `js/sim/*`.
- **Deps:** T25. **Files:** `docs/game-reference-pt.md` (new), `CLAUDE.md`.

> **CP9 (after T23):** ship gate — human sign-off vs spec acceptance criteria; scoring formula + save schema freeze ("ask first" from here).

---

## Change C-0002 — Multi-language (i18n): pt-BR / en / es

> Source spec: `.harn/devy/changes/C-0002-multilanguage-selector/spec.md`. This **interleaves** with the tasks above rather than forming a new phase. **Land I1 next** (parallel to T6–T8) so every Phase-2 UI task is built i18n-native instead of retrofitted. Reference locale is `pt-BR`; `en`/`es` mirror its exact key shape.

### I1. i18n runtime + locale catalogs + browser detection — M
Restructure `js/strings.js` from a single pt-BR object into an i18n **runtime**: active-locale state, `t(path)`, `setLang(tag)`, `getLang()`, `SUPPORTED_LANGS`, and pure `resolveLang(storedTag, navigatorLanguages)`. Move the existing pt-BR literals **verbatim** into `js/i18n/pt-BR.js`; author `js/i18n/en.js` + `js/i18n/es.js` mirrors. `main.js` `applyStrings()` reads the active catalog with **pt-BR missing-key fallback + `console.warn`**; on init it resolves the locale (own `minhocario.lang` key → browser → pt-BR), applies it, and sets `document.documentElement.lang`. Language persists in its **own localStorage key, never the save**.
- **AC:** the three catalogs have identical key sets (parity test green); `resolveLang` matrix passes (stored wins; `pt`/`en`/`es` primary-subtag mapping; unknown/empty → pt-BR); switching the active locale re-renders every `[data-string]` node; a missing key falls back to pt-BR and warns; default render stays pt-BR; zero UI literals added outside `js/strings.js`/`js/i18n/`.
- **Verify:** `node --test tests/i18n.test.js` (+ full `node --test tests/` green); `npx serve .` → default unchanged, `setLang('en')`/`setLang('es')` from the console swaps chrome; no non-same-origin requests.
- **Deps:** T1 (done). **∥** with T6–T8. **Blocks:** all Phase-2/3 UI tasks. **Files:** `js/strings.js`, `js/i18n/{pt-BR,en,es}.js`, `js/main.js`, `tests/i18n.test.js`.

### I3. Catalog display-name namespaces + worm Latin field — M
Add localized display names keyed by sim `id` — `catalog.composters[id]{name,desc}`, `catalog.worms[id]{name,desc}`, `catalog.foods[id]{name}` — across all three locales for every id in `js/sim/{composters,foods,worms}.js` (the catalog data is already built in T3/T4/T5). Add a language-neutral `latin` field to each species in `js/sim/worms.js` (data, not UI). **Foods carry `name` only** — no suitability/category/ordering signal in any locale.
- **AC:** coverage test green — every sim id has `name` (+`desc` where applicable) in all 3 locales; food entries expose **only** `name` (food-labeling guard green); worm `latin` present and identical across locales; `js/sim/` stays free of display strings (the neutral `latin` field excepted).
- **Verify:** `node --test tests/i18n.test.js` + `node --test tests/` green.
- **Deps:** I1 (needs the `js/i18n/` scaffold); T3/T4/T5 (done). **Blocks:** T11, T12, T14. **Files:** `js/i18n/{pt-BR,en,es}.js`, `js/sim/worms.js`.

### I2. Home-page language selector — S
Native-name selector (`Português` / `English` / `Español`) on the home screen; selecting calls `setLang` → persists `minhocario.lang` → re-renders `[data-string]` + rebuilds the ranking + re-renders the nickname (**nickname stays pt-BR-flavored**). The selector reflects the current active locale. **Home-only:** language is fixed once a farm is running (spec fork 2).
- **AC:** selector switches all visible home UI immediately; the choice persists across reload in its own key and **does not modify or invalidate an existing save**; a first-time visitor with an es/en browser lands in that language, unknown → pt-BR; nickname stays pt-BR regardless of language; `<html lang>` tracks the selection.
- **Verify:** `npx serve .` → switch each language, reload, inspect localStorage (separate `minhocario.lang` key alongside the `{v:1}` save); fresh-profile detection via DevTools locale override.
- **Deps:** I1, T10. **Files:** `js/ui/home.js`, `index.html`, `css/style.css`, `js/i18n/*`.

> **CP-i18n (after I1):** i18n suite green; default pt-BR render unchanged; console `setLang` swaps all chrome. Human review: `en`/`es` copy for the already-built screens.

**Cross-cutting constraint (Phase 2–3 UI tasks):** T10–T15 and T20 pull every string via `t()` and every model/species/food name via the `catalog.*` namespaces from the start — no hardcoded literals. **CP4** note: the language preference lives **outside** the save schema (its own `minhocario.lang` key), so it is exempt from the save-schema freeze. **T22** audit extends to assert catalog key-parity and the food-labeling guard across all three locales.

---

## Test plan mapping (spec §6 → tasks)

| Coverage | Test file | Task |
|---|---|---|
| Determinism (seeded RNG everywhere) | `tests/rng.test.js` + all suites | T2 |
| Temperature (ambient, fermentation, insulation, solarGain) | `tests/temperature.test.js` | T3 |
| Food queue + env dynamics | `tests/foods.test.js` | T4 |
| Population pipeline + stall/lagged recovery | `tests/population.test.js` | T5 |
| Mortality triggers | `tests/mortality.test.js` | T5 |
| Production rates, oldest-first consumption | `tests/production.test.js` | T6 |
| Humus/leachate overflow chains | `tests/overflow.test.js` | T6 |
| Scoring (multiplier, reset, monotonic) | `tests/scoring.test.js` | T7 |
| Economy (auto-sell, trade-in, migration) | `tests/economy.test.js` | T7 |
| §2.8 chains end-to-end + survivability | `tests/balance.test.js` | T8, T21 |
| Save round-trip + migration | `tests/storage.test.js` | T9 |
| i18n catalog parity + food-labeling guard + `resolveLang` detection | `tests/i18n.test.js` | I1, I3 |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Balance dead-ends (chains unreachable, or good care still dies) | High | T8 executable balance spec before any UI; CP3 number review; T21 second pass; constants test-locked |
| Unbundled Three.js import gotchas (bare `'three'` specifier in addons) | Med | T16 early spike; zero-addons policy; import map only as escape hatch |
| Drag/raycast flaky on touch | Low | Slider is the spec-mandated fallback; pointer events; T23 mobile smoke |
| Save schema churn mid-project | Med | Storage lands after T7 freezes shape; any later change ships with a migration |
| Sun patch disagrees with sim | Med | Patch renders by sampling `solarGain` itself; CP7 readability review |
| Timer drift / 20× jank | Med | Accumulator timer (T13); cheap O(queue+cohorts) tick; render decoupled at rAF |
| Migration edge cases (queue > new bin, dead colony mid-upgrade) | Med | Explicit cases in `tests/economy.test.js`; clamp rules reviewed at CP3 |
| Hardcoded pt-BR creep | Low | Grep-audit ACs in T1 and T22 |
| Locale catalogs drift out of sync (missing/blank keys) | Med | I1 parity test gates the three catalogs; runtime falls back to pt-BR + warns; T22 audit re-checks |
| i18n retrofit cost if UI built before I1 | Med | Land I1 before Phase-2 UI (T10+); cross-cutting `t()`/`catalog.*` constraint on every UI task |

## Parallelization

- **Serial critical path:** T2→T3→T4→T5→T6→T7→T8→T9→T10…T15 (sim tasks all touch `engine.js`; UI tasks share `main.js`/`index.html`).
- **Parallel lane:** T16 any time after T1 (recommended alongside Phase 1); T17 after T16+T3 alongside Phase 2. T18–T20 serialize with each other. T1 ∥ T2.
- Merge points for a second stream: T13 (continuous clock hook) and T14 (action dispatch for drag/x-ray).
- **i18n lane (C-0002):** I1 ∥ T6–T8 (touches `strings.js`/`main.js`, not `engine.js`); I3 after I1; I2 with T10. I1 should precede any Phase-2 UI task.

## Verification (end-to-end)

1. After every task: `node --test tests/` must be green (from T2 onward).
2. After UI tasks: manual flow via `npx serve .` per each task's verify step.
3. CP6: full DOM playthrough — buy→setup→feed→drain→harvest→upgrade→score→persist across browser restart.
4. CP8/CP9: spec §6 manual checklist (desktop + 1 mobile), each §2.8 failure chain reached at 20×, offline-after-first-load, deploy dry run from a pruned copy.
