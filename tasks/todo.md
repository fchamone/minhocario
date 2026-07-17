# Minhocário v1 — Task Checklist

> Tracks progress against `tasks/plan.md`. Check tasks only after their verify step passes.
> Sizes: S/M. `∥` = can run in parallel with the critical path.
> Amended with Change C-0002 (multi-language i18n) — see the section at the bottom.

## Phase 1 — Skeleton and pure sim core

- [x] **T1** Static shell: index.html, screen routing, strings.js, base CSS (S) — deps: none
- [x] **T2** Seeded RNG + FarmState shape + engine clock (S) — deps: none (∥ T1)
- [x] **T3** Temperature model + solarGain + composter catalog (M) — deps: T2
- [ ] **CP1** — suites green; shell loads. Review: FarmState typedef + composter catalog numbers
- [x] **T4** Food queue + foods catalog + bin environment dynamics (M) — deps: T3
- [x] **T5** Population model + species catalog + mortality (M) — deps: T4
- [x] **T6** Production, consumption, overflow chains + drain/harvest (M) — deps: T5
- [ ] **CP2** — all sim suites green. Review: env dynamics + queue semantics
- [x] **T7** Scoring + economy + colony death/repopulate + migration (M) — deps: T6
- [x] **T8** Balance harness + first tuning pass (M) — deps: T7
- [ ] **CP3** — full suite green. **Human review of balance numbers (most important review)**

## Phase 2 — Persistence and DOM-playable game

- [ ] **T9** Storage: versioned save, migrations, round-trip (S) — deps: T7
- [ ] **T10** Home screen: nickname, ranking, Play/Continue (S/M) — deps: T1, T9
- [ ] **CP4** — save round-trip proven + home persists. Review: save schema (freezes at v1 ship)
- [ ] **T11** Shop screen, first purchase (S) — deps: T7, T10
- [ ] **T12** Setup screen → farm created and saved (M) — deps: T11
- [ ] **T13** Game loop wiring: HUD, speed, tick timer, autosave (M) — deps: T12, T9
- [ ] **CP5** — first end-to-end human playtest (shop→setup→running farm→persistence)
- [ ] **T14** Actions panel + DOM internals (x-ray data) panel (M) — deps: T13
- [ ] **T15** Full lifecycle: death/repopulate, upgrade, restart, live ranking (M) — deps: T14
- [ ] **CP6** — complete game playable DOM-only; playtest vs spec criteria minus 3D; tuning notes for T21

## Phase 3 — Three.js render layer

- [ ] **T16** Vendor Three.js + minimal scene (S/M) — deps: T1 (∥ early spike, run alongside Phase 1/2)
- [ ] **T17** Procedural composter meshes, all 6 models (M) — deps: T16, T3 (∥ Phase 2)
- [ ] **T18** Day/night lighting + sun patch via solarGain (M) — deps: T16, T3, T13
- [ ] **CP7** — 3D + meshes + day/night + sun patch. Review: placement-mechanic readability
- [ ] **T19** Drag-move via raycast + slider sync (M) — deps: T17, T14
- [ ] **T20** 3D x-ray view (M) — deps: T17, T14
- [ ] **CP8** — full feature set; manual playtest of spec §6 checklist on desktop

## Phase 4 — Tuning, polish, release

- [ ] **T21** Second balance pass (playfeel) + constant lock-in (M) — deps: T15, T18 (ideally T20)
- [ ] **T22** UX/visual polish + audits (strings/Math.random/food labels) (S/M) — deps: T20
- [ ] **T23** Release checklist + deploy dry run (S) — deps: T21, T22
- [ ] **CP9** — ship gate: human sign-off vs spec acceptance criteria; scoring + save schema freeze

## Change C-0002 — Multi-language (i18n): pt-BR / en / es

> Interleaves with the phases above (spec `.harn/devy/changes/C-0002-multilanguage-selector/spec.md`). Land **I1 next** (∥ T6–T8) so Phase-2 UI is built i18n-native. Cross-cutting: T10–T15 and T20 must use `t()` + `catalog.*` (no hardcoded strings); the T22 audit adds catalog parity + the food-labeling guard. Language pref lives in its own `minhocario.lang` key, outside the save schema.

- [x] **I1** i18n runtime + locale catalogs + browser detection (M) — deps: T1 (∥ T6–T8; blocks all UI tasks)
- [ ] **CP-i18n** — i18n suite green; default pt-BR unchanged; console `setLang` swaps chrome. Review: en/es copy
- [x] **I3** Catalog display-name namespaces + worm `latin` field (M) — deps: I1 (blocks T11/T12/T14)
- [ ] **I2** Home-page language selector (S) — deps: I1, T10
