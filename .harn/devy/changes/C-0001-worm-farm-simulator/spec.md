# Spec C-0001 — Worm Farm (Minhocário) Simulator

**Status:** Refined and approved for implementation
**Source idea:** `d:\FABIANO\worm farm idea.txt`
**Date:** 2026-07-17 (refined 2026-07-17 — all design forks resolved in interview)

---

## 1. Objective

A browser-based vermicomposting (worm farm) simulator game, deployed as a **fully static site** on basic shared hosting under the owner's personal domain. The player buys a composter model, prepares it (worms + bedding + organic waste), then manages an **endless farm** day by day: feeding, draining leachate, harvesting humus, moving the bin along the garage wall, and keeping the worm colony alive and reproducing. Score combines production output with colony age.

**Target users:** casual players and composting enthusiasts; educational idle-game feel. UI language: **pt-BR** (strings centralized for a future EN translation).

### Core features (v1 scope)

1. **Home screen** — local ranking (top 10 farms of this browser) + Play/Continue button. First play generates a random nickname (adjective + animal + number, e.g. `MinhocaVeloz42`). Reroll button; **no free-text nickname entry** (avoids profanity handling). Nickname persists on the profile. No account, no login.
2. **Shop** — composter models, smallest → largest: electric home composter, 2-tier (2 boxes), 3-tier, 4-tier, buried composting, eco composter. Models differ in capacity (volume), processing speed, production rates (humus and leachate), and **thermal insulation/regulation**.
3. **Setup** — choose worm species, add initial bedding mix (sawdust + peels/husks + wet cardboard), add first organic waste, place the composter on the wall. **Guided:** recommended bedding amounts are pre-filled; the player may deviate (and learn) — the mix ratio sets initial moisture and pH.
4. **Time system** — simulation advances from day 1. Speeds: super slow 0.25×, slow 0.5×, **normal 1× (1 game day = 1 real minute)**, fast 5×, super fast 20×. Pause implicit when tab hidden.
5. **Simulation engine** — worm population growth, humus and leachate production, temperature. Failure states that must be reachable: worms dying, reproduction stalling to zero for a period, production stopping, humus overflow, leachate overflow.
6. **Game screen** —
   - **3D view (Three.js):** the composter in front of a garage wall; lighting follows the day/night cycle; a **sun patch sweeps the wall during the day** making the placement mechanic readable.
   - **X-ray view:** toggle revealing internals — population by stage, moisture, pH, toxicity, temperature, recent food items, humus/leachate fill. Runs live (does not pause).
   - HUD top: score, money, current day/time, current status. Side panel: actions. Bottom: speed control.
7. **Player actions** — add organic waste (unlabeled mixed list — discovery is gameplay); add sawdust (quantity); add worm packs (50/100/200); drain leachate (instant, empties fully); harvest humus (empties tray, allowed anytime); **move composter** (drag along the wall in 3D + slider fallback, free, anytime); open shop (mid-farm upgrade).
8. **Scoring** — accrued per harvest with an age multiplier (§2.7).
9. **Persistence** — game state survives sessions via `localStorage` (not cookies), versioned save format, single slot.

### Out of scope (v1) / future phases

- **Global player ranking** — deferred (no backend for now). The scoring and save format MUST be designed so a phase-2 backend (e.g. small PHP + SQLite API on the same hosting) can ingest ranking entries without breaking saves. Nickname uniqueness is only local in v1; global uniqueness resolves in phase 2.
- Sound, mobile-specific layout polish, achievements.
- Owning multiple composters simultaneously.

### Acceptance criteria

- Opens and runs from a plain static file server (and from FTP-uploaded shared hosting) with **zero build step** — upload = deploy.
- Works offline after first load: no CDN or external network calls (Three.js vendored locally).
- A full loop is playable: buy → set up → simulate days → feed → drain → harvest → sell → upgrade → score updates → state persists after closing/reopening the browser.
- Wrong care produces consequences: feeding only unsuitable food eventually kills worms; never draining leachate causes overflow; overfilling humus halts production; overfeeding overheats the bin. All reachable purely by neglect or bad choices.
- Day/night is visually perceivable in the 3D scene at normal speed, including the moving sun patch.
- Sim engine unit tests pass via `node --test`.

---

## 2. Game design (resolved decisions)

### 2.1 Lifecycle

- The farm is **endless**. The player may restart anytime (with confirmation dialog).
- **Population zero is recoverable:** the farm enters a "colony dead" state (production stops); adding a new worm pack repopulates the **same** farm, but the **colony-age counter resets to zero**. Harvested totals and banked score are kept.
- **Local ranking:** one entry per farm — `{ nickname, score, composterId, daysSurvived, createdAt }`. The current farm's entry updates live (high-water mark); restart freezes it and starts a new entry. Home screen shows top 10. This record shape is the phase-2 API payload.

### 2.2 Economy

- **Currency** (coins). New profiles start with a budget sufficient for the cheapest composter + 50 worms + bedding, with a little slack.
- **Income:** harvested humus and drained leachate **auto-sell instantly** at fixed per-liter prices (humus worth much more; leachate a small bonus). No inventory system.
- **Free:** household organic waste and sawdust (it's garbage).
- **Costs:** composters, worm packs (50/100/200).
- **Wallet is on the player profile** — it survives farm restarts.
- **Mid-farm upgrade:** buying a new composter migrates worms, food queue, bedding, and colony age into it. Humus/leachate in the old bin are auto-sold at migration. The old composter is **traded in for 50% of its price**. One composter owned at a time.

### 2.3 Time

- **Sim tick = 1 game hour** (`tick(state, rng)` advances one hour; 24 ticks = 1 day). At normal speed one tick fires every 2.5 real seconds; speed control scales the tick timer only.
- Day/night lighting reads the continuous clock in `main.js` and interpolates between ticks; the sim stays discrete and testable.
- **No offline progress:** the sim advances only while the tab is open and visible. Closing the browser freezes the farm exactly as saved. No catch-up ticks on load.

### 2.4 Population model

Three-stage cohort model (timescales compressed for gameplay — days, not months):

- **Cocoons → juveniles → adults.** Adults lay cocoons at a rate scaled by conditions; cocoons hatch after a delay; juveniles mature into adults.
- Reproduction stalling = no new cocoons while conditions are bad; recovery has realistic lag (empty pipeline), so neglect hurts even after conditions are fixed.
- X-ray shows the three counts.

### 2.5 Bin environment variables

Four bin-wide variables, each with a comfort band; outside it reproduction slows first, then mortality rises:

- **Moisture** — raised by wet foods and leachate backup; lowered by sawdust (the sawdust action's purpose).
- **pH** — pushed acid by citrus/onion; drifts slowly back to neutral.
- **Toxicity** — accumulates from unsuitable foods (meat, dairy, salt, oil); decays very slowly — the long-term punishment.
- **Temperature** — driven by:
  - **ambient day/night cycle** (ties the visible lighting to the sim),
  - **fermentation heat from fresh food mass** (overfeeding → dangerous spike),
  - **composter insulation/regulation trait** (electric actively holds near-ideal temperature — its shop premium; buried is very stable; open tray models track ambient),
  - **wall position** (§2.6).

### 2.6 Wall placement (continuous)

- The composter sits at `state.wallPosition ∈ [0, 1]` along the garage wall. Part of the wall receives **direct sun during the day**.
- A pure function `solarGain(wallPosition, hourOfDay)` in `js/sim/` returns the solar heat contribution — deterministic and unit-testable. The render layer visualizes the same function as a sun patch sweeping the wall.
- Moving is a free action, allowed anytime: drag the composter in the 3D view (raycast), with a position slider in the actions panel as fallback/precision control.

### 2.7 Food model (item queue)

- Each feeding creates a queue entry `{ foodId, liters, addedAtTick }`. Minimum portion 0.25 L; the queue is bounded by bin capacity.
- Entries **decompose over ticks**, releasing their moisture/pH/toxicity effects gradually and generating fermentation heat while fresh; worms consume entries **oldest-first**, converting them to humus. Fully consumed entries are removed.
- The food list (~14 items) **mixes suitable and unsuitable foods without labeling which is which** — discovery is gameplay. Baseline list — suitable: fruit peels, vegetable scraps, coffee grounds, crushed eggshells, wet cardboard, tea leaves, pumpkin guts; harmful: citrus, onion/garlic, meat, dairy, salty leftovers, oily food, cooked pasta.

### 2.8 Failure chains

- **Leachate overflow:** tank full → excess re-saturates bedding → moisture spikes → mortality.
- **Humus overflow:** tray full → processing halts → uneaten food rots in the queue → toxicity climbs → mortality.
- **Overfeeding:** large fresh mass → fermentation heat → temperature spike → mortality (worse in the sun spot / poorly insulated models).
- **Only unsuitable food:** toxicity accumulates faster than decay → reproduction stalls → colony dies.

### 2.9 Worm species (3, mechanically distinct)

Stats per species: reproduction rate, processing (eating) speed, temperature comfort band, moisture sensitivity, price.

| Species | Archetype |
|---|---|
| **Vermelha-da-Califórnia** (*Eisenia fetida*) | Forgiving all-rounder, cheap — the beginner choice |
| **Gigante-Africana** (*Eudrilus eugeniae*) | Fastest eater, best humus output; heat-loving, dies in cold nights — pairs with the sun spot or electric composter |
| **Minhoca-Azul** (*Perionyx excavatus*) | Fastest reproduction; narrow moisture band |

No minhocuçu — it's a protected native species; selling it in-game sends the wrong message.

### 2.10 Scoring (frozen at v1 ship — "ask first" to change)

Score accrues at each harvest:

```
points += litersHarvested × 10 × (1 + colonyAgeDays / 30)
```

- Couples production and longevity: pure idling earns nothing; harvest-and-restart loses the multiplier.
- Colony death resets the multiplier (age = 0); banked points stay. **Score never decreases** — the live ranking entry is monotonic.

### 2.11 Persistence

- Single save slot. Schema: `{ v: 1, profile: { nickname, wallet }, farm: { ... }, ranking: [ ... ] }`.
- Autosave on: every player action, every game-day boundary, and `visibilitychange`.
- Version the format and migrate old saves on load; never silently discard a player's save.

---

## 3. Commands

| Task | Command |
|------|---------|
| Run locally (dev) | `npx serve .` **or** `python -m http.server 8000` (ES modules don't load via `file://`) |
| Run unit tests | `node --test tests/` |
| Deploy | Upload project folder (minus `tests/`, `.harn/`) via FTP to the hosting — no build step |

No npm install, no bundler, no transpiler. Node is needed only to run tests locally.

---

## 4. Project structure

```
D:\FABIANO\minhocario\
├── index.html              # single page; screens are DOM sections (home/shop/setup/game)
├── css/
│   └── style.css
├── js/
│   ├── main.js             # entry point: screen routing, game loop wiring, tick timer
│   ├── strings.js          # ALL pt-BR UI strings (single source, future i18n)
│   ├── storage.js          # localStorage save/load, versioned save format + migrations
│   ├── sim/                # PURE simulation engine — no DOM, no Three.js imports
│   │   ├── engine.js       # tick(state, rng) → new state; 1 tick = 1 game hour
│   │   ├── composters.js   # composter catalog (capacity/speed/production/insulation/price)
│   │   ├── worms.js        # species catalog, 3-stage population model, mortality rules
│   │   ├── foods.js        # waste catalog: per-liter effects (moisture, pH, toxicity, heat)
│   │   ├── temperature.js  # ambient cycle + fermentation heat + solarGain(position, hour)
│   │   ├── scoring.js      # harvest points with age multiplier
│   │   └── rng.js          # seeded RNG (deterministic tests)
│   ├── ui/                 # DOM-based screens and controls
│   │   ├── home.js         # ranking + play button + nickname generation/reroll
│   │   ├── shop.js         # catalog + mid-farm upgrade/trade-in
│   │   ├── setup.js        # guided setup: species, bedding mix, first waste, placement
│   │   ├── hud.js          # score/money/time/status bar
│   │   ├── actions.js      # side action panel + quantity dialogs + position slider
│   │   └── speed.js        # bottom speed control
│   └── render/             # Three.js layer
│       ├── scene.js        # garage wall, camera, day/night lighting, sun patch, drag
│       ├── composter3d.js  # procedural low-poly mesh builder per composter model
│       └── xray.js         # x-ray view (transparent material swap + gauges)
├── vendor/
│   └── three.module.min.js # vendored, version pinned in a comment header
├── assets/                 # icons only — NO 3D binary assets (all meshes procedural)
├── tests/                  # node:test suites for js/sim/* only
└── .harn/devy/changes/C-0001-worm-farm-simulator/spec.md   # this file
```

**Hard boundary:** `js/sim/` is pure logic. It must be importable and testable under Node with no browser globals. `js/render/` and `js/ui/` read sim state; only `js/main.js` orchestrates between layers.

**3D approach:** all meshes built in code from Three.js primitives (boxes, cylinders, lathe shapes), flat colors, stylized low-poly. No GLB/model files, no asset pipeline. X-ray = swapping to transparent materials.

---

## 5. Code style

- Vanilla **ES modules**, modern evergreen browsers only; no transpilation, no polyfills.
- **JSDoc type annotations** (`@param`/`@returns`/`@typedef`) on all `js/sim/` public functions — editor IntelliSense without TypeScript.
- Code identifiers and comments in **English** (worm, humus, leachate); all user-facing text in **pt-BR** and only via `strings.js` — never hardcode UI strings in components.
- `const` by default; small focused modules; no classes where a plain object + functions suffices. Sim state is a plain serializable object (JSON-safe — enables save/load and future backend sync).
- Deterministic simulation: all randomness flows through the seeded RNG passed into `tick()`; never `Math.random()` inside `js/sim/`.
- No runtime dependencies other than the vendored Three.js.

---

## 6. Testing strategy

- **Unit tests (automated):** Node's built-in `node:test` + `node:assert` on the pure sim engine. No DOM, no mocks of browser APIs (storage tests use an in-memory stub passed as a parameter). Cover at minimum:
  - population pipeline (cocoon laying, hatch delay, maturation; stall-to-zero and lagged recovery)
  - mortality triggers (toxicity, dryness, overheating, overpopulation)
  - temperature model (ambient cycle, fermentation heat, insulation traits, `solarGain` by position/hour)
  - food queue (oldest-first consumption, gradual effect release, capacity bound, entry removal)
  - production rates per composter model
  - humus overflow and leachate overflow chains (§2.8)
  - scoring formula (age multiplier, multiplier reset on colony death, monotonic score)
  - economy (auto-sell amounts, trade-in credit, migration preserving colony age)
  - save format round-trip and version migration
- **Determinism:** every test seeds the RNG; same seed + same actions ⇒ same state.
- **Manual playtest checklist (per release):** 3D scene renders on desktop + one mobile browser; day/night + sun patch visible; x-ray toggle; each action works incl. drag-move; speed changes take effect; state survives browser restart; each failure chain reachable.

---

## 7. Boundaries

### Always
- Keep `js/sim/` free of DOM/Three.js/browser imports — pure and Node-testable.
- Keep the site fully static and self-contained: no CDN, no external calls, vendored Three.js pinned.
- Version the save format (`{ v: 1, ... }`) and migrate old saves on load; never silently discard a player's save.
- Route every UI string through `strings.js` (pt-BR).
- Route every random draw in the simulation through the seeded RNG.

### Ask first
- Adding any runtime dependency beyond the vendored Three.js.
- Introducing a backend or third-party service (this is the planned phase-2 global ranking — but it starts only when explicitly requested).
- Changing the scoring formula (§2.10) or save schema after v1 ships (breaks comparability of existing local rankings).
- Adding a build step or toolchain requirement.

### Never
- Never use cookies for game state — `localStorage` only.
- Never label foods as allowed/forbidden in the add-waste UI — the list mixes them undifferentiated by design; discovery is gameplay.
- Never add tracking/analytics without an explicit request.
- Never require login/accounts in v1.
