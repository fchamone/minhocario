# C-0003 Visual & Layout Redesign — Task Checklist

> Tracks progress against `tasks/plan-c0003-visual-redesign.md`. Check tasks only after their
> verify step passes. Sizes: S/M. `∥` = can run in parallel with the serial spine.
> The v1 record (`tasks/plan.md`, `tasks/todo.md`) is closed — this is a separate post-ship project.

**Baseline at start:** `c1f5ab3`, suite 289 green.

## Phase A — Foundations (zero visual change)

- [ ] **V1** Split `css/style.css` into 5 files, byte-for-byte, 5 `<link>`s (S) — deps: none
- [ ] **V2** `css/tokens.css` + migrate declarations to tokens, identical computed values (M) — deps: V1
- [ ] **V3** `tests/css.test.js` + `tests/markup.test.js` static guards (S/M) — deps: V2
- [ ] **V4** `DESIGN.md` at root + `CLAUDE.md` pointer + release-checklist exclusion (S) — deps: V2
- [x] **V5** `ResizeObserver` on the canvas → `resizeScene()` (S) — deps: none
      Landed early as standalone correctness work (`64c3158`). Feature-detected, disconnected in
      `disposeScene`, no feedback loop (`updateStyle=false`). **Browser check still outstanding —
      see Open items.**
- [x] **V6** `DIMS` extraction: one source for `buildX` + `composterCavity` (M) — deps: none
      Landed early (`c0ae33e`). `structureOf()` feeds both sides; bit-identical across all 6 models
      (cavities + every mesh position). `tests/composter3d.test.js` (7 tests) holds it. The first
      containment test **passed a real simulated drift** — the group's overall bbox includes the lid
      and vent stack and swallows almost any error. `markBody()` now tags the enclosing meshes, with
      a companion test asserting the tags exist. Suite 282 → 289.
- [ ] **V7** Base64 webfont (SIL OFL, subset, `data:` URI in `css/font.css`) (S/M) — deps: none (∥)
- [ ] **CPV1** — suites green; **zero visual change** except the typeface.
      Review: token vocabulary + `DESIGN.md` art direction

## Phase B — Chrome

- [ ] **V8** Icon sprite + `js/ui/icons.js` + `index.html` `data-string` restructure (M) — deps: V3
- [ ] **V9** `js/ui/components.js` — consolidate shared UI primitives (M) — deps: V2 (∥ V8)
- [ ] **V10** Home / shop / setup restyle (M) — deps: V2, V7, V8, V9
- [ ] **V11** HUD + speed bar restyle (S/M) — deps: V2, V8
- [ ] **CPV2** — chrome restyled in all three locales.
      Review: icon set, and specifically the **14-food clustering check** (no test can enforce it)

## Phase C — Game-screen layout

- [ ] **V12** Three-column grid; internals → left column; delete `internalsSide` + its 5 tests (M) — deps: V5, V11
- [ ] **V13** Internals density pass: sub-grid, unified gauge, decomposition rings (M) — deps: V12, V9
- [ ] **CPV3** — desktop layout complete.
      Review: density, drag accuracy, and the `<details>` collapse→tick→expand repaint

## Phase D — 3D richness

- [ ] **V14** ACES tone mapping + retire `LIGHT_GAIN` + `toneMapped:false` opt-outs (M) — deps: V5
- [ ] **V15** `js/render/textures.js` CanvasTexture surfaces + fix the `material.map` leak (M) — deps: V14
- [ ] **V16** Contact-shadow blob (S) — deps: V6, V15
- [ ] **V17** Gradient sky backdrop via `vertexColors` (S/M) — deps: V14 (∥ V15/V16)
- [ ] **V18** Lathe / Extrude silhouettes (M) — deps: V6
- [ ] **V19** Real shadow maps + x-ray `castShadow` protocol — **gated at 2 ms, droppable** (M) — deps: V14, V16
- [ ] **CPV4** — full 3D pass.
      Review: x-ray legibility (most at risk from ACES), day/night readability, shadow gate decision

## Phase E — Release

- [ ] **V20** Audits + spec §6 checklist + deploy dry run (S/M) — deps: V13, V19
- [ ] **CPV5** — ship gate. Confirm explicitly that the scoring formula and save schema are
      **untouched** since the CP9 freeze

---

## Open items

- [ ] **V5 browser check (carried).** ResizeObserver has no automated coverage — it needs a real
      browser. `npx serve .`, resize the window, and drag the bin at several widths; it must stay
      pinned under the cursor. Do this **before** V12, since V12 is the task that would otherwise
      expose the bug it fixes.
- [ ] Decide whether C-0003 warrants a formal `.harn/devy/changes/C-0003-*/spec.md`. The decisions
      are captured in the plan's "Decisions locked" table; a spec was not written because this
      started as a design interview rather than a feature request.

## Discipline notes (carried from V6)

- **Break every guard test before trusting it.** V6's first containment test measured against the
  wrong bounding box and passed a deliberate drift. Every static guard in V3 and V8 gets the same
  treatment: violate the rule, confirm a clear failure, then keep it.
- **A stale rule is a bug.** `CLAUDE.md` claimed tests covered `js/sim/*` only (already untrue) and
  that development happened on `master` (a branch that never existed). Both fixed in this project's
  first two commits; keep the doc honest as the redesign moves things.

## Status: not started (Phase A pending)

V5 and V6 are banked. Phases A–E are open; nothing else has been touched.
