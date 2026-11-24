---
name: Jiggered
description: A calm personal ledger for daily energy and symptom episodes.
colors:
  accent: "#285c46"
  accent-hover: "#1c4735"
  accent-soft: "#edf2e7"
  accent-dark: "#b9d6a4"
  accent-soft-dark: "#2e4132"
  paper: "#f8f9f4"
  paper-dark: "#17221c"
  surface: "#fffefb"
  surface-dark: "#203028"
  ink: "#203c31"
  ink-dark: "#eef2e6"
  muted: "#52655a"
  muted-dark: "#b4c4b4"
  line: "#d9e1d4"
  line-dark: "#3b4d3f"
  sage: "#64825a"
  sage-dark: "#a6c98e"
  amber: "#a77a24"
  amber-dark: "#e1bb70"
  red: "#b55f4b"
  red-dark: "#ea9b84"
  terracotta: "#b66a32"
  terracotta-deep: "#9b5526"
  on-accent: "#ffffff"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(52px, 5.5vw, 76px)"
    fontWeight: 600
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Bricolage Grotesque, Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(32px, 3.8vw, 48px)"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "-0.045em"
  title:
    fontFamily: "Bricolage Grotesque, Segoe UI, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Atkinson Hyperlegible, system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  ui:
    fontFamily: "Atkinson Hyperlegible, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  button:
    fontFamily: "Atkinson Hyperlegible, system-ui, -apple-system, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.45
  label:
    fontFamily: "Atkinson Hyperlegible, system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.1em"
  numeric:
    fontFamily: "Bricolage Grotesque, Segoe UI, system-ui, sans-serif"
    fontSize: "42px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
rounded:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  pill: "999px"
spacing:
  "0-5": "2px"
  "1": "4px"
  "1-5": "6px"
  "2": "8px"
  "2-5": "10px"
  "3": "12px"
  "3-5": "14px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
  "20": "80px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "12px 19px"
    height: "46px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "10px 15px"
    height: "44px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.ui}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
    height: "44px"
  button-public:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.sm}"
    padding: "16px 24px"
    height: "56px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "11px 12px"
    height: "44px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "25px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "10px 17px"
    height: "46px"
  tab-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  badge:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "2px 8px"
---

# Design System: Jiggered

## Overview

**Creative North Star: "The Restful Ledger"**

Jiggered is a well-kept personal record, not a dashboard. Its visual world is warm paper, deep sage ink and quiet hairlines: the calm of a ledger someone tends for themselves, where the arithmetic of a day is legible at a glance and never turned into a verdict. The interface is plain-spoken British English in mood as well as copy — no cheerleading, no alarms, no score. Warmth comes from restraint: creamy grounds, softly rounded panels, generous touch targets, and typography chosen so a tired reader can still read it.

The app and the public pages share one palette, one type pairing and one card language, but they use different registers. Signed in, the surface is an Operate tool: dense enough for daily use, one clear action per panel, status colour reserved for status. Signed out, the same world opens up into a Persuade page: larger display type, wider breathing room, a real screenshot rather than an illustration, and the same quiet green instead of marketing gloss. Neither register is allowed to become clinical or gamified; Jiggered records what happened, and the design must never imply that the person is being measured.

The character is calm, candid and quietly encouraging. The interface never celebrates a "streak", never scolds a gap, and never dresses a record as a target. Absence is drawn honestly with a dashed line. Numbers are steady and tabular. Motion is short and functional: hover, press, and one soft rise as content enters.

**Key Characteristics:**
- Warm paper ground, deep sage accent, soft sage tint for selection.
- Bricolage Grotesque for display and numerals, Atkinson Hyperlegible for everything read or operated.
- Softly rounded, hairline-bordered panels on a 4px spacing grid.
- Status green, amber and red used only to encode recorded state or allowance level.
- Phone-first layout with a bottom tab bar and 44px minimum touch targets.
- Flat at rest; only floating layers carry a pop shadow.
- Dashed hairlines where something is absent, held or reduced.

## Colors

A sage-and-cream palette with one warm terracotta note; colour is quiet, earthy and never fluorescent.

### Primary
- **Deep Sage** (#285c46): the single action and selection accent — primary buttons, selected tabs, chips, focus-adjacent emphasis, chart lines, the energy ring. In dark mode it becomes **Pale Sage** (#b9d6a4).
- **Sage Wash** (#edf2e7): selected rows, tinted cards, onboarding, the softer half of the accent pair. Dark mode: **Deep Moss Tint** (#2e4132).
- **Deep Pine** (#1c4735): the public button hover. The signed-in app's primary button has no hover colour of its own; it relies on its raised target and press feedback.

### Secondary
- **Terracotta** (#b66a32): the warm counterpoint — public focus rings and the one warm accent allowed outside the status palette.
- **Burnt Terracotta** (#9b5526): public link hover.

### Tertiary
- **Check-in Sage** (#64825a): the green of a good check-in, the highlight inside the landing headline, chart and mini-demo green. Dark mode: **Light Sage** (#a6c98e).
- **Muted Amber** (#a77a24): low allowance, poor sleep, warnings and the app's focus ring. Dark mode: **Soft Amber** (#e1bb70).
- **Earthen Red** (#b55f4b): out-of-allowance, destructive actions and errors. Dark mode: **Soft Coral** (#ea9b84).

### Neutral
- **Warm Paper** (#f8f9f4): the page ground everywhere, app and public. Dark mode: **Green-Black Paper** (#17221c).
- **Cream Surface** (#fffefb): panels, cards, inputs, the raised surface against paper. Dark mode: **Deep Surface** (#203028).
- **Forest Ink** (#203c31): all body and heading text. Dark mode: **Herb Ink** (#eef2e6).
- **Sage Grey** (#52655a): secondary text, metadata, placeholders, quiet labels. Dark mode: **Pale Sage Grey** (#b4c4b4).
- **Hairline Sage** (#d9e1d4): the 1px border that defines almost every surface. Dark mode: **Deep Hairline** (#3b4d3f).
- **Pure White** (#ffffff): text on the public button only; the signed-in primary uses paper.

### Named Rules

**The One Accent Rule.** Deep Sage is the only accent used to mean "act" or "selected". Status colours never decorate a button, a heading or a marketing flourish; they only describe a recorded state or an allowance level.

**The Honest Status Rule.** Green, amber and red are always paired with a word or a number (Green / Amber / Red, the cost badge, the balance). Colour alone never carries the meaning.

## Typography

**Display Font:** Bricolage Grotesque (with Segoe UI, system-ui)
**Body Font:** Atkinson Hyperlegible (with system-ui, -apple-system)

**Character:** A slightly quirky, warm grotesque for the few moments that deserve a voice, over a hyperlegible workhorse for everything a tired person has to read, operate or scan. The pairing is deliberately unequal: personality at the top of the page, legibility everywhere else.

### Hierarchy
- **Display** (600, clamp 52–76px, 0.98): landing hero and closing statement only; tight -0.04em tracking.
- **Headline** (600, clamp 32–48px public, 36px app masthead, 1.06): public section headings and the app masthead; -0.045em to -0.055em.
- **Title** (600, 24px, 1.2): panel headings, tool titles and detail headings; -0.035em.
- **Body** (400, 16px in the app and 18px in public articles, 1.6–1.7): paragraphs and long-form reading; public articles cap near 65–75ch and use pretty wrapping.
- **UI** (400, 14px, 1.45): secondary text, metadata, hints, chips and most controls.
- **Button** (700, 16px, 1.45): primary and secondary buttons, inheriting the body face.
- **Label** (700, 12px, 0.08–0.12em, uppercase): app eyebrows, section labels and badges. Public eyebrows are the exception: 14px, 500, sentence case, no tracking.
- **Numeric** (700, 42–58px, 1): balances and large stat numerals in Bricolage with tabular figures; smaller costs and dates also use tabular figures.

### Named Rules

**The Two-Voice Rule.** Bricolage Grotesque is for display, headings and numerals. Every paragraph, label, control and piece of UI text is Atkinson Hyperlegible. Never set readable copy in the display face.

**The Quiet Eyebrow Rule.** Uppercase tracking belongs to the signed-in app's small labels. Public eyebrows are sentence case, medium weight and untracked; they are a quiet signpost, not a badge.

**The Steady Numbers Rule.** Any number that can change — balances, costs, dates, counts — uses tabular figures so a column never shifts as values update.

## Layout

A phone-first single column that opens into a calm two-column desktop. The app wraps at 1264px with 32px side padding; public pages use a 1200px shell (96px gutters, 56px under 1050px, 40px under 760px). Content widths stay narrow on purpose: Today is 560px on a phone, Account and Help 760px, Admin 900px; public articles are 760px and the landing hero splits 1.05fr / 1fr with a 56px gap. At 960px Today becomes a sticky side column of 320–400px beside a fluid main column.

Spacing is a 4px grid with 2px half-steps for tight UI: 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 48 and 80px. Panels use 25px internal padding and a 17px child gap; public cards use 32px. Sections breathe at 24–32px, public bands at 80–96px. Breakpoints are literal because CSS custom properties cannot be read inside media queries: 480px (small phone), 600px (bottom tab bar), 700px (phone), 760px (public phone), 960px (desktop app grid), 1050px and 1200px (public shell).

On phones every touch target is at least 44px and bottom tab buttons are 48px; desktop-only text links and chips can be visually smaller. On phones the app's tab bar moves to a fixed bottom bar, Save stays sticky above it, and the header drops its date and account name to keep one row. Long forms and episode editing get a sticky save bar rather than a long scroll back to the top.

### Named Rules

**The One-Frame Rule.** Every app view shares the same masthead height, tab-bar position and content frame, so switching tabs never makes the interface jump. Each view sets its own content width inside that frame.

**The Thumb-First Rule.** Primary navigation and save actions live at the bottom of the phone screen, inside the safe-area inset, never behind a hover or a top-corner control.

## Elevation & Depth

Bordered, softly lifted. Panels are flat at rest: a 1px hairline border, a cream surface and only a faint ambient shadow (0 3px 12px at 1% ink) to keep them from looking cut out. Depth is carried by the border and the paper/surface contrast, not by stacked shadows. Things that genuinely float — the account menu, tooltips, the toast bar, the editing sheet — get the stronger pop and sheet shadows. The shadow ink is themed, so shadows are dark green-tinted on paper and black in dark mode.

### Shadow Vocabulary
- **Ambient card** (`0 3px 12px rgba(32, 60, 49, 0.01)`): resting panels, barely visible.
- **Ambient tab rail** (`0 3px 14px rgba(32, 60, 49, 0.02)`): the sticky tab bar.
- **Small** (`0 2px 6px color-mix(in srgb, var(--shadow-ink) 8%, transparent)`): small lifted details.
- **Medium** (`0 4px 12px ... 14%`): hero screenshot and profile avatar.
- **Pop** (`0 8px 28px ... 22%`): menus, tooltips, toasts, drag previews.
- **Sheet** (`0 24px 60px ... 30%`): the floating editor and dialog sheet.
- **Backdrop** (`color-mix(in srgb, var(--fg) 40–45%, transparent)` plus a 3px blur): behind a sheet or dialog.

### Named Rules

**The Flat-At-Rest Rule.** A static panel carries a border and at most an ambient shadow. A pop shadow is a signal that the element floats above the page, so it is reserved for menus, tooltips, toasts, drag previews and sheets.

**The No-Card-On-Card Rule.** Nested content uses a tinted fill or a hairline divider, not another bordered card with its own shadow.

## Shapes

Soft rectangles, gently rounded, with a calm and slightly domestic geometry. Interactive surfaces use 8px corners (inputs, buttons), 12px for check-in options, 16px for panels and sheets, 24px for the hero screenshot and large avatars, and a full pill for chips, filters, badges and tags. Nothing interactive is sharp-cornered; the 4px step is reserved for small status cells, matrix cells and hairline details. Avatars and the help button are circles. The wordmark is set tight (-1.5px) to feel like a stamp rather than a logo lockup.

The recurring signature is the dashed hairline: a lost allowance cell, an empty day, a held or refused change, an empty chart and the dotted rule under the hero caption all draw absence or incompleteness with dashes rather than leaving a blank. Dashed borders always use a muted or accent tone at reduced strength, never a solid alarm colour.

### Named Rules

**The Dashed-Not-Empty Rule.** When something is absent, held or reduced, draw it with a dashed hairline and a short explanation. Never let an empty state read as a zero.

**The Soft-Corner Rule.** Panels stop at 16px, inputs and buttons at 8px. Bigger radii belong to sheets (16px) and the hero screenshot (24px); no card gets a 24px+ radius.

## Components

### Buttons
- **Shape:** gently rounded 8px, minimum height 44px (46px for primary, 56px for the public call to action).
- **Primary:** deep sage fill, paper or white text, 700 weight, 12px 19px padding in the app and 16px 24px on public pages. The public button darkens to Deep Pine on hover and presses down 1px; the app button is a solid target with no separate hover colour.
- **Secondary:** cream surface, sage text, 1px sage border, 10px 15px padding; hover fills with Sage Wash.
- **Ghost:** transparent, muted text, hairline border, 14px; hover lifts the text to ink. Day navigation turns it into a 40px circle.
- **Focus:** 3px warm ring — amber in the app, terracotta on public pages — offset 4–5px. Small custom controls (chips, switches) use a 2px sage ring at 1–2px offset.
- **Disabled:** 50% opacity (65% for the public submit) with a default cursor.

### Chips
- **Style:** full pill, 1px hairline border, cream surface, 14px text, 8px 12px padding; on phones the target grows to 44px tall.
- **State:** checked chips fill with Sage Wash, take a sage border and 700 weight. Favourite chips get a 45% sage border. Focus follows the standard sage ring.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** Cream Surface on Warm Paper; tinted cards use Sage Wash.
- **Shadow Strategy:** flat at rest with the ambient card shadow; see Elevation & Depth.
- **Border:** 1px Hairline Sage. Warning, setup and onboarding cards add a 4px left border in red, sage or amber.
- **Internal Padding:** 25px in the app, 32px on public cards, with a 17px grid gap.

### Inputs / Fields
- **Style:** cream surface, 1px hairline, 8px radius, 44px minimum height, 11px 12px padding; 16px body type for the value and 14px for the label.
- **Focus:** the app's 3px amber ring at 4px offset (terracotta at 5px on public pages); public auth fields also shift their border to sage.
- **Error / Disabled:** invalid fields take a 2px red outline; disabled controls fade to 50%. Placeholders use Sage Grey, never the browser default.

### Navigation
- **App tabs:** a bordered cream rail with 7px padding; each tab is 46px tall, 14px, 700 weight, 12px radius, with transparent background. Selected tabs take Sage Wash with sage text and a hairline border; hover fills with paper. Under 600px the rail becomes a fixed bottom bar with 48px buttons and safe-area padding.
- **Public nav:** 14px text links with 18px column gaps, no underline at rest, terracotta on hover; the current page gets a 2px underline 6px below the text. On phones the links wrap into their own row below the wordmark and call to action.
- **Account menu:** a pill-shaped summary with a 36px circular avatar; the popover is a pop-shadow panel with 44px menu rows.

### Check-in Options
Three equal columns, each a 12px-radius button with a 19px status dot, a bold Green/Amber/Red name, a one-word mood and a small cost badge. Selected turns the dot into a tick, tints the background at 9% of the status colour and colours the border with it. The selected state is always reinforced by the tick and the words, never by colour alone.

### Energy Gauge
A 222px SVG ring with a 12px stroke, the balance as a large Bricolage numeral inside, and a 10-column cell bar below for the allowance arithmetic (available, planned, used, reduced). The ring's colour follows the same state palette; the number stays tabular so it doesn't jitter. In Spoons mode the cells become spoon outlines and the ring keeps its geometry.

### Day Cells
The History matrix uses one cell language in three layouts: a 56px list row, a 58px calendar square, and a heatmap cell that shrinks to fit longer periods. A day is tinted by check-in or spend level, never by decoration; an episode adds a small corner dot, absence is dashed, and the selected day takes a 2px ink outline.

## Do's and Don'ts

### Do:
- **Do** keep the 4px spacing scale and 1px hairline borders; the system's calm comes from consistent rhythm.
- **Do** use Deep Sage for actions and selection, and warm terracotta for public focus and link hover.
- **Do** set readable text in Atkinson Hyperlegible and reserve Bricolage Grotesque for display, headings and numerals.
- **Do** keep touch targets at 44px or more, 48px for the phone tab bar, and respect safe-area insets.
- **Do** draw absence, held changes and reduced allowance with dashed hairlines and a short explanation.
- **Do** use tabular numerals for every balance, cost, count and date.
- **Do** keep focus visible: a 3px warm ring (amber in the app, terracotta on public pages) at 4–5px offset, or the 2px sage ring on chips and switches.
- **Do** let public pages use the same world at a larger scale: bigger display type, real screenshots, more space.

### Don't:
- **Don't** use status green, amber or red as decoration or generic emphasis; they encode recorded state only.
- **Don't** gamify: no streaks, scores, trophies, confetti, celebratory copy or guilt about a gap.
- **Don't** introduce clinical-dashboard cues — alert reds everywhere, dense grids, cold greys, medical chrome.
- **Don't** add a second display face, set body copy in Bricolage, or use uppercase tracking on public eyebrows.
- **Don't** set UI text below 12px or touch targets below 44px.
- **Don't** put a pop shadow on a static panel or stack cards inside cards with their own borders.
- **Don't** use purple gradients, glassmorphism, glossy blobs, glow effects, emoji labels or badge confetti.
- **Don't** round panels past 16px or use sharp corners on interactive surfaces.
