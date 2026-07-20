# DESIGN.md — Minhocário art direction

> The vocabulary every visual task is written against. Added in C-0003 / V4.
> Lives at the repo root rather than in `docs/` on purpose: `docs/` carries the
> matched-pair rule (`game-reference.md` + `game-reference-pt.md` in the same
> commit), and a single-language design doc there would either break that rule or
> force a pointless translation. **Excluded from the FTP upload** — see
> `tasks/release-checklist.md` §C.1.
>
> Constants here are transcribed from `css/tokens.css`, never the reverse.

## The identity: a garage diorama seen through a field instrument

Two registers, deliberately unlike each other. The tension between them *is* the
identity — a real bin, observed through a scientific instrument. That framing
justifies both the low-poly world and the requested information density, and it
lands the spec's "educational idle-game feel" more precisely than either
register could alone.

### The world (the 3D stage)

A warm, matte, faceted toy diorama. Physical, tactile, slightly under-lit.
Desaturated throughout **except the bin**, which is the one saturated object on
the stage and therefore the thing the eye goes to.

`flatShading: true` and low segment counts are a **stated identity, not a
shortcut**. A smooth, high-segment lathe breaks this register more than it
improves it. Anyone tempted to raise segment counts for "quality" should read
that as a departure from the art direction, not an upgrade to it.

### The chrome (the DOM)

A dark-green field notebook / lab instrument. Tabular numerals, uppercase
micro-labels with letter-spacing, thin rules, gauges with visible comfort bands.

Calm, dense, and never gamey: **no neon, no glow, no panel gradients**. Colour
carries meaning, never decoration — if a colour is not saying "this value is
outside its comfort band" or "this surface is closer to you", it should not be
there.

---

## Colour

All colours live in `css/tokens.css` and nowhere else. `tests/css.test.js` fails
the build on any colour literal — hex, `rgb()`, `rgba()`, `hsl()` — in the other
four sheets. Without that, a token system is a suggestion that decays back into
literals one "just this once" at a time.

### Surfaces

A depth ramp where **lightness rises while saturation falls**. That inversion is
the whole point: before C-0003 all three steps sat at hue 120 with ~18–22%
saturation, so a panel read as *more green* rather than *closer to the viewer* —
green was doing the work that light should have been doing, and the stack looked
flat.

| token | value | S / L | used for |
|---|---|---|---|
| `--surface-0` | `#1b2a1b` | 22% / 14% | page, gauge tracks, stage floor |
| `--surface-1` | `#232e25` | 14% / 16% | panels, HUD, chooser, cards |
| `--surface-2` | `#2d3830` | 11% / 20% | controls, borders, stats box |
| `--surface-3` | `#38423a` | 8% / 24% | raised / hover — reserved for Phase B |

`--surface-0` is deliberately **unchanged** from v1. It is the deepest note of
the field-notebook register and the colour the whole screen is keyed to; the
flattening was never in the base, it was in the steps above it.

### Ink, accent, state

Contrast is measured (WCAG 2.1) against the surfaces each colour actually sits
on — not assumed, and not blanket-checked. A tier that isn't readable isn't a
tier. `tests/css.test.js` enforces this on every text colour, permanently.

| token | value | vs `-0` | vs `-1` | vs `-2` | role |
|---|---|---|---|---|---|
| `--ink` | `#eaf2e6` | 13.2 | 12.3 | 10.7 | text |
| `--ink-dim` | `#a9bda2` | 7.5 | 7.0 | 6.1 | text |
| `--ink-faint` | `#879a82` | 5.0 | 4.7 | *4.1* | text, `-0`/`-1` only |
| `--accent` | `#7bc043` | 6.8 | 6.4 | 5.5 | text |
| `--state-warn-ink` | `#e0b13c` | 7.6 | 7.1 | 6.1 | text |
| `--state-alert-ink` | `#ef8a72` | 6.1 | 5.7 | 5.0 | text |
| `--state-warn` | `#e0b13c` | — | — | — | fill / border |
| `--state-alert` | `#c0563f` | — | — | — | fill / border |

`--ink-faint` was first drafted at `#7d8f78` and measured 4.36:1 — under AA, on
real copy. It was lightened before shipping. It is used on exactly two elements,
both over `--surface-0`/`--surface-1`; it measures 4.1 on `--surface-2` and 3.5
on `--surface-3`, so **faint text must not be placed on those two surfaces**
without moving one of the values.

### Why each state tier splits into a fill and an ink

A border, a gauge marker or a bar has no contrast floor to meet. Text does.
Collapsing both jobs into one token forces a single value to serve both, and the
text always loses: `#c0563f` is a good alarm colour and a bad on-dark text
colour — it measured 2.7:1 in the stats box, below even AA-large.

So the saturated value stays where the alarm actually reads (border, pulse,
gauge marker, gauge fill), and only the lettering lightens to `#ef8a72`. This
mirrors the `--accent-soft` / `--accent-soft-strong` split already in the file.

`--state-warn-ink` equals `--state-warn` today, because `#e0b13c` already clears
AA. The indirection is **not** redundant: it keeps the two tiers structurally
identical, so retuning warn-as-text later is a one-line change rather than a
re-split. Do not simplify it away.

> An earlier draft of this document claimed reaching AA meant lightening the
> alert red toward `#d79484` and losing its bite. That was wrong — it came from
> searching only along the original 51% saturation, which forces lightness up
> and produces washed pink. Searching saturation as well finds AA-passing reds
> that are *more* vivid than the original (`#ff724f` at 100% saturation clears
> AA on all three). The split above was preferred anyway, because it fixes the
> text without touching the fills at all.

State colours are named to match `markFillLevel()`'s vocabulary in
`js/ui/actions.js`, so CSS and JS use **one word per meaning**: `warn` is the
"filling up" tier, `alert` is the "full, production is suffering" tier.

---

## Type

Seven steps, `.6875rem → 1.5rem`. The inherited ramp ran `.75/.8/.85/.9/.95/1` —
0.05rem apart, which is under a pixel at a 16px root and therefore **not a
distinction the eye can use**. These steps are far enough apart to establish
hierarchy and tight enough to stay dense, which is the instrument register.

| token | value | used for |
|---|---|---|
| `--text-2xs` | `.6875rem` / 11px | uppercase micro-labels (group headings) |
| `--text-xs` | `.75rem` / 12px | dense secondary text |
| `--text-sm` | `.8125rem` / 13px | **the workhorse** — panels, readouts, controls |
| `--text-md` | `.875rem` / 14px | descriptions, body copy in cards |
| `--text-base` | `1rem` / 16px | default, panel headers |
| `--text-lg` | `1.25rem` / 20px | dialog titles |
| `--text-xl` | `1.5rem` / 24px | screen headings |

Plus `--leading-tight` 1.2, `--leading-body` 1.4, `--tracking-caps` .04em.

**Every numeric readout uses `font-variant-numeric: tabular-nums`.** Values change
every tick; proportional digits make the whole panel jitter as they do.

---

## Space, radius, elevation

4px grid, `--space-1` … `--space-8`. Everything in the sheets is on it.

**`--space-05` (2px) is a deliberate half-step.** Row gaps inside a gauge and the
padding on a stat line are sub-4px by nature; forcing them to 4px visibly loosens
the densest readouts, which works against the density this redesign exists for.
One half-step used in three places beats either abandoning the grid or bloating
the instrument.

Two values stay literal on purpose: `44px` and `56px` dev-mode clearances are
**measured off the dev nav bar's own height**, not chosen from the scale. They
track that bar, so a token would misrepresent them.

Radius: `--radius-sm` 4 / `--radius` 8 / `--radius-lg` 12 (dialog and banner —
the two largest floating surfaces).

Elevation: `--shadow-1`, `--shadow-2`. **There is no `--shadow-3`**: a third step
would have to be invented rather than extracted, and nothing in the design casts
it. An unused token is a claim the code cannot back.

---

## Motion

Three steps carry every transition and entrance: `--dur-fast` .12s, `--dur` .16s,
`--dur-slow` .3s, with `--ease`.

**The two infinite pulses are a separate category and did not collapse into
them.** They are not transitions — they breathe for as long as a condition holds,
and folding a 1.2s breath into 0.3s turns a calm warning into a strobe.
`--dur-pulse` (1.2s, ambient: gauge marker / stat value) and
`--dur-pulse-urgent` (1.4s, the action that clears the condition) stay
**deliberately unequal**, so a stressed gauge and an urgent button never lock
into a single metronome beat.

Motion is decorative and fully opts out under `prefers-reduced-motion` — the
blanket override at the bottom of `css/motion.css`. **Colour and weight must
carry every meaning on their own**, because under that preference they are all
that is left. The warn tier deliberately does not animate at all: motion is what
separates "act now" from "act soon", so spending it on the earlier tier would
flatten the distinction.

---

## Icons

Hand-authored inline SVG. A `<symbol>` sprite at the top of `<body>`, plus one
factory module (`js/ui/icons.js`) — zero HTTP requests, cached with the HTML, and
`createElementNS` confined to exactly one module so every other UI file keeps the
existing `createElement` discipline.

Rules:

1. **Icons carry no text.** Every `<svg>` is `aria-hidden="true"` and
   `focusable="false"`; the adjacent `[data-string]` span carries the accessible
   name. No new i18n keys, and the three locales are untouched by the redesign.
2. **Never nest an `<svg>` inside a `[data-string]` element.** `applyStrings()`
   in `js/main.js` does `el.textContent = t(key)` on every such node, which wipes
   the icon at init *and* on every language switch. `tests/markup.test.js`
   enforces this permanently.
3. **Every symbol is `fill="currentColor"`**, so icons inherit the two-tier
   warn/alert colouring for free.

### Food icons — the uniform-treatment discipline

Real food illustrations, under a discipline that exists to protect one
non-negotiable: **the add-waste food list carries zero suitability signal.**

The usual objection to real food art does not survive contact with the code —
foods already carry plain-language names (`Carne`, `Laticínios`, `Comida
gordurosa`), so the real-world-semantics leak is already fully present through
the name. An illustration of meat tells the player nothing "Carne" doesn't.

Two leaks *are* genuinely new, and these rules hold them:

1. **Silhouette grouping.** 14 icons will otherwise cluster into
   organic-irregular (peels, scraps, guts, leaves) versus manufactured-regular
   (pasta, dairy, oily, salty), and the eye reads those as two families
   regardless of the catalog's deliberately irregular order — the auto-fill grid
   makes it worse, since 14 items in 4 columns produce rows that read as
   categories. **Every food icon is drawn to the same optical weight, inside the
   same circular frame, at the same stroke width and fill density, centred and
   equally scaled.** The frame is what the eye groups on, and it is identical for
   all 14.
2. **Colour coding.** Green/brown versus pink/white/beige is the same failure by
   another channel. **All 14 render monochrome in `currentColor`.** No per-food
   hue, ever.

No test can prove the absence of clustering. The substitute is a **manual review
at CPV2**: lay all 14 out in the chooser grid and confirm they do not read as two
families.

---

## Typeface

> **Pending — C-0003 / V7.** When the webfont lands, record here: the face name,
> version, the SIL OFL licence, and the exact subsetting command used before
> base64 encoding. Requirements: SIL OFL only, a strong tabular-numeral set,
> subset to Latin + Latin-1 Supplement (pt-BR/es accents) before encoding — an
> unsubsetted face is 100KB+ of base64 — shipped as `css/font.css` with
> `font-display: swap`, and **no network request on reload**, matching the
> vendored-Three.js precedent.

---

## Deviations from the C-0003 plan

Recorded so later readers see intent rather than drift. Each is argued at length
in `tasks/plan-c0003-visual-redesign.md`.

| Deviation | Why |
|---|---|
| V1 files are not a byte-identical concatenation of `style.css` | The five categories interleave in the original; no file can be a contiguous slice. Replaced by a rule-multiset equivalence check. |
| V2 split into V2a (naming) / V2b (retuning) | The task required identical computed values *and* a de-saturated ramp. Mutually exclusive. |
| Type scale is 7 steps but not the planned literal mapping | The inherited `.85rem` workhorse maps to `.8125rem`, not to a step that preserves it — preserving it would defeat the point of the ramp. |
| No `--shadow-3` | Would have to be invented rather than extracted. |
| Pulses kept out of the three duration steps | Collapsing a 1.2s breath into 0.3s strobes. |
| `--space-05` half-step added | The densest readouts are sub-4px by nature. |
