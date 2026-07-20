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
- [ ] **Owed before CPV3 — browser verification of V12/V13.** None of this is reachable by
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

## Status: Phase C code-complete — CPV3 is the next gate

V1, V2a, V2b, V3, V4, V5, V6, V7 landed; **CPV1 approved 2026-07-20**.
V8, V9, V10, V11 landed and **CPV2 approved 2026-07-20**.
V12 and V13 landed 2026-07-20. Suite 289 → **338 green**.

**CPV3 cannot be claimed from a green suite — see "Owed before CPV3" below.**
Both Phase C tasks changed layout, and layout is the thing this project's tests
explicitly do not cover. Everything asserted here is structure.

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

Worth noting for CPV3 and CPV4: CPV2 differed from CPV1 in kind. CPV1's visual
calls were *accepted on judgement* because nothing could measure them; CPV2's
were **walked in a browser and confirmed**, including the 14-food clustering
check. The later gates (x-ray legibility under ACES, day/night readability) are
CPV1-shaped again — they need the 3D visual matrix actually walked, not inferred
from a green suite.

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
