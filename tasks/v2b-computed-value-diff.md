# V2b — computed-value diff (review artifact)

> Generated against the pre-token stylesheet (`tests/fixtures/style.baseline.css`
> as it stood at `a716903`, before V2b retired it). Every `var()` on both sides is
> fully resolved, so these are **computed values**, not source text.
>
> This exists because V2b is the first task in C-0003 that changes what the
> player sees, and the project has no visual-regression tooling (no npm, by rule).
> It is the substitute for a screenshot diff, and the primary review artifact at
> CPV1.
>
> Regenerated after the `--state-alert` fill/ink split so it stays complete;
> the fixture was restored from git history for the regeneration and removed again.

**Shape of the change:** 144 selectors before, 144 after — no rule added, moved
or removed. 88 declarations changed value, plus exactly one new declaration
(`.actions__btn--warn { background }`, the new `--state-warn-bg` fill).

## What to look for at CPV1

1. **Surface ramp** — `#223322 → #232e25` (panels) and `#2c3f2c → #2d3830`
   (controls/borders). Lightness rises, saturation falls; `--surface-0` is
   untouched. Panels should read as *lifted*, not *greener*. This is the change
   most likely to be judged wrong.
2. **Type ramp** — the old .05rem steps (`.85/.9/.95`) were under a pixel apart
   at a 16px root. The workhorse size drops `.85rem → .8125rem`, so panels get
   denser; the chooser title rises `1rem → 1.25rem`. Check the internals panel
   is still comfortable to read, not just compact.
3. **Alert text** — the 8 text uses of `--state-alert` moved to
   `--state-alert-ink` `#ef8a72` (AA on every surface); borders, gauge markers,
   gauge fills and the pulse deliberately keep the saturated `#c0563f`. Check the
   two reds sitting adjacent in a gauge read as depth rather than as a mismatch —
   **this is the one judgement call in the split** and the only part a contrast
   test cannot settle.
4. **`--ink-faint`** — new third ink tier, on the two empty-state lines only.

## Summary by property

| property | changed |
|---|---|
| `color` | 10 |
| `font-size` | 21 |
| `background` | 15 |
| `padding` | 13 |
| `gap` | 6 |
| `transition` | 4 |
| `border` | 4 |
| `animation` | 4 |
| `margin` | 3 |
| `border-bottom` | 3 |
| `border-radius` | 2 |
| `margin-top` / `border-top` / `border-left` | 1 each |

## Full diff

| selector | property | before | after |
|---|---|---|---|
| `button` | `background` | `#2c3f2c` | `#2d3830` |
| `button` | `padding` | `8px 14px` | `8px 16px` |
| `button` | `transition` | `background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.06s ease, box-shadow 0.15s ease` | `background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease, transform 0.12s ease, box-shadow 0.12s ease` |
| `.dev-nav` | `padding` | `6px 10px` | `8px 12px` |
| `.dev-nav` | `font-size` | `0.8rem` | `0.75rem` |
| `.dev-nav button` | `padding` | `4px 10px` | `4px 12px` |
| `.shop-card` | `gap` | `6px` | `8px` |
| `.shop-card` | `padding` | `14px` | `16px` |
| `.shop-card` | `background` | `#223322` | `#232e25` |
| `.shop-card` | `border` | `1px solid #2c3f2c` | `1px solid #2d3830` |
| `.shop-card` | `transition` | `border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease` | `border-color 0.12s ease, transform 0.12s ease, box-shadow 0.12s ease` |
| `.shop-card__desc` | `font-size` | `0.9rem` | `0.875rem` |
| `.shop-card__stats` | `font-size` | `0.85rem` | `0.8125rem` |
| `.shop-card--disabled .shop-card__buy` | `background` | `#2c3f2c` | `#2d3830` |
| `.shop-card__reason` | `color` | `#c0563f` | `#ef8a72` |
| `.shop-card__reason` | `font-size` | `0.8rem` | `0.75rem` |
| `.internals` | `font-size` | `0.85rem` | `0.8125rem` |
| `.internals` | `background` | `rgba(34, 51, 34, 0.92)` | `rgba(35, 46, 37, 0.92)` |
| `.internals` | `border` | `1px solid #2c3f2c` | `1px solid #2d3830` |
| `.internals > summary` | `font-size` | `0.95rem` | `1rem` |
| `.internals h4` | `margin` | `0 0 6px` | `0 0 8px` |
| `.internals h4` | `font-size` | `0.8rem` | `0.75rem` |
| `.internals__empty` | `color` | `#a9bda2` | `#879a82` |
| `.stat--alert .stat__value` | `color` | `#c0563f` | `#ef8a72` |
| `.gauge` | `padding` | `3px 0` | `4px 0` |
| `.gauge__marker` | `transition` | `left 0.3s ease, background-color 0.2s ease` | `left 0.3s ease, background-color 0.16s ease` |
| `.gauge--alert .gauge__value` | `color` | `#c0563f` | `#ef8a72` |
| `.gauge__fill` | `transition` | `width 0.3s ease, background-color 0.2s ease` | `width 0.3s ease, background-color 0.16s ease` |
| `.stats` | `padding` | `8px 10px` | `8px 12px` |
| `.stats` | `font-size` | `0.85rem` | `0.8125rem` |
| `.stats` | `background` | `#2c3f2c` | `#2d3830` |
| `.stats h4` | `font-size` | `0.75rem` | `0.6875rem` |
| `.stats__group` | `margin-top` | `10px` | `12px` |
| `.stats .gauge__bar` | `background` | `#223322` | `#232e25` |
| `.chooser` | `background` | `#223322` | `#232e25` |
| `.chooser` | `border` | `1px solid #2c3f2c` | `1px solid #2d3830` |
| `.chooser` | `border-radius` | `8px` | `12px` |
| `.chooser h3` | `font-size` | `1rem` | `1.25rem` |
| `.chooser__options` | `gap` | `6px` | `8px` |
| `.banner` | `background` | `#223322` | `#232e25` |
| `.banner` | `border-radius` | `8px` | `12px` |
| `.banner` | `animation` | `banner-in 0.22s ease-out` | `banner-in 0.16s ease-out` |
| `.banner strong` | `color` | `#c0563f` | `#ef8a72` |
| `.banner p` | `margin` | `0 0 10px` | `0 0 12px` |
| `.banner p` | `font-size` | `0.9rem` | `0.875rem` |
| `.shop-card__tradein` | `font-size` | `0.85rem` | `0.8125rem` |
| `.internals__model` | `margin` | `-4px 0 10px` | `calc(4px * -1) 0 12px` |
| `.internals__model` | `border-bottom` | `1px solid #2c3f2c` | `1px solid #2d3830` |
| `.lang-select` | `font-size` | `0.85rem` | `0.8125rem` |
| `.lang-select__options` | `gap` | `6px` | `8px` |
| `.lang-select__btn` | `padding` | `4px 10px` | `4px 12px` |
| `.lang-select__btn` | `font-size` | `0.85rem` | `0.8125rem` |
| `.lang-select__btn` | `background` | `#2c3f2c` | `#2d3830` |
| `.home__nickname button` | `padding` | `4px 10px` | `4px 12px` |
| `.home__nickname button` | `font-size` | `0.85rem` | `0.8125rem` |
| `.home__notice` | `color` | `#c0563f` | `#ef8a72` |
| `.ranking__table th, .ranking__table td` | `padding` | `6px 8px` | `8px` |
| `.ranking__table th, .ranking__table td` | `border-bottom` | `1px solid #2c3f2c` | `1px solid #2d3830` |
| `.ranking__empty` | `color` | `#a9bda2` | `#879a82` |
| `.setup fieldset` | `border` | `1px solid #2c3f2c` | `1px solid #2d3830` |
| `.setup-species` | `gap` | `10px` | `12px` |
| `.setup-species:hover` | `background` | `#2c3f2c` | `#2d3830` |
| `.setup-species__latin` | `font-size` | `0.85rem` | `0.8125rem` |
| `.setup-species__desc` | `font-size` | `0.9rem` | `0.875rem` |
| `.setup-species__price` | `font-size` | `0.85rem` | `0.8125rem` |
| `.setup-bedding__row, .setup-waste__amount` | `gap` | `10px` | `12px` |
| `#setup-waste select` | `padding` | `6px` | `8px` |
| `.hud` | `padding` | `10px 16px` | `12px 16px` |
| `.hud` | `background` | `#223322` | `#232e25` |
| `.hud` | `border-bottom` | `1px solid #2c3f2c` | `1px solid #2d3830` |
| `.actions` | `background` | `#223322` | `#232e25` |
| `.actions` | `border-left` | `1px solid #2c3f2c` | `1px solid #2d3830` |
| `.actions__slider` | `font-size` | `0.85rem` | `0.8125rem` |
| `.speed` | `padding` | `10px 16px` | `12px 16px` |
| `.speed` | `background` | `#223322` | `#232e25` |
| `.speed` | `border-top` | `1px solid #2c3f2c` | `1px solid #2d3830` |
| `.speed__buttons` | `gap` | `6px` | `8px` |
| `.speed__buttons button` | `padding` | `6px 12px` | `8px 12px` |
| `.actions__feedback` | `font-size` | `0.85rem` | `0.8125rem` |
| `.actions__feedback` | `background` | `#2c3f2c` | `#2d3830` |
| `.actions__feedback--error` | `color` | `#c0563f` | `#ef8a72` |
| `.speed__paused` | `color` | `#c0563f` | `#ef8a72` |
| `.speed__paused` | `font-size` | `0.85rem` | `0.8125rem` |
| `#hud-status.hud__status--alert` | `color` | `#c0563f` | `#ef8a72` |
| `.actions__feedback--flash` | `animation` | `feedback-in 0.28s ease-out` | `feedback-in 0.3s ease-out` |
| `dialog.chooser[open]` | `animation` | `dialog-in 0.18s ease-out` | `dialog-in 0.16s ease-out` |
| `dialog.chooser[open]::backdrop` | `animation` | `backdrop-in 0.18s ease-out` | `backdrop-in 0.16s ease-out` |
| `.actions__btn--warn` | `background` | `(none)` | `rgba(224, 177, 60, 0.12)` |
