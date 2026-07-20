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
      `disposeScene`, no feedback loop (`updateStyle=false`). **Browser check done and clean,
      2026-07-20** — the bin stays pinned under the cursor at several window widths. That closes
      the last item carried out of Phase A, and with it the only gate on V12.
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
- [x] **V10** Home / shop / setup restyle (M) — deps: V2, V7, V8, V9
      The three pre-game screens against the V2b vocabulary. Beyond styling: the
      language selector became one segmented control (three bordered buttons read as
      three decisions; one box with three positions reads as the single choice it is);
      the setup form's inputs were **UA-default white boxes on a dark UI** — on the one
      screen a first-time player must complete unaided — so `base.css` now styles
      `input`/`select` and sets `accent-color`; `#setup-confirm` was visually identical
      to Reroll and is now the primary action it is; the selected species row gets an
      inset accent rule via `:has(input:checked)`.
      **h1/h2 finally use `--text-xl`/`--text-lg`** — both shipped in V2b with no user
      at all while headings ran at the UA's 2em, which made half the type ramp a claim
      the code did not back.
      **`--surface-3` gets its first users** (hovered species row + language rung),
      closing the gap carried out of CPV1. Only `--ink` (9.2), `--ink-dim` (5.3) and
      `--accent` (4.75) clear AA against it; `--state-alert-ink` is **4.3** and
      `--ink-faint` **3.5**. That decided a design question rather than merely recording
      one: **the shop card raises its border on hover instead of its fill**, because its
      "cannot afford" line is `--state-alert-ink` and a raised fill would have pushed it
      under the floor.
      Three guards, each broken against the real sheets first: off-scale spacing/type
      literals (the thing that makes the AC's "no stray literals" able to fail —
      allowlist is exactly the two documented dev-nav clearances), a companion proving
      that walker fires, and **every surface painted in the sheets is covered by the
      contrast map** — the one that would have caught the actual bug, since `--surface-3`
      sat unmeasured for four tasks precisely because nothing forced the question.
      Suite 330 → 333.
- [x] **V11** HUD + speed bar restyle (S/M) — deps: V2, V8
      Six chips → one hairline-divided panel of six gauges (glyph + tracked micro-label
      + tabular value), six new chrome symbols, and the speed bar given the matching
      treatment with its multipliers opting back out of the uppercasing.
      `ico-status` is a **dial, not a tick or a warning triangle**: the same glyph shows
      for "tudo certo" and for a dead colony, so it must stay neutral about the state the
      label and its colour carry. Now an icon rule in `DESIGN.md`.
      **The AC's "stops jittering" was only half-served by tabular numerals.** They fix
      each digit's width so a value never reflows within itself — but a number that GAINS
      a digit still widens, and in a flex row that shoves every cell after it. The score
      crossing 99 → 100 moved four cells with tabular figures fully in effect.
      `.hud__value` also reserves `min-width: 4ch`; past four digits the strip reflows
      once more, a rare event rather than a per-tick twitch. `DESIGN.md` states the
      reservation as part of the requirement, since the same trap waits at every readout
      with neighbours.
      Guards (broken first): HUD readouts tagged for tabular numerals — with the id list
      **derived from `hud.js`**, so the real failure (a seventh readout added without the
      markup) is what it catches — plus a check that `.hud__value` actually declares
      `tabular-nums`; and every `[data-speed]` is a value `initSpeed` accepts, which
      silently ignores anything else and leaves a button that looks live and does
      nothing. Suite 333 → **335**.
      The colon text nodes left the HUD, home and shop: a bare text node in a flex row
      becomes its own flex item, so each ":" floated between two gaps. No i18n key moved.
- [x] **CPV2 — APPROVED by the maintainer, 2026-07-20.** Phase B signed off; Phase C unblocked.
      **Machine-verified at the gate:** 335 tests green; every `<use>`/`icon()` resolves to a
      symbol and no symbol is dead; the 14 food icons share one canvas, one byte-identical
      frame, one stroke weight, one glyph-group tag and `currentColor`/`none` only; no
      `[data-string]` element contains an `<svg>`; every text colour ≥ WCAG AA on the surfaces
      it occupies; every surface painted in the sheets is measured against an ink; no colour
      literal and no off-scale spacing/type literal outside `tokens.css`; every HUD readout
      tagged for tabular numerals; every `[data-speed]` a value `initSpeed` accepts.
      **Walked in a real browser by the maintainer, and clean** — these are the items no test
      in this project can reach, and unlike CPV1 they were *measured by eye rather than
      accepted on judgement*:
      - **The 14-food clustering check.** All 14 laid out in the chooser grid; they do not read
        as organic-irregular vs manufactured-regular. This is the one anti-spoiler rule no test
        can enforce, and the whole uniform-treatment discipline exists to make it pass.
      - Icons survive a pt-BR/en/es switch on the game screen — finding #1's actual failure
        mode is the switch, not first paint, so the tripwire alone was never sufficient here.
      - shop → setup completes unaided in all three locales (the T22 criterion, V10's AC).
      - `:has(input:checked)` paints the selected species row (it degrades silently to the bare
        radio, so no test and no reviewer of the diff could have told either way).
      - No HUD digit jitter at 20×, across the 99 → 100 and 999 → 1000 crossings — the second
        is what exercises the `min-width: 4ch` reservation, and the first is what proved
        tabular numerals alone were not enough.
      **Not closed by this approval:** the V5 browser check below. It is drag-raycast
      correctness rather than appearance, it is a different exercise (resize + drag at several
      widths), and it remains due before V12 — the task that would otherwise expose the bug
      V5 fixed.

## Phase C — Game-screen layout

- [x] **V12** Three-column grid; internals → left column; delete `internalsSide` + its 5 tests (M) — deps: V5, V11
      The panel is out of the canvas overlay and into its own grid track, and the dodge
      machinery went with it: `internalsSide`, its two thresholds, `placeInternals`, four call
      sites, `.internals--right` and 5 unit tests, **deleted rather than skipped**.
      `--surface-1-alpha` went too — it existed only so the panel could show the 3D scene
      through itself, and had zero users the moment the column became opaque. A dead token is
      exactly what V2a refused to leave behind, since no test can catch one.
      **A decision the plan left contradictory, resolved with the maintainer before coding.**
      The specified tracks are all viewport-sized, so collapsing a panel could never resize the
      canvas — which made this task's own AC clause ("drag stays pinned … with panels
      collapsed/expanded") and the whole rationale for re-walking the V5 check **vacuous**, and
      would have left a 280px empty gutter where the overlay used to hand its area back.
      Chosen: `:has(#internals:not([open]))` shrinks the track to `auto`. The behaviour is
      preserved, the AC can now fail, and `:has()` degrades to the fixed column where absent.
      Four guards, each broken deliberately first. The one that matters most is **finding #3's
      tripwire**: both readout panels must be open `<details>`, because the repaint guards read
      `panel.open` and that is `undefined` on every other element — a `<div>` renders blank
      forever with no error. This is precisely the edit that invites "it's just a box now".
      Also: `#internals` is never inside `#stage`; no dangling reference to the deleted
      machinery survives **in code or in prose**; and every `grid-area` resolves to a declared
      template area and back. That last one **caught a real coupling** — `grid-area: readouts`
      was in components.css while the template was in screens.css, so placement moved next to
      the grid and components.css kept appearance only. A `grid-area` typo does not warn: it
      drops the element into an implicit track, which over a WebGL region reads as a stretched
      scene rather than as a CSS bug. Banner cap `min()`-ed for the narrower centre.
      Suite 335 → **337** (5 deleted, 7 added).
- [x] **V13** Internals density pass: sub-grid, unified gauge, decomposition rings (M) — deps: V12, V9
      The unified gauge and the decomposition rings already landed (V9, V8), so this was the
      sub-grid — and **as specified it would have done nothing at all.**
      Two independent reasons, both silent. (1) The readouts track caps at 340px and two 220px
      `auto-fit` columns plus their gap need 456px, so it would have laid out **one column at
      every width, including 1920px**; auto-fit does not warn when it cannot fit another column,
      so the density pass would simply not have happened and the AC would have been read as met.
      Fixed by widening the track to `minmax(480px, 560px)` at ≥1600px — deliberately *lower*
      specificity than the `:has()` collapse rule, so a collapsed panel keeps `auto` at every
      viewport. (2) `updateInternals` built everything into a wrapper `<div>`, so the grid would
      have had exactly **one** item. `fill` already takes varargs and does `replaceChildren`, so
      the wrapper is gone and the groups are direct children — no new class, no new element.
      Consequences worth recording: the model line spans the row (`grid-column: 1 / -1`) instead
      of becoming a cell beside the first group, and `.internals__group`'s `margin-bottom` is
      retired in favour of the gap — margins ADD to a grid gap, and `:last-child` stops meaning
      "the bottom one" the moment there are two columns.
      New guard, **broken in both directions first** (a 340px track, then a raised 300px column
      minimum; each failed naming the exact arithmetic): the wide track must actually fit two
      sub-grid columns. The two numbers live in different rules in different files and the
      failure mode is invisible — no error, no visible breakage, just a density pass that never
      happens. It is the bug this task shipped with, so it is asserted, not eyeballed.
      Suite 337 → **338**.
- [x] **CPV3 — APPROVED by the maintainer, 2026-07-20.** Phase C signed off; Phase D unblocked.
      **Machine-verified at the gate:** 338 tests green; both readout panels are open
      `<details>` (finding #3); `#internals` is a grid child of `.screen--game` and never
      inside `#stage`; every `grid-area` resolves to a declared template area and back; no
      dangling reference to the deleted dodge machinery in code or prose; the wide-viewport
      track provably fits two sub-grid columns; and every guard carried over from CPV1/CPV2
      still holds — no colour or off-scale literal outside `tokens.css`, every text colour
      ≥ WCAG AA on the surfaces it occupies, every painted surface covered by the contrast map.
      **Walked in a real browser by the maintainer, and clean.** Recorded as the **blanket
      confirmation it was given as** — "everything runs fine" — rather than itemised: the five
      checks listed under Open items were the ones put to the maintainer, and inventing
      per-item findings they did not report is exactly the sort of dressed-up record CPV2 was
      careful to avoid. What that gate did differently was state which calls were *measured*
      and which were *accepted on judgement*; this one is a single confirmation covering the
      set, and the set is written down above it.
      **Unchanged since the CP9 freeze, and not touched by either task:** the scoring formula
      and the save schema. Phase C moved layout only — no `js/sim/` file appears in either
      commit. CPV5 re-asserts this explicitly; noting it here keeps the claim continuous
      rather than reconstructed at the ship gate.
      **The load-bearing item was the drag re-walk.** It is the one thing carried unclosed
      through CPV1 and CPV2 on the grounds that it is *correctness*, not appearance, and V12
      is the task that re-armed it: collapsing the panel now genuinely resizes the canvas via
      the `:has()` track shrink, so the ResizeObserver path was exercised by a layout change
      rather than a window resize for the first time. That is what closes it properly.

## Phase D — 3D richness

- [x] **V14** ACES tone mapping + retire `LIGHT_GAIN` + `toneMapped:false` opt-outs (M) — deps: V5
      **Code complete; the 3D visual matrix was walked and approved at CPV4, 2026-07-20.**
      `outputColorSpace` left alone (finding #4 in the plan was right: r170 already defaults it).
      Four corrections, all found by checking the task's numbers **before** implementing:
      **(1) The mitigation missed a material, inside the layer it exists to protect.** The plan
      opts out `solidMaterial()` and the sun patch, but the leachate liquid is built inline with
      its own material (translucent, so the tank reads as wet). It would have been the one x-ray
      internal still going through ACES while the humus it pools under did not. The palette only
      works as a calibrated **set**, so the guard checks *every* emissive material in `xray.js`
      rather than trusting the shared helper to be the only place it matters.
      **(2) The sun-patch opt-out is right, for the opposite reason to the one given.** The plan
      frames it as protection from ACES "crushing" the patch; ACES **lifts** midtones
      (0.2 → 0.30, 0.5 → 0.62), so mapping it would have made it *brighter*. The real reason is
      **shape**: Three tone-maps per material before blending, so a mapped additive overlay gets
      its own gradient curved and its falloff flattened — and that gradient IS the information,
      since it traces `solarGain` and must keep tracking the bin's temperature advantage.
      Brightness is what the knob is for: `SUN_PATCH_STRENGTH` 0.6 → 0.35, because the old value
      was calibrated against a wall that clipped at midday and no longer does.
      **(3) Deleting `LIGHT_FLOOR` drops an invariant with nothing left to hold it.** The floor
      was *structural* — added after the fact, so no authored keyframe could darken the bin past
      it. Folded into the table it is merely authored, and its AC ("dawn/noon/dusk/midnight all
      read correctly") cannot fail in CI. Now tested at the exact old values (ambient 0.49,
      total 1.45), plus the two properties a hand-retyped 10-row table loses in silence:
      ascending hours (`sampleDayCycle` falls back to the first/last keyframe rather than
      throwing, freezing a stretch of the day) and the h:24 → h:0 midnight wrap.
      **(4) A comment claiming "no tone-mapping curve is needed"** — argued from light
      *intensity* staying under the pre-r155 PI-scaled intent, which bounds the input to the
      lighting equation, not the radiance reaching the framebuffer. Rewritten, not left standing
      beside the curve it calls unnecessary.
      **The fold is proven invisible.** A one-time equivalence test reconstructs
      `floor + 1.9 × curve` across all 30 values, and the folded table independently reproduces
      the totals the old comment documented (4.80 noon / 1.45 midnight / 3.30×). That leaves
      **ACES and its exposure as the only variable the matrix has to judge** — the V2a pattern,
      and it retires the same way: the first deliberate re-tune SHOULD fail it, and the fix is
      to delete it, never to update its numbers. All five guards broken first. Suite 338 → **344**.
- [x] **V15** `js/render/textures.js` CanvasTexture surfaces + fix the `material.map` leak (M) — deps: V14
      **Code complete; the browser half of the AC is NOT walked — folded into the V14 matrix
      owed before CPV4, since it is the same walk.** Seeded fractal value noise into a 256²
      canvas, one texture each for wall plaster, floor concrete and packed earth, all repeating
      at one shared physical scale (2 world units). The canvas is a *sink*, not a participant,
      so the whole numeric half runs and is tested under Node.
      **Three of the task's premises did not survive being checked, which is now the Phase C/D
      pattern rather than a surprise.**
      **(1) "PlaneGeometry already has UVs, so only `repeat` needs setting" — the soil is a
      `BoxGeometry`.** Its faces carry 0..1 UVs over three different world sizes (top 12×8,
      front 12×2.2, side 2.2×8), so one `repeat` pair cannot be right for more than one, and
      the buried x-ray has two of them in frame. Sized to the top face — the cutaway the x-ray
      exists to show; the front sliver stretches ~3.6×. Per-face materials would buy that
      sliver for six materials to build and free.
      **(2) The plan's real hazard was not the leak it names.** A colour map MULTIPLIES albedo,
      so a grain ramping to 1.0 necessarily averages below it: attaching these maps darkens the
      stage by **14 / 19 / 28%**. That is a *lighting* change wearing a texture change's
      clothes, and it would have landed as an apparent exposure shift under V14's ACES curve —
      **whose visual matrix is still owed and unwalked.** V14 worked hard to leave that matrix
      exactly one variable to judge; this would have quietly made it two, and the reviewer would
      have had no way to tell which of the two they were looking at. `grainMean()` measures the
      darkening from the generated bytes **in linear space** and `scene.js` divides it out.
      Measuring it in sRGB — the obvious shortcut, and what the mid-ramp *looks* like — would
      under-compensate every surface, because sRGB compresses the darks (a 0.92 floor is a
      linear 0.83). Measured, never typed: the V14 lesson about two representations of one
      brightness with one hidden in a constant.
      **(3) The AC clause "upgrading models repeatedly does not grow texture memory" is
      vacuous as written.** V15 dresses wall/floor/soil — scene-ROOT meshes built once and never
      rebuilt on upgrade — and no composter material has a map at all. The named leak therefore
      cannot fire today. Fixed anyway and made non-vacuous by planting maps the builders do not
      have, on both the single and array paths; generalised to every texture slot, since a
      surfacing pass sets `map` + `roughnessMap` together and a fix for the one property the
      plan named would leak the rest. The **real** unowned resource was the opposite one:
      `disposeScene` never freed the scene-root surfaces, which `disposeComposterMesh` cannot
      reach. Both closed.
      **Two guards had to be fixed after failing to fail** — the V6 discipline earning its keep
      twice in one task. A `paintGrain` writing flat white passed the amplitude check, and flat
      white is worse than no map here: `grainMean` measures the field independently, so
      `scene.js` would have *brightened* every surface to cancel grain that was not there. And
      the "no map assigned outside the compensating builder" walker matched a bare `map` but not
      `extra.map`, so a planted fourth surface sailed through. Both widened and re-broken.
      **One correction to my own work, not the plan's:** the grain amplitudes shipped a step
      stronger while the comment beside them called the result "faint" — 25/36/49% albedo swing
      in linear terms is mottling, and soil's mean sat 2.6% from the bound guarding it. Softened
      to 17/25/36% so the intent and the arithmetic agree. Nothing in this repo can see them, so
      they start conservative and the matrix decides; raising one is a single edit, since the
      mean re-measures and the compensation follows.
      11 guards broken deliberately first. `DESIGN.md` gains a surface-grain section (one
      physical scale, linear-space amplitude, never change brightness) and two deviation rows.
      Suite 344 → **365**.
- [x] **V16** Contact-shadow blob (S) — deps: V6, V15
      **Code complete; browser walk folded into the CPV4 matrix.** One blended plane per
      above-ground model, sized from its footprint, one draw call, zero per-frame work.
      **DEVIATION: built in `composter3d.js`, not `scene.js` as the plan files it.** Everything
      about the blob is a property of the model — sized from its footprint, parented to its
      group, freed with it — and building it there put it where a **real `Raycaster`** could
      test it, which is what caught the one non-obvious bug: **the blob silently joined the drag
      grab target.** `raycastComposter` intersects `composterGroup` recursively, so a pickable
      blob let the bin be grabbed from bare floor up to 1.6× its footprint away, with the hover
      cursor reading `grab` over empty ground — a change to a T19 interaction re-verified at V12,
      made by a decoration. `blob.raycast` is now a no-op, guarded by a real ray **plus** a
      companion proving that ray would otherwise hit it (the V6 vacuity check).
      The plan asks for both "one soft radial-gradient CanvasTexture" **and** "disposed including
      its texture" — incompatible, because the blob hangs off `composterGroup` and V15 made
      `disposeComposterMesh` free textures, so a shared one would be **dead for every model after
      the first upgrade**. Each blob owns its own; a 128² gradient built once per upgrade.
      `composterFootprint()` reads `structureOf`, like `composterCavity`, so the blob tracks the
      silhouette — which **caught the V18 lathe-segment bug two tasks later**. Tagged `xrayPart`
      so the x-ray sweep leaves it opaque; skipped for buried. The V15 map-compensation guard
      fired on arrival and was answered with an argued allowlist entry (`SANCTIONED_MAPS`), since
      the blob is an unlit `MeshBasicMaterial` with no albedo to preserve. 8 guards broken first.
      Suite 365 → **380**.
- [x] **V17** Gradient sky backdrop via `vertexColors` (S/M) — deps: V14 (∥ V15/V16)
      **Code complete; the gradient is in the CPV4 matrix.** A backdrop mesh behind the wall,
      per-vertex colours lerped each frame from the live sky colour — the exact `sunPatch`
      technique, 66 vertices, no `ShaderMaterial`/`PMREM` (the camera is fixed). The gradient
      **scales `DAY_CYCLE`'s own `sky` column** rather than carrying a second palette, so it
      cannot drift from V14's folded table.
      Three numbers reasoned about rather than picked, all failing silently otherwise:
      **(1)** anchored where the **wall top projects** to the backdrop, not the plane centre —
      the wall occludes the plane's bottom, so a centred gradient hides its own neutral point and
      every visible sky pixel reads darker than the colour it replaces, a global sky change in a
      gradient's clothing. Derived from the camera and `WALL_HEIGHT`.
      **(2)** the deviation is **multiplicative**, because Three works in linear space where the
      night keyframes are ~0.01 — a fixed additive delta tuned at noon clamps the whole night sky
      to black and the gradient vanishes for half the day. That then needs the **opposite** guard
      (a bright keyframe clipping the horizon past 1.0), and both are tested.
      **(3)** `toneMapped: false`, load-bearing: `scene.background` is a clear colour and is not
      tone-mapped, so a tone-mapped backdrop pushes the same values through ACES's midtone lift
      and jumps the whole sky brighter. `fog: false` likewise. Also fixed `skyGradientFactor`
      returning `-0` at its anchor rather than loosening the test. 4 guards broken first.
      Suite 380 → **384**.
- [x] **V18** Lathe / Extrude silhouettes (M) — deps: V6
      **Code complete; distinctness + upgrade-leak walks are in the CPV4 matrix.** Eco barrel →
      ribbed lathe, buried collar/dome → lathes, tray rims/lids → extruded rounded rectangles.
      Flat shading and low segment counts kept (DESIGN.md identity).
      **The V16 footprint guard earned its keep immediately.** The lathes first shipped at **10
      segments**, and a lathe puts vertices at `j·2π/N`, so its bounding box reaches the profile
      radius on a ground axis only if `N` is divisible by 4. At 10 the widest vertex sits at 72°,
      so the eco barrel was `1.902r` across in X while `composterFootprint` reported `2r` — and
      the contact shadow **silently stopped matching the silhouette**. Segment count is now 12
      with the constraint asserted directly. The same coupling forced the eco ribs **inward** as
      grooves, not outward as protrusions (a rib past `r` widens the real silhouette while the
      shadow keeps the old size).
      **DEVIATION:** "one lathe replaces three cylinders" for buried became **three lathes**,
      because the three parts carry three different colours and one lathe is one material —
      merging them collapses the colour break at the ground line, which is the main "in the
      ground" read and this task's own AC. Geometry win kept where it matters (capped drum,
      flared collar, genuinely curved dome).
      New guards: lathe segments reach full radius on both axes; the reshaped models actually use
      lathes/extrusions (else a revert to primitives is invisible, since cavity/footprint tests
      were written to survive the reshape); tier counts still read in geometry; every surface
      still flat-shaded. Failure labels spelled out because the vendored Three is minified and
      `Ctor.name` reads `"hu"`. **Process note:** a `git checkout` while breaking a guard
      discarded V18's uncommitted source once; redone and committed immediately. 5 guards broken
      first. Suite 384 → **388**.
- [x] **V19** Real shadow maps + x-ray `castShadow` protocol — **gated at 2 ms, droppable** (M) — deps: V14, V16
      **Code complete; shadows default ON. THE PERF-GATE DECISION IS OWED — see below.** The gate
      as written could not be evaluated, for the four reasons the checklist Status section already
      flagged plus one. This task makes it **answerable** rather than making the call:
      **(1)** the `?dev=1` frame-time readout the gate is "measured via" **did not exist** — built
      it (`renderStats()` + a dev-nav readout of ms/fps/calls/tris/shadow-state, throttled ~4Hz);
      **(2)** the gate is a **delta** ("more than 2 ms"), unmeasurable from one number — added
      `?shadows=0/1` so the same scene is measured both ways in one session;
      **(3)** "at 1×" is the wrong axis — `renderState` runs every rAF regardless of speed, so
      cost is **caster-count** dependent (model + x-ray), not speed; the readout comment says so;
      **(4)** `sunLight.target` was **never in the scene graph**, so V19's core mitigation
      (re-target each frame for a tight shadow camera) was a documented no-op — parented in
      `buildScene`.
      X-ray protocol (the plan's named risk): the shadow pass ignores opacity, so a faded shell
      keeps casting solid; `setShellTransparency` now also stashes/restores each **mesh's**
      `castShadow`, kept apart from `setMaterialFade` because it lives on the Mesh not the
      material, and restoring the **actual** prior value (not blanket `true`) so the contact blob
      never starts casting after a toggle. Beyond the plan: `autoUpdate=false` with `needsUpdate`
      throttled every 4th frame (forced on drag/upgrade/x-ray), `mapSize` 1024, tight ortho,
      slope bias. Sun patch / soil / sky / blob excluded from casting by name. 10 guards broken
      first. Suite 388 → **398**.
- [x] **CPV4 — APPROVED by the maintainer, 2026-07-20.** Full 3D pass walked; Phase D signed off,
      Phase E (V20) unblocked.
      **Recorded as the blanket confirmation it was given as** — "it seems fine" across the set —
      not itemised, on the CPV3 precedent: the maintainer walked it, and inventing per-model
      findings they did not report is the dressed-up record CPV2/CPV3 were careful to avoid. The
      set put to them is the one written under "Owed before CPV4" below: the dawn/noon/dusk/midnight
      × x-ray × 6-model matrix, x-ray legibility under ACES, the sky gradient and fog match, the six
      models still distinct, and the shadow interaction.
      **The one load-bearing DECISION inside this gate — the shadow perf gate — resolved to KEEP
      SHADOWS ON.** The maintainer engaged the A/B (`?dev=1` vs `?dev=1&shadows=0`) and found it
      fine, so `SHADOWS_DEFAULT` stays `true` and V19 ships rather than being dropped for V16's blob
      alone. No frame-time figure is recorded because none was reported — the gate was a "fine / not
      fine" call at the readout, and writing a millisecond number I was not given would be the same
      fabrication the itemising rule forbids. Reversing it is still one line (`SHADOWS_DEFAULT =
      false`) if the budget is revisited on other hardware.
      **Nothing in `js/sim/` was touched by any Phase-D task** — the scoring formula and save schema
      are unchanged since the CP9 freeze. CPV5 re-asserts this at the ship gate; noted here to keep
      the claim continuous.
      **Not reachable by `node --test` and therefore genuinely closed only by this walk:** everything
      about a tone curve, a gradient, a shadow and a silhouette. Unlike CPV1 there was no
      computed-value-diff analogue to review in its place — the matrix itself was the artifact, and
      the guards only ever held *structure* (the fold's invisibility, the footprint↔silhouette tie,
      the x-ray `castShadow` protocol), never *appearance*.

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
- [x] **RESOLVED — V5 browser check, 2026-07-20.** Walked by the maintainer: resize the window,
      drag the bin at several widths, and it stays pinned under the cursor. ResizeObserver has no
      automated coverage and never will here — it needs a real browser, a real layout change and a
      real pointer, none of which `node --test` has.
      Carried deliberately from Phase A through two checkpoints rather than being folded into
      either: CPV1 and CPV2 were both *appearance* gates, and this is drag-raycast **correctness**.
      Ticking it inside an aesthetic sign-off would have buried a functional check in a list of
      visual ones — which is exactly how a stale `camera.aspect` ships unnoticed.
      **This was the last gate on V12**, which is the task that would otherwise have re-exposed
      the bug V5 fixed: V12 changes the grid *and* makes a collapsing panel resize the canvas, so
      it exercises the ResizeObserver path far harder than anything shipped so far. Re-walk the
      drag check at the end of V12 — the verify step there is not a formality.
- [x] **RESOLVED — browser verification of V12/V13, 2026-07-20.** Walked by the maintainer and
      confirmed clean across the set below. This also closes the **V5 drag re-walk**, which had
      been carried deliberately through CPV1 and CPV2 as a correctness item rather than an
      aesthetic one; V12 is the task it was being held for. None of this is reachable by
      `node --test`, and three of the items below are of the kind CPV2 proved a diff-read cannot
      catch either. To be walked on desktop with `npx serve .`:
      - **The drag re-walk (V5's check, re-armed).** Drag the bin at 3+ window widths **and with
        the internals panel collapsed and expanded**. Collapsing now genuinely resizes the
        canvas — that is what the `:has()` track shrink is for — so this is the first time the
        ResizeObserver path is exercised by a layout change rather than a window resize. Drift
        means a stale `camera.aspect`.
      - **`<details>` collapse → tick → expand, on BOTH panels, including while paused.** The
        finding-#3 tripwire proves the elements are still `<details>`; it cannot prove the
        memoized repaint still works. Content must come back current, not stale or blank.
      - **The sub-grid at 1366 / 1600 / 1920.** Two columns above 1600, one below, no clipping
        at 1366, and the whole panel readable without scrolling at 1920 (V13's AC). A guard now
        proves two columns *can* fit; only a browser proves they *do*, and that the result reads
        as denser rather than merely wider.
      - **`:has()` on the game screen.** It degrades silently — exactly the trap V10 hit with
        `:has(input:checked)`, which no test and no reviewer of the diff could have told either
        way. If the track does not shrink on collapse, the layout still looks fine.
      - **One §2.8 failure chain at 20×**, to confirm the panel still narrates it after the
        groups were re-flowed (V13's AC).
- [x] **RESOLVED at CPV4, 2026-07-20 — the 3D visual matrix, walked by the maintainer.** The
      questions below are kept as the record of *what* was put to the walk; the answer across the
      set was "fine", and the shadow perf gate resolved to keep shadows on (see the CPV4 entry
      above). Nothing about a tone curve is
      reachable from a green suite, and unlike CPV1 there is no computed-value-diff analogue to
      review in its place. The matrix **is** the artifact: dawn / noon / dusk / midnight ×
      x-ray on/off × each of the 6 composters, recorded in `tasks/visual-overhaul-playtest.md`.
      The fold being provably invisible means every difference seen is the curve or the
      exposure, nothing else — so the questions are narrow:
      - **X-ray legibility on all 6 models** — the criterion the plan calls most at risk. The
        internals opt out entirely, so they should look *unchanged*; if they moved, an emissive
        material escaped the opt-out (the leachate tank is the one to check first).
      - **`TONE_MAPPING_EXPOSURE` is a judgement, currently 1.0.** It is the one number in V14
        that is not a measurement. If midday reads flat or night reads muddy, this is the knob.
      - **`SUN_PATCH_STRENGTH` 0.35 is an estimate, not a measurement.** At noon the band must
        still visibly track the bin's temperature advantage as the slider moves — that coupling
        is the one thing the plan's risk table says never to break.
      - Dawn/dusk transitions still perceivable at 1×, and the patch still vanishing at night.
      **If the table gets re-tuned by eye as a result, delete the equivalence test** — it exists
      to prove the fold was invisible and means nothing once the values are authored against the
      curve. Do not update its numbers to match.
      **V15 joins this same walk rather than owing a second one** — it dresses the very surfaces
      the curve is judged on, so they cannot honestly be looked at separately. Its questions are
      narrow for the same reason V14's are: the grain is compensated to leave mean radiance
      unchanged, so anything that reads as a *brightness* change is a bug in the compensation
      rather than a taste call. What is genuinely open:
      - **The three `grainMin` amplitudes** (wall 17%, floor 25%, soil 36% albedo swing in
        linear terms) are the one judgement in `textures.js`, and they are deliberately
        conservative — the first pass was a step stronger and read as mottling on the numbers.
        If the surfaces still read as flat planes under the curve, this is the knob.
      - **No tiling seams** at the wall's 6×2.25 and the floor's 6×4 repetitions. A guard proves
        the *field* is continuous across its own edge; only a browser proves the repeat is what
        the eye sees.
      - **Soil grain in the buried x-ray only** — the top face is sized correctly, the front
        sliver below the floor's leading edge is stretched ~3.6× by construction. Confirm the
        stretch is as unobtrusive as the DEVIATION assumes.
      - **Wall grain must not compete with the sun patch.** The patch's gradient is the one thing
        on that wall carrying information; if the plaster reads as pattern, the amplitude is wrong
        regardless of how it looks on its own.
      **V16–V19 join the same single walk** — every one of them changes the same 3D frame, so they
      are judged together across the same dawn/noon/dusk/midnight × x-ray × 6-model matrix, not in
      four separate passes. What each adds to the questions:
      - **V16 contact shadow** — the bin must read as sitting ON the floor at every wall position,
        and the blob must **survive the x-ray toggle** (it is tagged `xrayPart`, so it should stay
        while the shell fades; if it vanishes the tag was lost). No leak cycling models via the shop.
      - **V17 sky gradient** — a visible gradient at every hour, dawn/dusk still perceivable at 1×,
        and **fog still matching the sky** (the backdrop opts out of fog, the scene does not, so a
        mismatch at the far edges is the thing to look for). No brightness jump vs the old flat sky —
        if the whole sky moved, the `toneMapped:false` or the wall-top anchor is wrong.
      - **V18 silhouettes** — all 6 models still read as **distinct at a glance** (tier counts
        visible, buried in-ground, electric distinct), and **upgrade still swaps the mesh live with
        no leak**, x-ray on and off. `tests/composter3d.test.js` now *means* something here since it
        fails on cavity drift.
      - **V19 shadows — TWO judgements, one of them the perf gate:**
        - **The perf-gate DECISION is owed and is the maintainer's.** Load `?dev=1`, read the ms
          figure, reload `?dev=1&shadows=0`, compare. **> 2 ms of shadow cost → set
          `SHADOWS_DEFAULT = false` and ship V16's blob alone.** Vary the **composter model and the
          x-ray toggle** while measuring, NOT the game speed — shadow cost is caster-count
          dependent and speed-independent (`renderState` runs every rAF regardless of the clock).
          The eco (most triangles) with x-ray off is the worst case to check.
        - **The x-ray shadow interaction**, which the plan calls the risk: x-rayed bins must cast
          **no solid shadow** (walk the full x-ray matrix — toggle ≥3× per model, upgrade while
          x-rayed, buried↔tier3 while x-rayed), and the shadow **direction must track the sun**
          across the day. A solid slab beside a see-through bin means the mesh-level `castShadow`
          stash did not fire.
- [ ] **V20 candidate — `disposeScene` leaves scene-root geometry/materials unfreed.** It frees
      the composter group and the renderer but not the wall / floor / soil / sun-patch / sky-backdrop
      **geometries and materials** (V15 closed it for its three textures; V17's backdrop added one
      more unfreed root mesh). Not a leak in the single-page happy path — the scene lives for the
      page's lifetime — but `disposeScene`'s own JSDoc claims a tidy teardown that is now further
      from true. Fold into V20's audit sweep, or leave with eyes open.
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

## Status: Phases A–D approved — Phase E (release) is all that remains

V1, V2a, V2b, V3, V4, V5, V6, V7 landed; **CPV1 approved 2026-07-20**.
V8, V9, V10, V11 landed and **CPV2 approved 2026-07-20**.
V12, V13 landed and **CPV3 approved 2026-07-20**. Suite 289 → **338 green**.

**All of Phase D has landed and CPV4 is approved (2026-07-20)** — V14, V15,
V16, V17, V18, V19, suite **338 → 398 green**. The maintainer walked the 3D
matrix and found it fine; the shadow perf gate resolved to **keep shadows
on** (`SHADOWS_DEFAULT` stays `true`). The only C-0003 work left is **Phase
E: V20** (audits + spec §6 checklist + deploy dry run) and **CPV5** (ship
gate). V20 is now unblocked — its deps were V13 (done) and V19 (done).

Landed in this session, in dependency order:
- **V15** (surfaces + dispose leak) — 344 → 365, three commits.
- **V16** (contact shadow) — 365 → 380. Built in `composter3d.js` not
  `scene.js`, which is what let a real `Raycaster` catch the blob joining
  the drag grab target.
- **V17** (sky gradient) — 380 → 384. Multiplicative deviation off
  `DAY_CYCLE`'s own sky column, anchored at the wall-top projection.
- **V18** (lathe/extrude) — 384 → 388. The V16 footprint guard caught the
  10→12 segment bug; the whole `js/render/scene.js` teardown gap noted
  below is still open but did not bite, since V18 adds nothing to the root.
- **V19** (shadow maps) — 388 → 398. Made the perf gate answerable
  (built the readout, added `?shadows=`, parented `sunLight.target`, fixed
  the "at 1×" axis); the call was then made at CPV4 — **shadows kept on**.

**Still open, carried forward from V15's note:** `disposeScene` frees the
composter group and the renderer but NOT the scene-root wall / floor / soil
/ sun-patch / **sky-backdrop** geometries and materials. V15 closed it for
its three textures and V19 added nothing to the root, but V17's backdrop is
one more unfreed root mesh. Not a leak in the single-page happy path (the
scene lives for the page's lifetime), but the tidy-teardown claim in
`disposeScene`'s own JSDoc is now further from true. A candidate for V20's
audit sweep.

**V19's gate was NOT ready when this session began, for a reason found the same way as V14's four.**
Its gate — "if shadows cost more than 2 ms per frame at 1×, drop V19" — is to be
"measured via a `?dev=1` frame-time readout". **That readout does not exist.**
`?dev=1` toggles a nav bar and `window.setLang`; `renderer.info` is read nowhere;
there is no frame timing in the repo. So the gate cannot be evaluated without
first building an instrument no task owns — inside a task already marked
droppable. Two further problems in the same gate:
- **`sunLight.target` is never added to the scene** (`scene.js:430-433`). V19's
  core mitigation is re-targeting it to `composterGroup.position` each frame to
  keep the ortho shadow camera tight. Three only updates `matrixWorld` for
  objects in the scene graph, so moving an unparented target is a **documented
  no-op** — it works today purely because it sits at the origin with an identity
  matrix. The moment V19 moves it, the shadow camera silently stays centred on
  world origin while the bin slides along the wall.
- **"at 1×" is not the axis that matters.** `renderState` runs every rAF
  regardless of game speed (main.js says so explicitly), so shadow cost is
  speed-independent. What moves it is caster count — which composter, and
  whether x-ray is on — and the gate names neither.
Also unconsidered by the plan's mitigation list: `shadowMap.autoUpdate = false`
with `needsUpdate` throttled to every Nth frame. At 1× a full day is a real
minute, so a few-frame stagger should be imperceptible — a middle option between
paying full cost and dropping V19 outright.

**What Phase C says about the plan itself.** Both tasks had a specified design
that could not do what the task's own AC claimed, and in both cases the failure
would have been *silent* — a vacuous drag check in V12, and a sub-grid that lays
out one column forever in V13. Neither would have shown up as a failing test, a
console error, or an obviously broken screen; both would have been ticked off a
green suite. Phase D's tasks are written in the same style (V19's 2 ms shadow
gate is the same shape of claim), so the lesson to carry is to check a task's
numbers against each other **before** implementing it, not after.

V9 went first despite being nominally parallel: V8 adds decomposition rings to
the internals queue rows that V9 relocates, so landing V9 first kept V8 a clean
diff against a shared `buildStat` instead of a merge against a moving one.

Next: **V12** (three-column grid) — **now fully unblocked.** The V5 browser check
was the last gate on it and was walked clean 2026-07-20.

Worth noting for CPV4: the three gates so far differed in kind. CPV1's visual
calls were *accepted on judgement* because nothing could measure them; CPV2's
were **walked in a browser and confirmed** item by item, including the 14-food
clustering check; CPV3's were walked and confirmed as a **set**, against a list
of five checks fixed in advance.

**CPV4 is CPV1-shaped again, and that is the risk.** X-ray legibility under
ACES and day/night readability cannot be measured by anything in this repo, and
unlike CPV1 there is no `tasks/v2b-computed-value-diff.md` equivalent to review
in place of seeing it — a computed-value diff exists for CSS tokens and has no
analogue for a tone curve. The 3D visual matrix (dawn/noon/dusk/midnight ×
x-ray on/off × 6 composters) **is** the artifact, so it has to be walked and
recorded in `tasks/visual-overhaul-playtest.md`, not inferred from a green
suite. Phase C is also a warning here: both its tasks shipped a spec whose own
numbers did not work, silently, and V19's 2 ms shadow gate is the same shape of
claim — check Phase D's numbers against each other before implementing them.

Carried into Phase B, unclosed by CPV1 — **both now resolved:**
- ~~The **V5 browser check**~~ — **DONE 2026-07-20.** Walked separately from CPV2
  on purpose: it is drag-raycast correctness, not appearance, and folding a
  functional check into an aesthetic sign-off is how a stale `camera.aspect`
  ships unnoticed. **Re-walk it at the end of V12** — that task changes the grid
  *and* makes a collapsing panel resize the canvas, so it exercises the
  ResizeObserver path harder than anything shipped so far.
- ~~The **`--surface-3` contrast gap**~~ — **RESOLVED in V10.** It got its first
  users (hovered species row + language rung), so the pairing had to be decided
  rather than deferred. `--ink`/`--ink-dim`/`--accent` clear AA on it;
  `--state-alert-ink` (4.3) and `--ink-faint` (3.5) do not and **must not be
  placed there**. The constraint changed a design decision: the shop card raises
  its border on hover rather than its fill, because its "cannot afford" line is
  `--state-alert-ink`. A new guard now fails on **any** surface painted in the
  sheets that no ink has been measured against, so the next `--surface-N` cannot
  repeat this — sitting unmeasured for four tasks was possible only because
  nothing forced the question.

**~~Owed from V8 and V10/V11 — browser verification~~ — DONE, walked clean at
CPV2 (2026-07-20).** All six items closed by the maintainer in a real browser:
the 14-food clustering check, icon survival across a pt-BR/en/es switch, the
unaided shop → setup flow in all three locales, `:has(input:checked)` painting
the selected species row, HUD jitter at 20× across both digit-count crossings,
and the `body.dev-mode` clearance after the HUD's vertical padding moved from the
container onto the cells. Details in the CPV2 entry above.

**The pattern worth keeping.** Every one of those six was invisible to the suite,
and three of them could not have been caught by reading the diff either —
`:has()` degrades silently, a wiped icon only appears on a *switch* rather than
first paint, and digit jitter needs a value that actually grows. The tests guard
structure; the browser is the only thing that sees behaviour. Phase D's matrix is
the same deal at larger scale.

CPV1 has been restated in the plan: its original "zero visual change except the
typeface" described a Phase A that no longer exists, since splitting V2b put a
deliberate visual change inside it. The checkpoint now names
`tasks/v2b-computed-value-diff.md` as its primary review artifact.
