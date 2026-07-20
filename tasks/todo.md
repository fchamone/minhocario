# Minhocário v1 — Task Checklist

> Tracks progress against `tasks/plan.md`. Check tasks only after their verify step passes.
> Sizes: S/M. `∥` = can run in parallel with the critical path.
> Amended with Change C-0002 (multi-language i18n) — see the section at the bottom.

## Phase 1 — Skeleton and pure sim core

- [x] **T1** Static shell: index.html, screen routing, strings.js, base CSS (S) — deps: none
- [x] **T2** Seeded RNG + FarmState shape + engine clock (S) — deps: none (∥ T1)
- [x] **T3** Temperature model + solarGain + composter catalog (M) — deps: T2
- [x] **CP1** — suites green; shell loads. Review: FarmState typedef + composter catalog numbers
- [x] **T4** Food queue + foods catalog + bin environment dynamics (M) — deps: T3
- [x] **T5** Population model + species catalog + mortality (M) — deps: T4
- [x] **T6** Production, consumption, overflow chains + drain/harvest (M) — deps: T5
- [x] **CP2** — all sim suites green. Review: env dynamics + queue semantics
- [x] **T7** Scoring + economy + colony death/repopulate + migration (M) — deps: T6
- [x] **T8** Balance harness + first tuning pass (M) — deps: T7
- [x] **CP3** — full suite green. **Human review of balance numbers (most important review)**

## Phase 2 — Persistence and DOM-playable game

- [x] **T9** Storage: versioned save, migrations, round-trip (S) — deps: T7
- [x] **T10** Home screen: nickname, ranking, Play/Continue (S/M) — deps: T1, T9
- [x] **CP4** — save round-trip proven + home persists. Review: save schema (freezes at v1 ship)
- [x] **T11** Shop screen, first purchase (S) — deps: T7, T10
- [x] **T12** Setup screen → farm created and saved (M) — deps: T11
- [x] **T13** Game loop wiring: HUD, speed, tick timer, autosave (M) — deps: T12, T9
- [x] **CP5** — first end-to-end human playtest (shop→setup→running farm→persistence)
- [x] **T14** Actions panel + DOM internals (x-ray data) panel (M) — deps: T13
- [x] **T15** Full lifecycle: death/repopulate, upgrade, restart, live ranking (M) — deps: T14
- [x] **CP6** — complete game playable DOM-only; playtest vs spec criteria minus 3D; tuning notes for T21
      Automated audits green, chain timings + tuning notes collected in
      `tasks/cp6-playtest.md`. Human playthrough signed off. Two T21 notes
      recorded (overfeeding mechanism, economy pacing).

## Phase 3 — Three.js render layer

- [x] **T16** Vendor Three.js + minimal scene (S/M) — deps: T1 (∥ early spike, run alongside Phase 1/2)
- [x] **T17** Procedural composter meshes, all 6 models (M) — deps: T16, T3 (∥ Phase 2)
- [x] **T18** Day/night lighting + sun patch via solarGain (M) — deps: T16, T3, T13
- [x] **CP7** — 3D + meshes + day/night + sun patch. Review: placement-mechanic readability
      Approved 2026-07-20. Placement mechanic reads correctly: sun patch sweeps the
      wall and the sunny-centre vs shaded-end temperature delta is legible in the
      internals panel. Automated portion re-verified at `15b2f34` (282 green).
- [x] **T19** Drag-move via raycast + slider sync (M) — deps: T17, T14
- [x] **T20** 3D x-ray view (M) — deps: T17, T14
- [x] **CP8** — full feature set; manual playtest of spec §6 checklist on desktop
      Approved 2026-07-20. Full spec §6 checklist walked; sign-off and the
      re-run audit table in `tasks/cp8-playtest.md`.

## Phase 4 — Tuning, polish, release

- [x] **T21** Second balance pass (playfeel) + constant lock-in (M) — deps: T15, T18 (ideally T20)
      Electric price 350→200 (T21-3); africana sun-spot spec erratum documented, tempResponse
      lever rejected (T21-4); balance bounds tightened + 2 locking tests. Suite 222 green.
      Decisions + measurements in `tasks/t21-balance.md`.
- [x] **T21b** Behavior/constants/rules reference doc → `docs/game-reference.md` (S/M) — deps: T21
      Kept current through T24 (§7 `ration`, §8 throughput ceiling / gating / `DECOMP_TICKS`).
- [x] **T22** UX/visual polish + audits (strings/Math.random/food labels) (S/M) — deps: T20
- [x] **T23** Release checklist + deploy dry run (S) — deps: T21, T21b, T22
      T21b + T22 committed separately (docs / feat(ui)). Deploy dry run: pruned
      copy (minus tests/.harn/.claude/tasks/docs/.git) statically verified — all
      48 runtime imports resolve locally, index.html refs exist, zero runtime
      external URLs / network calls (Three.js `fetch` is in unused loader code).
      `docs/` EXCLUDED from the FTP upload (maintainer spoiler sheet, not
      player-facing). Full checklist + CP9 human gates in
      `tasks/release-checklist.md`. Suite 222 green.
- [x] **T24** Feed-rate pacing fix — `THROUGHPUT_CAP_PER_LITER` (M) — deps: T21, T21b
      Found IN PLAY, not by the suite: at 5× a mature colony ate the largest servable
      portion in ~3 s. Capacity-scaled throughput ceiling (0.014 L/tick/L) shared by the
      `ration` demand and the actual eating; portion ladder widened; ceiling `species.speed`
      regression fixed. Bracketed above by pacing and below by the `OVERPOP_STALL` crowding
      wall — good-care equilibrium 1463 → 2034 worms (active/cap 1.31, still food-limited),
      season score 1962.8 → 1957.6, all five §2.8 chain days unchanged. Scoring formula and
      save schema untouched (CP9 freeze unaffected). Suite 256 green. Measurements in
      `tasks/t21-balance.md` (T24 section).
- [x] **T25** Volume-normalised environment + sublinear big-bin throughput (M) — deps: T24
      Found IN PLAY again, suite fully green: the capacity-scaled portion ladder (cdfa5d5)
      made the INPUT scale with capacity while `moisture`/`ph`/`toxicity` — concentrations —
      did not scale at all, so one top-rung click moved moisture +0.284 on `tier2` but
      +0.425 on `eco` (landing 0.925, past the comfort max). `envDilution` divides every
      liters-dosed input (food queue AND sawdust) by bin volume; `CAPACITY_THROUGHPUT_FALLOFF`
      bends the throughput ceiling sublinear so bigger bins earn a little less per liter
      (eco −16.5 %, buried −13.7 %, tier4 −9.9 %). Both anchored on `BIN_REFERENCE_CAPACITY`
      = 30 (`tier2`), so all five §2.8 windows and the good-care envelope are **bit-identical**
      — verified by diff. Click spread 1.50× → 1.06×. Also fixed a stale
      `THROUGHPUT_CAP_PER_LITER = 0.02` mirror in `tests/actions.test.js` (engine: 0.014) that
      was inverting the invariant it guarded; the ceiling is now an exported function so a
      mirror is impossible. Scoring formula and save schema untouched (CP9 freeze unaffected).
      Suite 282 green. Measurements in `tasks/t21-balance.md` (T25 section).
- [x] **T25b** `docs/game-reference-pt.md` — pt-BR counterpart of the reference doc (S/M) — deps: T25
      Matched pair with the English original: same structure, same numbers, different prose.
      Sync is convention-enforced via a rule in `CLAUDE.md` (update both or neither).
- [x] **CP9** — ship gate: human sign-off vs spec acceptance criteria; scoring + save schema freeze
      Approved 2026-07-20 — **v1 is shipped**. The scoring formula
      (`js/sim/scoring.js`) and the save schema (`{v:1,...}` in `js/storage.js`)
      are now **FROZEN**: any change to either requires explicit user approval and
      ships with a migration. The `minhocario.lang` key stays outside the schema
      and is exempt. Release checklist: `tasks/release-checklist.md`.

## Change C-0002 — Multi-language (i18n): pt-BR / en / es

> Interleaves with the phases above (spec `.harn/devy/changes/C-0002-multilanguage-selector/spec.md`). Land **I1 next** (∥ T6–T8) so Phase-2 UI is built i18n-native. Cross-cutting: T10–T15 and T20 must use `t()` + `catalog.*` (no hardcoded strings); the T22 audit adds catalog parity + the food-labeling guard. Language pref lives in its own `minhocario.lang` key, outside the save schema.

- [x] **I1** i18n runtime + locale catalogs + browser detection (M) — deps: T1 (∥ T6–T8; blocks all UI tasks)
- [x] **CP-i18n** — i18n suite green; default pt-BR unchanged; console `setLang` swaps chrome. Review: en/es copy
      Approved 2026-07-20. The human en/es copy review is complete, closing the
      note below.
- [x] **I3** Catalog display-name namespaces + worm `latin` field (M) — deps: I1 (blocks T11/T12/T14)
- [x] **I2** Home-page language selector (S) — deps: I1, T10

> Note: an automated en/es copy review was applied to the locale catalogs (punctuation, bedding term, upgrade phrasing); the human CP-i18n copy review followed and signed off on 2026-07-20.

---

## Status: v1 complete

All 23 tasks and all 9 checkpoints are closed as of 2026-07-20 (`15b2f34`, suite
282 green). **CP9 froze the scoring formula and the save schema** — changing
either from here needs explicit approval and a migration, per `CLAUDE.md`.

Out of scope for v1 and not started: the global ranking backend (spec phase 2),
which begins only when explicitly requested.

**Active post-v1 work lives elsewhere:** the visual & layout redesign is tracked in
`tasks/plan-c0003-visual-redesign.md` / `tasks/todo-c0003-visual-redesign.md`.
This file is the closed v1 record and is not amended further.
