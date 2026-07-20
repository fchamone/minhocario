# Implementation Plan: C-0003 Visual & Layout Redesign (post-v1)

> Approved 2026-07-20 after a design interview. Progress tracking: `tasks/todo-c0003-visual-redesign.md`.
> The v1 record (`tasks/plan.md`, `tasks/todo.md`) is **closed** — this is a separate, post-ship project.
> **V5 and V6 already landed** (`64c3158`, `c0ae33e`) ahead of the rest, as standalone correctness work.

## Context

v1 shipped 2026-07-20 (CP9, 282 tests green). Every feature is complete, and every visual
acceptance criterion in the v1 plan was written as **readability/legibility** — never as visual
appeal. There is no `DESIGN.md`, no mood board, no colour-token spec, and no art direction
beyond one line in the C-0001 spec ("stylized low-poly, flat colors") and one tonal note
("educational idle-game feel").

The result is a game that is mechanically deep but visually thin:

- `css/style.css` (565 lines) carries **colour tokens only** — no type scale, no spacing scale.
  ~20 ad-hoc font sizes, literal px padding throughout, `var(--gap)` used in just 5 places.
- **Zero image assets** in the repo. No icons, no textures, no favicon, no webfont.
- The 3D scene is 4 objects and 3 lights with **no shadows, no textures, no tone mapping**, a
  flat background colour instead of a sky, and 8–20 primitives per composter.
- The game screen wastes a wide display: `1fr 260px`, with the densest content on screen (the
  internals/x-ray panel) crammed into a 280px box floating over the canvas.

**Goal:** a real token layer, an art direction recorded in the repo, an SVG icon system, a denser
desktop game-screen layout, and a materially richer 3D scene — without touching the sim, the
frozen scoring formula, or the frozen save schema.

## Decisions locked (design interview, 2026-07-20)

| Decision | Choice |
|---|---|
| Scope | Full redesign — tokens, all screens, layout rebuild, 3D, iconography |
| Art assets | Hand-authored inline SVG + procedural `CanvasTexture` |
| Layout priority | **Desktop polish & information density** (not mobile-first) |
| Food icons | **Real food illustrations**, under a uniform-treatment discipline (V8) |
| Tone mapping | **ACESFilmicToneMapping** |
| Typography | **Base64 webfont** embedded as a `data:` URI in CSS |
| 3D depth | Through geometry; real shadow maps perf-gated and droppable |
| `DESIGN.md` | Repo root, not `docs/` (V4) |
| Internals/stats panels | Stay collapsible `<details>` (V12) |

## Architecture decisions

- **Phase A is invisible to the player and lands first.** Tokens, file split, guard tests and the
  art-direction doc change nothing on screen. Every later phase is a small diff against a
  vocabulary that already exists, instead of a redesign and a refactor tangled together.
- **Guard tests are static source readers.** There is no npm and no visual-regression tooling, so
  correctness comes from tests that `readFileSync` the sources and assert structure. The pattern
  already works here — `tests/i18n.test.js:257` scans `index.html` this way.
- **The token layer is enforced, not offered.** `tests/css.test.js` fails on any hex literal
  outside `tokens.css`. Without that, a token system is a suggestion that decays.
- **Icons carry no text.** Every `<svg>` is `aria-hidden`, with the adjacent `data-string` span
  carrying the accessible name. No new i18n keys, no catalog key-parity churn, and the three
  locales are untouched by the entire redesign.
- **The 3D layer keeps its "sim is the single source of truth" discipline.** `updateSunPatch`
  samples the sim's own `solarGain`; nothing in this project changes that coupling.
- **Cheapest-win-first in Phase D.** Contact shadows before real shadow maps, textures before
  geometry — the risky, droppable work sorts last so the phase can stop early with value banked.

## Findings that shape the plan

Four things were verified against source; each invalidates an otherwise obvious approach.

**1. `applyStrings()` destroys inline SVG.** `js/main.js:107-112` does `el.textContent = t(...)`
on every `[data-string]` node. Action buttons carry `data-string` directly, so an icon inside one
is wiped at init *and* on every language switch. **Any icon work requires restructuring
`index.html`** so `data-string` moves to an inner `<span>` and the `<svg>` is its sibling.

**2. No `ResizeObserver` on the canvas.** *(Fixed in V5, `64c3158`.)* `resizeScene()` fired only on
window resize and game-screen entry, so a grid change or a collapsing panel left `camera.aspect`
stale — stretching the scene *and* drifting the drag raycast off the cursor.

**3. The `<details>` guard fails open.** Both panels do `if (!panel.open) return`
(`actions.js:582`, `stats.js:193`). If either becomes a plain `<div>`, `panel.open` is `undefined`
→ falsy → **the panel goes permanently blank with no error.** The most likely silent regression
in the project.

**4. `outputColorSpace` is already correct.** r170 defaults it to `SRGBColorSpace`; only
`toneMapping` is unset. The lighting step is half the size it appears.

Two latent hazards found alongside: `composterCavity()` duplicated each builder's dimensions with
no test *(fixed in V6, `c0ae33e`)*; and `disposeComposterMesh()` frees geometry and material but
**not `material.map`**, so textures introduce a leak on upgrade (addressed in V15).

## Non-negotiables (from CLAUDE.md)

- No build step, no npm, no bundler, no CDN, no external network calls. Works offline.
- `js/sim/` stays free of DOM/Three.js/browser imports. **Sim logic is not touched.**
- Every user-facing string via `js/strings.js` + `js/i18n/{pt-BR,en,es}.js`, key parity enforced.
- **Scoring formula and save schema are FROZEN (CP9).** This project touches neither.
- `docs/game-reference.md` / `-pt.md` are a matched pair — update both or neither.
- `js/main.js` is the only orchestrator between layers.
- The food list carries **zero** suitability signal (see V8 for how that survives food icons).

## Dependency graph

```
V1 → V2 → V3 → V8 ┐
        ↘ V4      ├→ V10, V11 → V12 → V13
        ↘ V9 ─────┘        ↑
V5 ✅ ─────────────────────┘
V6 ✅ ────────────→ V16, V18
V7 ──────────────→ V10
V5 → V14 → V15 → V16 → V19
          ↘ V17
```

---

## Phase A — Foundations (zero visual change)

### V1. Split `css/style.css` into five files — S
Move rules verbatim, **no rule edits**; verify no rule was lost, edited or invented.

> **AC amended 2026-07-20 (during implementation).** The original AC — "concatenation of the five
> files is byte-identical to the original" — is unsatisfiable alongside the grouping this same task
> specifies. Byte-identity requires each file to be a *contiguous slice* of `style.css`, but the five
> categories interleave there: `.shop-card` (components) sits between `.home` and `.setup` (screens);
> `.banner` (components) sits after `.speed__paused` (screens); `.internals` (components) sits between
> `.actions__feedback` and `.stat`. The per-file header comments the task also requires would break
> byte-identity independently. Grouping was kept and the check was replaced with the property that AC
> was actually protecting — see the amended AC below.
`tokens.css` (`:root` only) / `base.css` (reset, html/body, button, headings, `.screen`, dev-nav) /
`components.css` (`.stat .gauge .shop-card .banner .chooser .ico`) / `screens.css` (`.home .shop
.setup .screen--game` grid, `.hud .actions .speed`) / `motion.css` (all `@keyframes`, transitions,
`prefers-reduced-motion`).

Five `<link>`s in `index.html` in that exact order — **never `@import`** (serialises round trips).
`motion.css` last so the `prefers-reduced-motion` block (`style.css:558`) and the T22 overrides
keep winning without `!important`. Each file gets a header comment naming its cascade position and
stating `index.html` is the source of truth for order.
- **AC (amended):** the five files parse to exactly the same multiset of normalized rule blocks as the
  pre-split `style.css` (fixture `tests/fixtures/style.baseline.css`) — nothing lost, edited or
  invented; `index.html` links exactly the five sheets in cascade order; no `@import` anywhere; page
  renders indistinguishably.
- **Verify:** `node --test tests/css.test.js`; `npx serve .` → walk all four screens.
- **Deps:** none. **Files:** `css/*.css`, `index.html`, `tests/css.test.js`,
  `tests/fixtures/style.baseline.css`.
- **Retires at V2:** the equivalence test and its baseline fixture are deleted by V2, which rewrites
  declarations by design. V2's own AC (identical *computed* values, spot-checked in devtools) is the
  successor guard. The two durable assertions — link order and no-`@import` — stay in `css.test.js`
  and are joined by V3's token-resolution and no-stray-hex checks.

### V2. `css/tokens.css` + mechanical migration — M
> **Split in two, 2026-07-20 (approved during implementation).** As written, V2 asked for two
> incompatible things: *"every computed value identical to before ... no visual diff"* **and**
> *"de-saturate the upper steps — `--panel` and `--panel-2` are both green-tinted, which flattens
> perceived depth."* De-saturating `--panel` changes its computed value on every surface using it.
> The same tension sits in the type scale (a designed `.6875 → 1.5` ramp cannot land on today's
> ad-hoc `.75/.8/.85/.9/.95/1` without moving sizes), in the spacing scale (a 4px grid cannot express
> today's `2/3/6/10/14px` values), and in elevation (three shadow tokens cannot come from two
> existing literals without inventing one).
>
> **V2a — naming, zero visual change.** Introduce the token layer with every token set to *exactly*
> the value it replaces, and migrate declarations to reference it. Off-grid literals stay literal.
> Provable by machine (see the new AC); this is what keeps Phase A's "invisible to the player"
> promise honest.
>
> **V2b — retuning, visual by design.** Change token *values*: de-saturate the surface ramp, snap
> spacing to the 4px grid, rationalize the type ramp toward `.6875 → 1.5`, collapse the eight stray
> durations into the three `--dur-*` steps, add the third shadow step. Because V2a landed first, this
> is a small diff **inside `tokens.css`** rather than a redesign spread across four files — which is
> the entire payoff of having a token layer, and makes CPV1's human review a review of one file.

### V2a. `css/tokens.css` + mechanical migration — M
Add the token set at today's values, then rewrite existing declarations to reference tokens
**producing identical computed values**.
Every token below is defined at **the value it replaces**, so nothing moves on screen. Where today's
values do not fit the intended scale, the token set stays *incomplete* rather than approximate — the
missing steps are added by V2b when the ramp is re-authored, so no token ever ships as a lie.
- **Type scale** — six steps covering today's literals exactly: `--text-2xs` .75 / `--text-xs` .8 /
  `--text-sm` .85 (the workhorse, 10 uses) / `--text-md` .9 / `--text-lg` .95 / `--text-xl` 1.
  The designed `.6875 → 1.5` ramp is **V2b** — it cannot land on these values. Plus `--leading-body`
  1.4 and `--tracking-caps` .04em (both already used verbatim); `--leading-tight` waits for a user.
- **Spacing scale** — 4px base, `--space-1` … `--space-8`. `--gap` stays as an alias for `--space-3`
  for one release so the five existing uses don't move in the same commit. Today's off-grid values
  (`2/3/6/10/14/44/56px`) stay literal; **V2b** snaps them.
- **Radius** — `--radius-sm` 4 / `--radius` 8. `--radius-lg` 12 has no user yet — **V2b**.
- **Elevation** — `--shadow-1` / `--shadow-2`, extracted from the two literals present (`.banner`,
  `.shop-card:hover`). The third step is invented, so it is **V2b**.
- **Motion** — `--dur-fast` .12s / `--dur` .16s / `--dur-slow` .3s + `--ease`, applied only where the
  value already matches exactly. The eight remaining durations (.06/.15/.18/.2/.22/.28/1.2/1.4s)
  stay literal until **V2b** collapses them. Authored in seconds, not ms, so the text-level
  equivalence check below stays exact.
- **Semantic colour roles** — surface ramp `--surface-0…2` renamed from `--bg`/`--panel`/`--panel-2`;
  `--ink` / `--ink-dim`; **`--state-warn(-bg)` / `--state-alert(-bg)` named to match `markFillLevel`'s
  vocabulary** so CSS and JS use one word per meaning; `--accent-soft` / `--accent-soft-strong` for
  the two gauge fills. **De-saturating the ramp, `--surface-3`, `--ink-faint` and `--state-warn-bg`
  are all V2b** — the first changes values, the rest have no user yet.
  **No deprecated aliases.** The plan borrowed the `--gap` precedent here, but it does not transfer:
  `--gap` survives because 5 sites still reference it, whereas keeping `--bg`/`--panel`/`--warn`
  after migrating every usage would leave dead tokens that no test can catch. All usages moved.
- **Colour literals reach zero as a side effect.** Tokenizing every colour needed four names the
  plan did not anticipate but which are all genuine values, not conveniences: `--surface-1-alpha`
  (the internals panel's translucent fill), `--scrim` / `--scrim-dim` (dialog backdrop, dev bar),
  `--stage-sky` (the WebGL-failure gradient — load-bearing for graceful degradation), and
  `--state-alert-glow(-0)` (the pulse, whose rest state is the same hue at zero alpha rather than
  `transparent`, so it cannot interpolate through black). **V3's "no hex outside `tokens.css`" rule
  therefore already passes on arrival.**
- **AC:** with every `var()` recursively resolved against its own `:root`, the five files produce
  **exactly the same multiset of applied rule blocks** as the pre-split baseline — i.e. computed
  values are provably unchanged, not spot-checked; `tests/css.test.js` green.
- **Verify:** `node --test tests/*.test.js`; `npx serve .` → walk all four screens.
- **Deps:** V1. **Files:** `css/tokens.css`, `css/*.css`, `tests/css.test.js`.

> **The AC upgrade is the point of the split.** The original AC ("spot-checked in devtools on each
> screen") is exactly the kind of guard the V6 lesson warns about — it cannot fail in CI and depends
> on a human noticing a 1px shift. Resolving `var()` and comparing against the frozen baseline turns
> "no visual diff" into a machine-checkable claim for the whole mechanical phase. It only works
> because V2a changes no values; V2b retires it.

### V2b. Retune token values — M
Purely value edits inside `tokens.css` (plus deleting the deprecated aliases). De-saturate
`--surface-2`/`--surface-3`, snap spacing to the 4px grid, re-author the type ramp toward
`.6875 → 1.5`, collapse the stray durations, add `--shadow-3` / `--radius-lg` / `--ink-faint` /
`--state-warn-bg`. **Visual by design**, so V2a's resolved-equivalence test and
`tests/fixtures/style.baseline.css` are deleted here.
- **AC:** the diff is confined to `tokens.css` plus alias removal; all four screens walked in all
  three locales; no element loses legibility (the gauges' warn/alert tiers stay distinguishable).
- **Verify:** `npx serve .`; CPV1 human review.
- **Deps:** V2a. **Files:** `css/tokens.css`, `css/*.css`.

### V3. Static guard tests — S/M
- `tests/css.test.js` — every `var(--token)` across `css/*.css` is defined in `tokens.css`; **no hex
  literal outside `tokens.css`**. Joins V1's two durable assertions already in this file (link order,
  no `@import`); V1's rule-equivalence test is gone by now, retired by V2 as planned.
- `tests/markup.test.js` — **no element carries both `data-string` and a descendant `<svg>`**
  (finding #1 as a permanent tripwire); every `data-action` in `index.html` has a handler in
  `actions.js`; every id passed to `getElementById` in `js/ui/*` exists in `index.html`.
- **AC:** both suites green; each assertion demonstrated to fail when deliberately violated (the V6
  lesson — an untested guard is worth nothing).
- **Verify:** `node --test tests/*.test.js`; temporarily break each rule and confirm a clear failure.
- **Deps:** V2. **Files:** `tests/css.test.js`, `tests/markup.test.js`.

### V4. `DESIGN.md` at repo root — S
Not `docs/` — that carries the matched-pair rule (English + pt-BR in the same commit) and is
excluded from the FTP upload as a maintainer spoiler sheet; a single-language design doc there
either breaks the pair rule or forces a pointless translation.

**Art direction to record — "garage diorama seen through a field instrument":**
- **The world (3D stage)** — a warm, matte, faceted toy diorama. Physical, tactile, slightly
  under-lit. Desaturated except the bin, the one saturated object. `flatShading: true` and low
  segment counts are a **stated identity, not a shortcut**.
- **The chrome (DOM)** — a dark-green field-notebook / lab instrument. Tabular numerals, uppercase
  micro-labels with letter-spacing, thin rules, gauges with visible comfort bands. Calm, dense,
  never gamey; no neon, no glow, no panel gradients.

The tension between the two registers *is* the identity: a real bin seen through a scientific
instrument. It justifies both the low-poly diorama and the requested density, and lands
"educational idle-game feel" more precisely than either register alone.
- **AC:** covers palette/type/spacing rationale, the two registers, the icon rules incl. the food
  discipline from V8, and the webfont provenance from V7; `CLAUDE.md` points at it;
  `tasks/release-checklist.md` excludes it from the upload.
- **Verify:** manual read-through against the shipped token set.
- **Deps:** V2. **Files:** `DESIGN.md`, `CLAUDE.md`, `tasks/release-checklist.md`.

### ~~V5. `ResizeObserver` on the canvas~~ — ✅ done (`64c3158`)
Shipped ahead of the phase as standalone correctness work. ResizeObserver on the canvas, feature-
detected, disconnected in `disposeScene`. No feedback loop (`resizeScene` passes `updateStyle=false`).
**Still needs its browser check** — resize the window and drag the bin at several widths; it must
stay pinned under the cursor. Carried as an open item in the todo.

### ~~V6. `DIMS` extraction in `composter3d.js`~~ — ✅ done (`c0ae33e`)
`structureOf()` now feeds both the builders and `composterCavity`; verified bit-identical across all
six models. `tests/composter3d.test.js` (7 tests) holds it. **Lesson carried forward into V3:** the
first containment test measured against the group's overall bounding box and *passed* a simulated
drift, because the lid and vent stack swallow almost any error. `markBody()` now tags the meshes
that actually enclose the cavity, with a companion test asserting the tags exist so the check
cannot go vacuous. Every guard test in this project gets the same break-it-first treatment.

### V7. Base64 webfont — S/M
One-time dev step, exactly like the Three.js vendoring precedent. A **SIL OFL** face with a strong
tabular-numeral set, subset to Latin + Latin-1 Supplement (pt-BR/es accents) before encoding — an
unsubsetted face is 100KB+ of base64. Ships as `css/font.css` with
`@font-face { src: url(data:font/woff2;base64,…) }` and `font-display: swap`.
- **AC:** face renders on all four screens; **offline reload still renders in it** with zero network
  requests; face/version/license/subsetting command recorded in `DESIGN.md`.
- **Verify:** `npx serve .` + devtools Network tab (no font request) + offline reload.
- **Deps:** none. **Files:** `css/font.css`, `index.html`, `DESIGN.md`.

> **Shipped:** IBM Plex Sans 3.201, SIL OFL 1.1, **variable** (wght 400–700) rather than static
> weights — the CSS uses 400/600/700 and one variable face covers all three plus the UA bold in a
> single data URI. `wdth` pinned. 234 glyphs / 27,100 B woff2 / 36,136 B base64. Built in a throwaway
> venv so nothing was installed globally.
>
> **The plan's premise was wrong in an instructive way.** It specified "a face with a strong
> tabular-numeral set", assuming tabular figures come from a `tnum` feature. IBM Plex Sans has **no
> `tnum` at all** — and needs none, because every digit is 600 units wide by default. Had the face
> been chosen on the presence of `tnum`, this one would have been wrongly rejected; had it been
> chosen without checking either, a proportional face would have shipped and every readout would
> jitter with **nothing failing loudly**. The property to test is digit *advance widths*, not feature
> tags. Verified at all three weights after subsetting and again from the served data URI, and
> written into `DESIGN.md` as a requirement on any future face swap.
>
> Two things this added beyond the plan: `css/IBMPlexSans-OFL.txt` ships in the **upload set** (the
> OFL requires its text to travel with redistributed font software, and a `data:` URI is
> redistribution), and `tests/css.test.js` gained a no-external-URL guard — a `src` fallback pointing
> at a CDN is the one mistake here that works in dev and fails offline.

> **CPV1 (after V1, V2a, V2b, V3, V4, V7).** *Restated 2026-07-20 — the original wording
> ("**zero visual change** except the new typeface") described a phase that no longer exists. It was
> written when V2 was one task claiming identical computed values; splitting out V2b put a
> deliberate visual change inside Phase A. Promising "zero visual change" now would send the reviewer
> looking for the wrong thing, and a checkpoint that misdescribes its own diff is worse than none.*
>
> **Expected state:** suites green (299). V1, V2a, V3 and V4 are invisible to the player by
> construction — V1 and V2a were held to it by a machine-checked equivalence proof, not by eye.
> **V2b is visible by design**, and V7 changes the typeface.
>
> **Human review, in order:**
> 1. **`tasks/v2b-computed-value-diff.md`** — the property-level diff of resolved computed values,
>    captured before the baseline fixture was retired. This is the substitute for the screenshot
>    diff this project cannot have, and it is the main artifact of this checkpoint. Check the surface
>    ramp (do panels read as *lifted* rather than *greener*?) and the type ramp (is the internals
>    panel still comfortable, not merely denser?).
> 2. **`DESIGN.md`** — the art direction and the token rationale, the vocabulary every later task is
>    written against.
> 3. **The token set itself** (`css/tokens.css`), including the deviations each marked `DEVIATION`
>    with its reason.
>
> **Already settled, no longer open at this gate:** the `--state-alert` contrast failure, resolved by
> the fill/ink split and now guarded by a permanent contrast test.

## Phase B — Chrome

### V8. Icon sprite + `js/ui/icons.js` + `index.html` restructure — M
A `<symbol>` sprite inlined at the top of `<body>` plus one factory module: zero HTTP requests,
cached with the HTML, and `createElementNS` confined to exactly one module so every other UI file
keeps the existing `createElement` discipline. `icon(name)` →
`<svg class="ico ico--name" aria-hidden="true" focusable="false"><use href="#ico-name"/></svg>`,
every symbol `fill="currentColor"` so icons inherit the two-tier warn/alert colouring for free.

Required markup restructure (finding #1) — keys don't change, so `tests/i18n.test.js` stays green:
```html
<button type="button" data-action="drain">
  <svg class="ico" aria-hidden="true" focusable="false"><use href="#ico-drain"/></svg>
  <span data-string="game.drain"></span>
</button>
```

**Food illustrations — uniform-treatment discipline.** Real food art was chosen, and the usual
objection does not survive contact with the code: foods **already** carry plain-language names
(`Carne`, `Laticínios`, `Comida gordurosa` — `js/i18n/pt-BR.js:217-232`), so the real-world-semantics
leak is already fully present through the name. An illustration of meat tells the player nothing
that "Carne" doesn't. Two leaks *are* genuinely new and must be held:

1. **Silhouette grouping.** 14 icons will otherwise cluster into organic-irregular (peels, scraps,
   guts, leaves) vs manufactured-regular (pasta, dairy, oily, salty), and the eye reads those as two
   families regardless of the catalog's deliberately irregular order. The `.chooser__options`
   auto-fill grid makes it worse — 14 items in 4 columns produce rows that read as categories.
   **Mitigation:** every food icon drawn to the same optical weight inside the same circular frame,
   same stroke width, same fill density, centred and equally scaled. The frame is what the eye
   groups on, and it is identical for all 14.
2. **Colour coding.** Green/brown vs pink/white/beige is the same failure by another channel.
   **Mitigation:** all 14 render monochrome in `currentColor`, like every other icon. No per-food hue.

Also in scope, entirely leak-free: a **proportional volume glyph** in the portion chooser whose fill
tracks the litres, and **decomposition-progress rings** on internals queue rows driven by
`decompositionFraction` — the densest information gain available anywhere in the UI.
- **AC:** every `<use href>` and `icon()` name resolves to a `<symbol id>`; **every food icon uses
  only `currentColor`** (no `fill`/`stroke` literal in any `#ico-food-*`); no `[data-string]` element
  contains an `<svg>`; language switch does not wipe a single icon; i18n suite unchanged.
- **Verify:** `node --test tests/*.test.js`; `npx serve .` → switch pt-BR/en/es and confirm icons
  survive; **lay all 14 food icons out in the chooser grid and confirm no two-family clustering.**
- **Deps:** V3. **Files:** `index.html`, `js/ui/icons.js`, `tests/icons.test.js`, `css/components.css`.

### V9. `js/ui/components.js` — consolidate shared primitives — M
Four real primitives already exist, all exported from `actions.js`: `buildStat` (497-511),
`markFillLevel` (525-528), `fillOf` (309), `fill` (444-448). Move them into a proper component module
along with the duplication they attracted: `formatLiters` defined identically in `actions.js:434` and
`stats.js:118`; `buildGauge` (`actions.js:458-486`) and `buildFillBar` (`stats.js:131-154`) as
near-identical unmerged siblings; `buildGroup` (`stats.js:157-164`) existing only in stats.js while
`actions.js` inlines the same `.internals__group` + `<h4>` pattern **four times**.
Keep re-exports from `actions.js` for one release so no existing test moves.
- **AC:** one gauge builder serves both panels; `formatLiters` defined once; suite green with no test
  file relocated.
- **Verify:** `node --test tests/*.test.js`; `npx serve .` → both panels render identically.
- **Deps:** V2. **Files:** `js/ui/components.js`, `js/ui/{actions,stats}.js`.

### V10. Home / shop / setup restyle — M
Against the V2 vocabulary: cards, ranking table, language selector, setup fieldsets.
- **AC:** all three screens on the token scale (no stray literals — `tests/css.test.js` proves it);
  first-time player still completes shop→setup unaided (the T22 criterion).
- **Verify:** `npx serve .` full flow in all three languages.
- **Deps:** V2, V7, V8, V9. **Files:** `css/screens.css`, `js/ui/{home,shop,setup}.js`.

### V11. HUD + speed bar restyle — S/M
Six `.hud__item` chips → an instrument strip with icons and tabular numerals.
- **AC:** every numeric readout uses tabular numerals and stops jittering as values change; status
  strings still track sim state; dev-mode HUD offset preserved.
- **Verify:** `npx serve .` at 20× and watch the HUD for digit jitter.
- **Deps:** V2, V8. **Files:** `css/screens.css`, `js/ui/{hud,speed}.js`.

> **CPV2 (after V11):** chrome restyled in all three locales. Human review: the icon set, and
> specifically the **14-food clustering check** — the one anti-spoiler rule no test can enforce.

## Phase C — Game-screen layout

### V12. Three-column grid — M
```css
.screen--game {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr) minmax(260px, 320px);
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas:
    'hud      hud    hud'
    'readouts stage  actions'
    'speed    speed  speed';
}
```
Left = internals/x-ray promoted out of the canvas overlay (the densest content on screen, currently
in the most constrained container — the single biggest density win). Centre = canvas + the
colony-dead banner. Right = buttons, slider, feedback, stats. `minmax(0, 1fr)` on the stage column
and row is required; bare `1fr` won't let the canvas shrink below its content size.

**What breaks:**
- **`internalsSide()` becomes dead code** — the hysteresis dead-band (`actions.js:400-429`),
  `placeInternals()` (538), its four call sites (584, 917, 927, 948) and `.internals--right`
  (`style.css:309`) exist *only* because the panel overlays the stage and the bin can slide under it.
  **Delete the function, its 5 tests (`tests/actions.test.js:271-305`) and the CSS in one commit.**
- **Both panels stay `<details open>`** (finding #3); restyle `<summary>` into a panel header. If
  either ever becomes non-collapsible, the guard must become `if (panel.open === false) return`
  **in the same edit**.
- **Preserve** `body.dev-mode .hud { padding-top: 44px }`, `.screen--game { padding: 0 }`, and the
  `.stage` gradient (`style.css:239`) — that gradient is the WebGL-failure backdrop and is
  load-bearing for graceful degradation.
- `.banner { max-width: 340px }` was sized for a full-width stage; revisit for the narrower centre.
- **AC:** drag stays pinned to the cursor at 3+ window widths and with panels collapsed/expanded;
  both panels repaint correctly after collapse→tick→expand, including while paused; suite green with
  the `internalsSide` tests removed, not skipped.
- **Verify:** `npx serve .` desktop; `node --test tests/*.test.js`.
- **Deps:** V5 ✅, V11. **Files:** `css/screens.css`, `index.html`, `js/ui/actions.js`, `tests/actions.test.js`.

### V13. Internals density pass — M
At ≥1600px, sub-grid the left column so env gauges and population sit side by side — nearly free,
since `.internals__group` sections are already independent blocks:
```css
#internals-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--space-4); align-items: start; }
```
Plus the unified gauge (V9) and the decomposition rings (V8).
- **AC:** at 1920px the whole internals panel is readable without scrolling; at 1366px it degrades to
  one column with no clipping; every §2.8 chain is still narrated by the panel.
- **Verify:** `npx serve .` at 1366 / 1600 / 1920; walk one failure chain at 20×.
- **Deps:** V12, V9. **Files:** `css/screens.css`, `js/ui/{actions,stats}.js`.

> **CPV3 (after V13):** desktop layout complete. Human review: density and drag accuracy, plus the
> `<details>` repaint check that finding #3 makes the top silent-regression risk.

## Phase D — 3D richness

### V14. ACES tone mapping + retiring `LIGHT_GAIN` — M
Only `renderer.toneMapping` needs setting (finding #4). `LIGHT_FLOOR`/`LIGHT_GAIN = 1.9`
(`scene.js:144-150`, `litIntensity` 571) is a *linear* remap compensating for legacy-authored
intensities; tone mapping is a *non-linear* highlight rolloff. **Stacking them naively washes out
midday and crushes the sun patch.** In one commit: (1) set `toneMapping` + `toneMappingExposure`;
(2) re-author `DAY_CYCLE`'s `sunI/hemiI/ambI` (the 10-keyframe table at `scene.js:130-142`) as
physical-unit values — ACES applies a warm contrast curve that **will** recolour the authored sky
keyframes, and re-tuning this table is the main cost of choosing ACES over Neutral; (3) delete
`LIGHT_FLOOR`/`LIGHT_GAIN`/`litIntensity`; (4) re-calibrate `SUN_PATCH_STRENGTH`.

> **The regression that will bite:** every emissive material gets tone-mapped, including the entire
> x-ray internals palette (`xray.js:70-81`, `solidMaterial()` 120-130), deliberately lifted "well
> above realistic compost browns" *because no light reaches inside the shell*. ACES compresses
> exactly those values, putting the x-ray legibility criterion at risk. **Mitigation: set
> `toneMapped: false` in `solidMaterial()` and on the sun-patch `MeshBasicMaterial`** so the two
> hand-calibrated, legibility-critical layers opt out entirely.
- **AC:** dawn/noon/dusk/midnight all read correctly; the sun patch still sweeps and vanishes at
  night; **x-ray internals are no less legible than before** on all 6 models; `litIntensity` gone.
- **Verify:** the 3D visual matrix below; `node --test tests/temperature.test.js` unchanged.
- **Deps:** V5 ✅. **Files:** `js/render/{scene,xray}.js`.

### V15. `js/render/textures.js` — CanvasTexture surfaces — M
Seeded value-noise into a 256² offscreen canvas → `CanvasTexture` with `RepeatWrapping`, for wall
plaster, floor concrete and soil. `PlaneGeometry` already has UVs, so only `repeat` needs setting.
Perf negligible (~800KB VRAM, a few ms once at init). **Gotcha:** a colour `map` must have
`colorSpace = SRGBColorSpace` set explicitly; a roughness/bump map must stay `NoColorSpace` — getting
this backwards is the classic washed-out-everything bug. **Also fix the `disposeComposterMesh`
texture leak here** (`composter3d.js:323-333` frees geometry and material but not `material.map`).
Bigger win than it sounds: untextured planes under a tone curve still look like planes, so this is
what makes V14 legible.
- **AC:** wall/floor/soil read as surfaces at the fixed camera distance; no tiling seams; upgrading
  models repeatedly does not grow texture memory (devtools memory check).
- **Verify:** `npx serve .`; cycle all 6 models via the shop and watch memory.
- **Deps:** V14. **Files:** `js/render/{textures,scene,composter3d}.js`.

### V16. Contact-shadow blob — S
Best value-per-risk in the phase, and it belongs *before* real shadow maps. One soft radial-gradient
`CanvasTexture` (128²) on a small plane parented to `composterGroup`,
`MeshBasicMaterial({transparent:true, depthWrite:false})`, y≈0.01. Fixes the "bin floats" read
immediately; one draw call, zero per-frame work. Must be tagged `userData.xrayPart = true` so
`setShellTransparency`'s traversal skips it, and disposed **including its texture**. Skip for buried.
- **AC:** the bin reads as sitting on the floor at every wall position; x-ray toggle leaves it
  untouched; no leak on upgrade.
- **Verify:** `npx serve .`; drag across the wall; toggle x-ray on each model.
- **Deps:** V6 ✅, V15. **Files:** `js/render/{scene,textures}.js`.

### V17. Gradient sky backdrop — S/M
Skip `ShaderMaterial` and `PMREMGenerator` — the camera is fixed and non-orbiting, so an environment
map would be almost entirely wasted. A backdrop mesh using `vertexColors` with two colours lerped per
frame into a tiny buffer attribute — **exactly the technique `sunPatch` already uses**
(`scene.js:360-384`) — costs 8 vertices and reuses a pattern already in the file. `scene.fog.color`
keeps tracking `_skyColor`, so the depth cue is unchanged.
- **AC:** a visible sky gradient at every hour; dawn/dusk transitions still perceivable at 1×; fog
  still matches the sky.
- **Verify:** the 3D visual matrix at 1× and 5×.
- **Deps:** V14. **Files:** `js/render/scene.js`.

### V18. Lathe / Extrude silhouettes — M
`LatheGeometry` for the eco barrel (ribbed profile) and the buried collar+dome (one lathe replaces
three cylinders); `ExtrudeGeometry` with a rounded `Shape` for tray rims. **Keep `flatShading: true`
and 8-12 segments** — a smooth lathe breaks the art direction more than it helps.
- **AC:** all 6 models still read as distinct at a glance (tier counts visible, buried in-ground,
  electric distinct); `tests/composter3d.test.js` green — which now *means* something, since it fails
  on cavity drift; upgrade still swaps the mesh live with no leak.
- **Verify:** `node --test tests/composter3d.test.js`; cycle all 6 models with x-ray on and off.
- **Deps:** V6 ✅. **Files:** `js/render/composter3d.js`.

### V19. Real shadow maps — perf-gated, droppable — M
`PCFSoftShadowMap`, `sunLight.castShadow`. The sun **moves every frame** via `positionSun()`, so the
shadow map re-renders every frame. Mitigations: `mapSize` 1024 (not 2048), and re-target
`sunLight.target` to `composterGroup.position` each frame so the ortho shadow camera stays tight
around the bin instead of spanning the 12-unit wall.

> **X-ray interaction.** While x-rayed, shells go `transparent, opacity 0.1, depthWrite: false` — but
> a mesh with `castShadow = true` still casts a **fully opaque** shadow from the depth pass, so a
> "transparent" bin keeps a solid black shadow. `setShellTransparency` must also stash/restore
> `obj.castShadow`. Note `castShadow` lives on the **Mesh**, not the material, so it cannot go
> through `setMaterialFade` — whose JSDoc (`xray.js:370-382`) claims to be the single stash/restore
> mechanism. Put the mesh-level stash in `setShellTransparency` (which already traverses meshes) and
> document why the two live apart. Set `castShadow = false` on the sun patch and `garageSoil`.
- **AC:** **gate — if shadows cost more than 2 ms per frame at 1×, ship V16's blob and drop V19
  entirely** (measured via a `?dev=1` frame-time readout, `renderer.info.render.calls` + ms); x-rayed
  bins cast no solid shadow; shadow direction tracks the sun across the day.
- **Verify:** frame-time readout at all speeds; the full x-ray matrix.
- **Deps:** V14, V16. **Files:** `js/render/{scene,xray}.js`.

> **CPV4 (after V19 or its drop):** full 3D pass. Human review: x-ray legibility (the criterion most
> at risk from ACES), day/night readability, and the shadow perf-gate decision.

## Phase E — Release

### V20. Audits + release checklist — S/M
Re-run the T22 audits (UI literals outside `strings.js`; `Math.random` absent from `js/sim/`; food
suitability signal) plus the new static suites. Walk the spec §6 manual checklist on desktop and one
mobile browser. Deploy dry run from a pruned copy (minus `tests/`, `.harn/`, `.claude/`, `tasks/`,
`docs/`, `DESIGN.md`).
- **AC:** every audit clean; offline-after-first-load still true **including the webfont**; pruned
  copy runs cold with no 404s.
- **Verify:** `npx serve <pruned-copy>` + checklist; final `node --test tests/*.test.js`.
- **Deps:** V13, V19. **Files:** `tasks/release-checklist.md`, fixes route to owning modules.

> **CPV5 (after V20):** ship gate — human sign-off. Scoring formula and save schema must be
> **untouched** since CP9; confirm explicitly as part of the gate.

---

## Verification

Run after every task: `node --test tests/*.test.js` (the glob matters — the bare `tests/` form fails
on Node ≥ 24). Baseline **289 green**. Serve with `npx serve .`; `?dev=1` for scaffolding.

**Automated (new suites):** token resolution, no stray hex literals, `data-string`/`<svg>`
exclusivity, `data-action` handler coverage, `getElementById` id coverage, icon `<use>`/`<symbol>`
resolution, food icons `currentColor`-only, cavity-inside-body (V6 ✅).

**Every guard test gets the V6 treatment: break the rule deliberately and confirm the test fails
with a useful message before trusting it.** The first V6 containment test passed a real drift.

| Risk | How to verify |
|---|---|
| sun-patch ↔ `solarGain` coupling | Never touch `updateSunPatch`'s sampling; `SUN_PATCH_STRENGTH` is display-only. At noon the bright band must track the bin's temperature advantage as the slider moves. |
| x-ray fade/restore protocol | Toggle x-ray ≥3× on each of the 6 models; upgrade *while* x-rayed; buried↔tier3 while x-rayed (exercises the cutaway reconciliation at `scene.js:680`). Shell must return fully opaque every time. |
| drag raycast | Drag the bin at 3+ window widths and with panels collapsed/expanded. Drift means a stale `camera.aspect`. **Includes the outstanding V5 browser check.** |
| `<details>` memoization | Collapse each panel, let ≥1 tick pass, re-expand — content must be current, not stale or blank. Repeat while paused (the case the memo exists for). |
| i18n key parity | `node --test tests/i18n.test.js`. Keys don't change, since icons carry no text. |
| Food-suitability guard | Existing guards + the new icon tests. **Manual, and the one thing no test covers:** lay all 14 food icons out in the chooser grid and confirm they do not cluster into two families. |
| `prefers-reduced-motion` | DevTools emulation. New keyframes are auto-covered by the blanket `*` override, but new `transform` transitions on layout can still jank. |
| Webfont | Offline reload must still render in the embedded face, with no font request in the Network tab. |

**3D visual matrix**, walked at each of V14–V19: dawn / noon / dusk / midnight × x-ray on/off × each
of the 6 composters. Record in `tasks/visual-overhaul-playtest.md`, reusing the audit-table format
from `tasks/cp8-playtest.md`.

> **Honest weak point:** visual regressions cannot be caught automatically without tooling that
> breaks the no-npm rule. The static tests guard *structure*, not *appearance*; the fixed manual
> matrix is the substitute and is genuinely the ceiling here.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| ACES recolours the tuned `DAY_CYCLE` table | High | V14 re-authors the table in the same commit; `toneMapped:false` opt-outs protect the two legibility-critical layers |
| X-ray legibility lost to tone mapping | High | `solidMaterial()` opts out entirely; x-ray matrix walked at every Phase-D task |
| Food icons leak suitability | High | Uniform frame + monochrome discipline; `currentColor` test; **manual clustering review at CPV2** |
| `applyStrings` wipes icons | Med | Markup restructure in V8 + `tests/markup.test.js` tripwire |
| `<details>` panel silently blanks | Med | Panels stay `<details>`; guard documented; collapse→tick→expand in every layout verify |
| Token layer decays back to literals | Med | `tests/css.test.js` fails on any hex outside `tokens.css` |
| A guard test that cannot fail | Med | Break-it-first discipline, learned from V6 |
| Shadow maps tank the frame rate | Med | V19 gated at 2 ms and explicitly droppable; V16 blob banks the value first |
| Texture leak on upgrade | Low | Fixed in V15 alongside the textures that would expose it |
| Webfont bloats CSS / licensing | Low | SIL OFL only, subset before encoding, provenance in `DESIGN.md` |
| Scope creep into sim/scoring | Low | CP9 freeze reasserted at CPV5 |

## Parallelization

- **Serial spine:** V1→V2→V3→V8→V10/V11→V12→V13 (shared `css/` + `index.html` + `main.js`).
- **Parallel lanes:** V7 any time (own file); V4 after V2; V9 after V2 alongside V8; the whole of
  Phase D after V5 ✅, independent of Phases B/C until V20.
- **Already banked:** V5, V6 — both landed early precisely because they were independent.
