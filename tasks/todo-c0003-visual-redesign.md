# C-0003 Visual & Layout Redesign — Task Checklist

> Tracks progress against `tasks/plan-c0003-visual-redesign.md`. Check tasks only after their
> verify step passes. Sizes: S/M. `∥` = can run in parallel with the serial spine.
> The v1 record (`tasks/plan.md`, `tasks/todo.md`) is closed — this is a separate post-ship project.

**Baseline at start:** `c1f5ab3`, suite 289 green.

## Phase A — Foundations (zero visual change)

- [x] **V1** Split `css/style.css` into 5 files, 5 `<link>`s (S) — deps: none
      Rules moved verbatim, grouped by kind. **AC amended mid-task:** byte-identical concatenation is
      unsatisfiable alongside the specified grouping (the five categories interleave in `style.css` —
      `.shop-card` sits between `.home` and `.setup`, `.banner` after `.speed__paused`). Replaced with
      rule-multiset equivalence against `tests/fixtures/style.baseline.css`; rationale recorded in the
      plan. New `tests/css.test.js` (3 tests): link order, no `@import`, rule equivalence — **all three
      broken deliberately first** (reordered links, injected `@import`, silently edited
      `.gauge__marker` width; each failed naming the exact cause). Suite 289 → 292.
      The equivalence test + fixture **retire at V2**, which rewrites declarations by design.
- [x] **V2a** `css/tokens.css` at today's values + migrate declarations, **zero visual change** (M) — deps: V1
      Split out of V2, which asked for identical computed values *and* a de-saturated surface ramp —
      mutually exclusive. V2a is naming only; every token equals the value it replaces.
      43 tokens, 213 `var()` references. **AC upgraded from devtools spot-checks to a machine proof:**
      `tests/css.test.js` now resolves every `var()` recursively against each side's own `:root` and
      compares applied (non-`:root`) rule blocks against the frozen baseline — so "no visual diff" is
      checked in CI, not by eye. Broken first: drifting `--radius`, `--space-2` and `--surface-2`, and
      a dangling token reference, each failed clearly. Suite 292 → 293.
      Side effect: **zero colour literals outside `tokens.css`**, so V3's hex rule already passes.
      Off-grid spacing (`2/3/6/10/14/44/56px`) and 8 stray durations left literal for V2b.
- [x] **V2b** Retune token values: de-saturate ramp, snap 4px grid, re-author type ramp (M) — deps: V2a
      **First task in C-0003 that changes what the player sees.** 144 selectors before and after —
      no rule added, moved or removed; 80 declarations changed value plus one new
      (`.actions__btn--warn { background }`). Full property-level computed-value diff captured in
      `tasks/v2b-computed-value-diff.md` **before** the baseline fixture was retired — it is the
      substitute for the screenshot diff this project has no tooling for, and the input to CPV1.
      Caught during the task: `--ink-faint` as first drafted (`#7d8f78`) measured **4.36:1**, under
      WCAG AA, on real copy — lightened to `#879a82` (5.0/4.7/4.1) before shipping.
      Deviations, each argued in the plan and recorded in `DESIGN.md`: no `--shadow-3` (would be
      invented, not extracted); the two infinite pulses kept out of the three duration steps
      (collapsing a 1.2s breath into 0.3s strobes); `--space-05` half-step added for the sub-4px
      readout gaps. Deleted V2a's equivalence test and `tests/fixtures/style.baseline.css`.
- [x] **V3** `tests/css.test.js` + `tests/markup.test.js` static guards (S/M) — deps: V2a
      6 new guards. `css.test.js`: tokens resolve, every token defined in `tokens.css` specifically,
      **no colour literal outside `tokens.css`** (hex *and* `rgb/rgba/hsl`). `markup.test.js`: no
      `[data-string]` element contains an `<svg>` (finding #1 tripwire), every `data-action` is
      wired, every literal `getElementById` id exists or is created in `js/`.
      **All five broken deliberately first**, each failing with a useful message. The `<svg>` rule is
      currently vacuous (no icons yet), so it ships with a companion test asserting the walker
      detects a planted violation — the V6 lesson applied to a rule that cannot yet fire.
      Two things the guards had to encode rather than assume: `data-action="openShop"` has **no**
      handler in `actions.js` and works purely via `data-nav="shop"`; `setup-waste-food` /
      `setup-waste-liters` are created at runtime by `setup.js`, not present in `index.html`.
- [x] **V4** `DESIGN.md` at root + `CLAUDE.md` pointer + release-checklist exclusion (S) — deps: V2a
      Records the two registers, the measured contrast table, type/space/motion rationale, the icon
      rules incl. the 14-food uniform-treatment discipline, a V7 placeholder for webfont provenance,
      and a deviations table. `CLAUDE.md` points at it and now states the five-file cascade rule.
      Excluded from the FTP upload deliberately — it names the mechanic the food list hides.
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

- [ ] **DECISION NEEDED — `--state-alert` fails WCAG AA on every surface.** Found while measuring
      contrast for V2b's new `--ink-faint` tier. `#c0563f` measures **3.3 / 3.1 / 2.7 : 1** against
      `--surface-0/-1/-2`; the 2.7 case is `.stat--alert .stat__value` inside the stats box, which is
      below even AA-large. It carries text in six places (stat values, HUD status, paused label,
      error feedback, banner heading, shop reason).
      **Pre-existing since v1 and NOT introduced by C-0003** — left unchanged deliberately rather
      than fixed silently, because reaching AA on all three surfaces means lightening it to roughly
      `#d79484`, which reads noticeably pinker and costs the colour its alarm quality. That is an
      identity call, not a mechanical one. Options: (a) accept and document, (b) lighten to ~`#d79484`,
      (c) lighten only enough for `--surface-0/-1` (~`#d0806d`) and give the stats box a darker
      backing. Recorded in `DESIGN.md` under Colour.
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

## Status: Phase A complete except V7 (webfont)

V1, V2a, V2b, V3, V4, V5, V6 all landed. Suite 289 → **298 green**.
Remaining before CPV1: **V7** (base64 webfont, independent of everything else).

CPV1's promise of "zero visual change except the typeface" **no longer holds as
written** — V2b retunes values by design, which is why it was split out and why
`tasks/v2b-computed-value-diff.md` exists. Review that diff at CPV1 alongside the
token vocabulary and the `DESIGN.md` art direction.
