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
- [x] **V7** Base64 webfont (SIL OFL, subset, `data:` URI in `css/font.css`) (S/M) — deps: none (∥)
      **IBM Plex Sans 3.201**, SIL OFL 1.1 — IBM's engineering/documentation face, which belongs to
      the field-instrument register without being a coding monospace. Shipped **variable**
      (wght 400–700) rather than three static weights: the CSS uses 400, 600 and 700, and one
      variable face covers all of them plus the UA bold in a single data URI. `wdth` pinned to 100.
      **234 glyphs, 27,100 bytes woff2, 36,136 bytes base64** — against the 100KB+ the plan warned an
      unsubsetted face would cost. Built one-time with fontTools in a **throwaway venv**, so nothing
      was installed into the machine's Python; command recorded verbatim in `DESIGN.md`.
      **The find that nearly broke the design silently: this face has no `tnum` feature.** The whole
      instrument register depends on `font-variant-numeric: tabular-nums`. It turned out to need
      none — every digit is 600 units wide by default — verified at wght 400/600/700 after subsetting
      *and* again by decoding the data URI out of the served CSS. The CSS declaration is kept
      deliberately as a statement of the requirement; `DESIGN.md` warns that any face swap must
      re-check this, because a proportional face with no `tnum` would make every readout jitter and
      nothing would fail loudly.
      Licence compliance: `css/IBMPlexSans-OFL.txt` ships **in the upload set**, since the OFL
      requires its text to travel with redistributed font software.
      Cascade is now six files (`font.css` at position 2 — it selects nothing, like `tokens.css`).
      New guard: no stylesheet may reference an external URL (broken first with a `fonts.gstatic.com`
      `src` fallback — the exact mistake that would work in dev and fail offline). Suite 299 → 300.
- [x] **CPV1 — APPROVED by the maintainer, 2026-07-20.** Phase A signed off; Phase B unblocked.
      **Machine-verified at the gate:** 300 tests green; V1 and V2a proved to change no computed
      value (resolved-equivalence against the frozen baseline); every text colour ≥ WCAG AA on the
      surfaces it occupies; no colour literal outside `tokens.css`; no external URL in any sheet;
      the shipped font decoded from the served CSS and confirmed tabular at wght 400/600/700.
      **Accepted on the maintainer's judgement, not measured:** the surface-ramp read (lifted vs
      greener), the type-ramp density, the two adjacent reds in a gauge, and the typeface across the
      four screens. These are the items no test in this project can reach.
      **Cheap to revisit if any of them reads wrong in use:** V2b's colour and scale decisions are
      confined to `css/tokens.css`, which is exactly why V2 was split — a reversal is a value edit in
      one file, not a redesign across four.
      **Not closed by this approval:** the V5 browser check below. It is a *correctness* item (drag
      raycast accuracy), not an aesthetic one, and it still requires a real browser before V12.

## Phase B — Chrome

- [x] **V8** Icon sprite + `js/ui/icons.js` + `index.html` `data-string` restructure (M) — deps: V3
      23 symbols (9 chrome + 14 food) inlined at the top of `<body>`; `createElementNS` confined to
      `icons.js` and tested. **Finding #1's tripwire is no longer vacuous** — every action button, the
      slider label and the colony-dead CTA now carry the icon as a *sibling* of an inner
      `[data-string]` span, and `tests/markup.test.js` was re-broken to confirm it fires on real icons.
      Keys unchanged, so the three locales and the i18n suite never moved.
      **Most of the food discipline turned out to be measurable**, so it is enforced rather than
      trusted: one shared `viewBox`, a byte-identical frame circle, exactly one `stroke-width` across
      the set, `currentColor`/`none` only, stroke-only (no fill-density differences), one symbol per
      catalog food and no symbol without a food.
      **DEVIATION, recorded in `DESIGN.md`:** the set is stroke-based, not `fill="currentColor"` as
      rule 3 said. The line register is what `DESIGN.md` already describes, and — the deciding
      reason — stroke weight is a single scalar per icon, so "all 14 at one optical weight" becomes
      testable; with fills, uniform density is taste and nothing can enforce it.
      Also landed: the proportional volume glyph (scaled against the largest rung offered for *this*
      bin, so the four buttons read as a ladder) and the decomposition rings, driven by the same
      `decomposed` fraction the percentage beside them prints — one source, so they cannot disagree.
      Both are parametric, hence built element-wise rather than put in the sprite.
      Ten violations planted, each caught by the right guard. **Added beyond the plan:** a path-data
      guard — a malformed `d` renders nothing and reports nothing, and with 81 hand-typed paths that
      is the likeliest way an icon silently disappears. Suite 313 → 327.
- [x] **V9** `js/ui/components.js` — consolidate shared UI primitives (M) — deps: V2 (∥ V8)
      `clamp01`, `WARN_FILL`, `fillOf`, `formatLiters`, `formatPercent`, `fill`, `buildStat`,
      `buildGauge`, `buildFillBar`, `buildGroup`, `markFillLevel`. `actions.js` re-exports
      `buildStat`/`fillOf`/`markFillLevel`/`WARN_FILL` for one release, so **no test file moved**.
      Two judgement calls: the AC's "one gauge builder" shipped as two thin variants over one private
      `gaugeRow` skeleton — the duplication was the row/label/value/track markup, now authored once,
      and the variants differ in what goes in the track and how the row's state is marked, which is a
      real difference rather than a flag. `buildGroup` takes the BEM block as a parameter, since
      namespacing (`internals__group` / `stats__group`) was the *only* thing that differed between the
      two copies and is exactly why `actions.js` inlined its own four times instead of reusing it.
      New `tests/components.test.js` (13): helper behaviour plus static guards that the duplication
      cannot grow back — no module but `components.js` may build a `.gauge` row, a `.stat` row or a
      group section, and `formatLiters` must have exactly one definition. All broken first.
      Suite 300 → 313.
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

- [x] **RESOLVED — `--state-alert` contrast.** Split each state tier into a fill and an ink:
      `--state-alert` keeps `#c0563f` for borders, gauge markers, gauge fills and the pulse (where
      the alarm actually reads), and the 10 text uses moved to `--state-alert-ink` `#ef8a72`
      (6.1 / 5.7 / 5.0 — AA on every surface). `--state-warn` got the same shape for symmetry;
      `--state-warn-ink` equals `--state-warn` today because warn already cleared AA, and the
      indirection exists so a later warn retune is one line rather than a re-split.
      **My framing of this decision was wrong and was corrected before it was acted on.** I claimed
      reaching AA meant going pinker and losing the alarm quality — that came from searching only
      along the original 51% saturation, which forces lightness up. Searching saturation too finds
      AA-passing reds *more* vivid than the original (`#ff724f`, 100% sat). The split was chosen
      anyway because it fixes the text without touching the fills.
      Now guarded permanently: `tests/css.test.js` measures every text colour against the surfaces
      it actually sits on. That test caught an over-broad assumption in **itself** on first run —
      a blanket surface list failed `--ink-faint` on `--surface-2`, a pairing that never occurs —
      so it now carries a per-ink surface map with the reason for each restriction.
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

## Status: Phase A approved — Phase B underway (V8, V9 landed)

V1, V2a, V2b, V3, V4, V5, V6, V7 landed; **CPV1 approved 2026-07-20**.
V8 and V9 landed 2026-07-20. Suite 289 → **327 green**.

V9 went first despite being nominally parallel: V8 adds decomposition rings to
the internals queue rows that V9 relocates, so landing V9 first kept V8 a clean
diff against a shared `buildStat` instead of a merge against a moving one.

Next: **V10** (home/shop/setup restyle) and **V11** (HUD + speed bar), both now
unblocked. V11 is the last gate before V12's layout rebuild.

Carried into Phase B, unclosed by CPV1:
- The **V5 browser check** — correctness, not aesthetics; due before V12.
- The **`--surface-3` contrast gap** — `--ink-faint` is only 3.5:1 against it, so
  the day V8/V10 gives `--surface-3` a user, `tests/css.test.js` must gain that
  pairing and one of the two values must move. **V8 did not give it a user**
  (icons colour from `--ink-dim`, `--accent` and `--surface-2`), so this is still
  open and now falls to V10.

**Owed from V8 — browser verification, not yet done.** These need a real browser
and are the V8 verify step, carried until someone runs it:
- Switch pt-BR/en/es on the game screen and confirm no icon is wiped
  (finding #1's failure mode is a language switch, not first paint).
- **Lay all 14 food icons out in the chooser grid and confirm they do not
  cluster into two families.** This is the CPV2 review item and the one
  anti-spoiler rule no test can enforce — the guards cover the frame, the weight,
  the canvas and the palette, but not whether the 14 *glyphs* inside those
  identical frames read as organic-vs-manufactured.

CPV1 has been restated in the plan: its original "zero visual change except the
typeface" described a Phase A that no longer exists, since splitting V2b put a
deliberate visual change inside it. The checkpoint now names
`tasks/v2b-computed-value-diff.md` as its primary review artifact.
