# Goodwill Michiana theme for Mission Control

Visual-only restyle. Same routes, data, copy and behavior; new tokens, fonts and a few
layout refinements so the app reads as a Goodwill Michiana tool instead of a generic
analytics template.

## Sources

- goodwill-ni.org stylesheet: Goodwill Blue `#01529C` (main), yellow `#F4D152`
  (secondary), sage `#4D7C68` (tertiary), pale blue-gray `#ECF1F5` (surfaces).
- Goodwill logo standard: Goodwill Blue (PANTONE 294, `#0053A0`) + black. We do **not**
  use the "smiling G" mark (trademark); the brand shows up as a text wordmark.
- Their fonts (Filson Pro, Atrament) are licensed, so we use free stand-ins.

## Palette

Every existing token name is kept (other lanes reference them). New tokens: `--brand`,
`--brand-yellow`, `--rail*` (sidebar), `--mk-books`, `--focus`.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--bg` | page canvas (blue-gray tint) | `#F1F4F8` | `#0B1420` |
| `--surface` | cards, tables | `#FFFFFF` | `#111C2A` |
| `--surface2` | wells, hover, segmented controls | `#ECF1F5` | `#172434` |
| `--line` / `--line2` | borders / inner dividers | `#D8E0E9` / `#E6ECF2` | `#243447` / `#1B2A3B` |
| `--ink` | primary text (navy-black, never #000) | `#0E1A28` | `#E8EEF5` |
| `--ink2` | secondary text | `#3A4859` | `#B4C1D0` |
| `--ink3` | muted text (AA on bg and surface2) | `#556375` | `#8E9DB0` |
| `--ink4` | decorative only (rings, empty marks) | `#9AA7B6` | `#5A6A7E` |
| `--accent` | Goodwill Blue: buttons, links, active states | `#01529C` | `#7DB4EE` |
| `--accent-ink` | text on accent | `#FFFFFF` | `#0B1420` |
| `--accent-soft` / `--accent-line` | tints | `#E3EDF7` / `#B3CBE5` | `#13304F` / `#24507F` |
| `--brand` | brand blue for the rail and wordmark | `#01529C` | `#0E2A47` (rail) |
| `--brand-yellow` | marker only: active nav bar, focus on blue | `#F4D152` | `#F4D152` |
| `--ok` / `--ok-soft` | on track / received | `#1B6B45` / `#E3F1E9` | `#6DD29C` / `#11291D` |
| `--warn` / `--warn-icon` / `--warn-soft` | near target / warnings (burnt ochre, clearly not brand yellow) | `#8A4B00` / `#C2650A` / `#FCEEDD` | `#F0AE6A` / `#F0AE6A` / `#2E1F10` |
| `--bad` / `--bad-soft` | off track | `#B42318` / `#FDECEB` | `#F2918A` / `#2D1615` |
| `--muted` / `--muted-soft` | awaiting / not due | `#556375` / `#EBEFF4` | `#A3AFBE` / `#1E2B3B` |
| `--s1..--s4` | single-hue blue sequence (category bars, ranks) | `#01529C` `#4C86C4` `#9DBFE3` `#D3DCE6` | `#7DB4EE` `#4A84C6` `#2A5487` `#2C3A4B` |

Status colors stay semantic. Warn is a dark ochre/orange with a diamond or triangle shape
plus a label; brand yellow only ever appears as a 3px marker or focus ring on the blue
rail, never as text or as a status.

### Marketplace series (`--mk-*`)

ShopGoodwill is Goodwill's own marketplace, so it wears Goodwill Blue. Validated with the
dataviz skill's `validate_palette.js`, `--pairs all` (every pair, not just neighbors,
because the stack order changes day to day):

| Series | Light (on `#FFFFFF`) | Dark (on `#111C2A`) |
|---|---|---|
| ShopGoodwill | `#01529C` | `#2773C0` |
| eBay | `#1D7A5C` | `#3CA17B` |
| Amazon | `#EEA055` | `#C87A30` |
| Other e-comm | `#9A958E` | `#68625C` |
| Goodwill Books (Overview filter only) | `#9B5A7A` | `#C084A2` |

Light: lightness band PASS, CVD PASS (worst all-pairs protan dE 11.5), normal-vision
PASS (15.3). Dark: band PASS, CVD PASS (9.7), normal-vision PASS (16.0). The only
FAIL is the chroma floor on "Other", which is a deliberate neutral (the catch-all bucket
should recede). Amazon/Other sit under 3:1 contrast on white, which the validator allows
with relief: every chart already has a legend, direct labels or a table view, and fills
are separated by 2px surface gaps.

## Type

- **UI / body: Figtree** (next/font/google). Geometric-humanist like Filson Pro: round
  bowls, open apertures, friendly but plain. Legible at 12-14px and has tabular figures,
  which this app needs everywhere (`font-variant-numeric: tabular-nums` on body).
- **Display: Barlow Condensed** (600), standing in for Atrament's condensed signage feel.
  Used only for page titles (`h1`) and the hero numbers (Daily Pulse cards, Overview
  hero, drawer value). Nothing else.
- **Mono: Geist Mono** kept for ids, file names, batch numbers.

Scale (px): 11 / 12 / 13 / 14 (body) / 15 / 17 / 20 / page title 34-40 condensed /
hero numbers 48-72 condensed. Condensed type runs narrow, so titles go up ~6px versus the
old 28px semibold sans to keep the same visual weight.

## Shape and depth

- Radius: 12px cards (`rounded-xl`, unchanged), 8px controls, 6px chips. Kept as is.
- Shadow: one blue-tinted hairline shadow `0 1px 2px rgba(1,40,80,.06)` in light, none in
  dark. Popovers use a blue-tinted `rgba(1,30,60,.14)` instead of neutral black.

## Per screen

- **Shell / sidebar:** the one large brand moment. The desktop rail and the mobile
  header are Goodwill Blue (deep navy in dark mode) with white text, a yellow 3px marker
  on the active item, and a text wordmark "Goodwill Michiana · Mission Control". Done by
  re-scoping the ink/surface tokens inside `.rail`, so Sidebar and ThemeToggle keep their
  markup.
- **Demo banner:** pale brand tint instead of gray, ochre dot (warn semantics: synthetic).
- **Overview:** condensed title, brand-blue eyebrow, condensed hero numbers; marketplace
  bars pick up the new `--mk-*`.
- **Daily Pulse:** condensed hero numbers, chart/split in the new marketplace colors,
  blue-tinted selection band.
- **Scorecard:** pillar rules in brand blue, condensed title, sparklines in Goodwill Blue.
- **Sources / Close:** condensed title; tables and checklists inherit the token swap.
- **Chat bubble / drawer:** brand-blue launcher, blue-tinted scrims and shadows.
- **Print:** rail hidden as before; tokens fall back to light.

## Generic version vs ours

The generic version of this dashboard is what it was: indigo accent `#4651C4`, neutral
gray canvas, Geist everywhere, a white sidebar with a black square logo. It could be any
SaaS. Ours: the canvas is Goodwill's own pale blue-gray, the rail is Goodwill Blue with
the yellow marker their site uses, titles and big numbers are set in a condensed face that
echoes Goodwill's store signage, and ShopGoodwill is literally the brand color in every
chart. Everything else stays quiet: no gradients, no glass, no emoji, flat cards.
