# Mission Control design plan: white and Goodwill Blue

Visual-only. Same routes, data, copy meaning and behavior as before. This replaces the
earlier "Goodwill Michiana theme" (blue rail, yellow markers, pale blue-gray canvas,
Figtree + Barlow Condensed), which read as a template with a brand coat of paint.

**Design read:** an internal finance and operations tool for a nonprofit's COO and finance
team, in the restrained register of Stripe's dashboard, Mercury, Ramp and Linear. Trust and
legibility first. Dials: variance 3, motion 2, density 6.

## Principles

1. **White and one blue.** Surfaces are white; Goodwill Blue is the only accent and means
   "interactive or selected": primary buttons, links, active nav, focus rings, selected
   options, the ShopGoodwill series. It is never used as decoration or as a large fill.
2. **Structure from type and hairlines, not from boxes.** Hierarchy comes from size, weight
   and gray level. Groups are separated by 1px lines. Shadows exist only on things that
   float (menus, tooltips, the drawer, the chat panel).
3. **Numbers are for reading.** One family for text and numbers, tabular figures everywhere,
   no condensed display face, no oversized hero numbers. The biggest number on any page is
   30-40px.
4. **Fewer containers.** Related numbers share one surface split by hairlines (a "stat
   strip") instead of three floating cards. Rankings are small tables, not card lists.
5. **Color only where it carries meaning.** Status colors only for status (always with an
   icon or text). Series colors only on chart marks and the small swatch that names them.
   Text is always ink, never a series color.

## Palette

Every existing token name is kept (other lanes reference them). Values changed.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--bg` | page | `#FFFFFF` | `#0F1114` |
| `--surface` | panels, tables | `#FFFFFF` | `#15181D` |
| `--surface2` | table headers, hover, wells, segmented controls | `#F6F8FA` | `#1C2026` |
| `--line` / `--line2` | borders / row dividers | `#E3E7EC` / `#EEF1F4` | `#2A2F37` / `#22262D` |
| `--ink` | primary text (17.9:1 on white) | `#0E1726` | `#E6E9ED` |
| `--ink2` | secondary text | `#3D4756` | `#B8BFC8` |
| `--ink3` | muted text (5.9:1 on white, 5.5:1 on surface2) | `#5B6574` | `#8B94A0` |
| `--ink4` | decorative only (empty marks, dashed rings) | `#A3ABB6` | `#59616C` |
| `--accent` | Goodwill Blue (7.8:1 on white); dark is lightened (7.2:1 on dark surface) | `#01529C` | `#6EA8EA` |
| `--accent-ink` | text on accent | `#FFFFFF` | `#0F1114` |
| `--accent-soft` / `--accent-line` | active nav fill, selection, focus-adjacent tints | `#EEF4FB` / `#C3D6EC` | `#172537` / `#29496F` |
| `--brand` | same as accent (kept as a name) | `#01529C` | `#6EA8EA` |
| `--brand-yellow` | **retired**; mapped to the blue so old references stay harmless | `#01529C` | `#6EA8EA` |
| `--rail` | sidebar / mobile header (near-white, hairline edge) | `#FAFBFC` | `#121418` |
| `--rail-ink*`, `--rail-hover`, `--rail-line`, `--rail-ok` | sidebar text, hover, edge | ink scale, `#EFF2F5`, `#E3E7EC` | ink scale, `#1C2026`, `#2A2F37` |
| `--ok` / `--ok-soft` | on track, received | `#1D7148` / `#ECF6F0` | `#5FCF95` / `#12271D` |
| `--warn` / `--warn-icon` / `--warn-soft` | near target, warnings (ochre, text 6.3:1) | `#8A5300` / `#B86E00` / `#FBF3E4` | `#F0AE6A` / `#F0AE6A` / `#2A2015` |
| `--bad` / `--bad-soft` | off track | `#B42318` / `#FCEFEE` | `#F2918A` / `#2C1817` |
| `--muted` / `--muted-soft` | awaiting, not due | `#5B6574` / `#F1F3F6` | `#A2AAB5` / `#1F232A` |
| `--s1..--s4` | single-hue blue sequence (category bars) | `#01529C` `#5B8CC4` `#A9C3E2` `#DFE6EE` | `#6EA8EA` `#4A7FBF` `#2D5283` `#2C333D` |
| `--shadow` | card shadow: none | `0 0 #0000` | `0 0 #0000` |
| `--shadow-pop` | floating layers only | `0 1px 2px / 0 8px 24px` ink at 6% / 10% | `0 8px 24px` black at 50% |

### Marketplace series (`--mk-*`)

ShopGoodwill is Goodwill's own marketplace, so it wears Goodwill Blue. Checked with the
dataviz skill's `validate_palette.js --pairs all` (every pair, since stack order changes):

| Series | Light (on `#FFFFFF`) | Dark (on `#15181D`) |
|---|---|---|
| ShopGoodwill | `#01529C` | `#2773C0` |
| Amazon | `#E08A2E` | `#C87A30` |
| eBay | `#15876A` | `#3CA17B` |
| Other e-comm | `#9AA0A8` | `#6B655E` |
| Goodwill Books (Overview filter only) | `#8A63D2` | `#9D7FE3` |

Light: lightness band PASS, CVD PASS (worst protan dE 11.8), normal vision PASS (15.9).
Dark: band PASS, CVD PASS (8.3), normal vision PASS (15.9), contrast PASS. The only FAIL in
both is the chroma floor on "Other", a deliberate neutral so the catch-all bucket recedes.
Amazon and Other are under 3:1 on white; every chart has a legend, a table view and 2px
surface gaps, which is the validator's required relief. The old plum for Books collided
with eBay's green under deuteranopia (dE 4.4), so Books moved to violet.

## Type

**Public Sans** (USWDS, via `next/font/google`, self-hosted at build) for everything: UI,
headings and numbers. **Geist Mono** only for ids, file names, batch and document numbers.

Why Public Sans:

- It is the US Web Design System's typeface, drawn for civic and public-interest
  interfaces. Goodwill is a nonprofit social enterprise; the tool should read as
  institutional and trustworthy, not as a startup landing page.
- Neutral grotesque with slightly wide proportions and open apertures: very legible at
  12-14px, which is where most of this app lives.
- Real tabular figures (`tnum`, verified in the built woff2) and clear 1/l/I and 0/O,
  which matter in ledgers and KPI tables.
- Not one of the AI-default faces (Inter, Roboto, Poppins, Montserrat, Open Sans), and not
  Geist, which is Next.js's out-of-the-box face and reads as "default Vercel app".

Considered and passed on: IBM Plex Sans (good figures, but strongly IBM-branded),
Instrument Sans and Hanken Grotesk (nice, but more "product marketing"), Onest and
Schibsted Grotesk (more personality than a ledger needs).

Scale (px): 11.5 / 12 / 12.5 / 13 / 13.5 / 14 (body) / 16 (narrative summary) / 22-24
(page title, weight 600, tracking -0.015em) / 24-40 (key numbers, weight 600, tracking
-0.02em). `font-variant-numeric: tabular-nums` on `body`. No uppercase tracked labels.

## Shape and depth

- Radius: 8px panels and drawers (`rounded-lg`), 6px controls (`rounded-md`), 4px tags and
  status badges, 2px bars and swatches. No pills except the round chat launcher and true
  status dots.
- Borders: 1px `--line` around panels, `--line2` between rows.
- Shadow: none on panels; `--shadow-pop` only on menus, tooltips, drawer and chat.
- Buttons 32px tall; primary is solid blue, secondary is white with a hairline, ghost is
  blue text. One primary action per page header.
- Motion: color and opacity transitions only (150ms), a 1px press on buttons; all of it
  collapses under `prefers-reduced-motion`.

## Per screen

- **Shell:** near-white sidebar with a hairline edge; active item is blue text on a pale
  blue fill with a 2px blue bar at the edge. Mobile: white header, tab row with a 2px blue
  underline. The demo banner is one quiet gray line ("Demo: synthetic data. No real
  customer data.") above every page. Content is capped at 1320px.
- **Overview:** left-aligned title and one-line description, update stamp on the right.
  Filters are plain bordered buttons ("Marketplace  All marketplaces"); a picked
  marketplace shows as its series swatch. The three numbers are one stat strip. The glance
  row is one surface with three columns: two small ranked tables (name, orders, revenue,
  share, trackless bar) and the biggest mover as a number plus one sentence.
- **Daily Pulse:** title, subtitle, date stepper; the summary sentence at 16px; the three
  numbers as a clickable stat strip (each column opens the drill-down); change shown as
  colored text, not pills; notices as flat tinted lines. Split bar is 10px with square
  ends and 2px gaps.
- **Monthly report:** key KPIs as a stat strip with a thin progress line and target tick;
  pillar sections as flat collapsible rows; categories table drops to three columns on
  phones (share and margin % under their dollar values), so nothing scrolls sideways.
- **Data Sources:** title, then a plain "14 of 14 sources received" line with the strip;
  tiles keep their day grid, with received days at 60% green so the page is not a wall of
  saturated color.
- **Month-end Close:** same header pattern; square tags for stage, documents and
  exceptions; Print is secondary so the close step is the only primary button.
- **Chat:** same panel, 8px radius, square-cornered suggestions and message bubbles.
- **Print:** chrome hidden; dark mode prints with the light values on white.

## Not done on purpose

- Icons stay the existing in-repo 16px line set (consistent stroke, used only in nav,
  buttons and status). Swapping to Phosphor would add a dependency for no visible gain.
- Empty numeric cells keep the ledger convention of an em dash; a hyphen would read as a
  minus sign. Em dashes were removed from labels and sentences.
