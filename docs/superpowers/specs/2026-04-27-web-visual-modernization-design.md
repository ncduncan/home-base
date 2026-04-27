# Home-Base Web — Visual Modernization Design

**Date:** 2026-04-27
**Status:** Approved direction; ready for implementation plan
**Goal:** Modernize the appearance of the web dashboard. Simple, elegant, easy to read.

---

## Design intent

Crisp and minimal as the base aesthetic — near-black on white, generous whitespace
inside columns, no decorative noise. Owner identity (Caitie / Nat) is conveyed through
quiet color cues rather than filled bands. The week reads as a horizontally-aligned
two-band rhythm (Caitie on top, Nat below) so events read across days at a glance,
not by scanning each column independently.

The user's brief: *"simple and elegant, easy to read"* — and *"don't make changes for
the sake of it; I generally like what we have."* Structure is preserved; what changes
is the visual treatment.

---

## Core visual decisions

### 1. Aesthetic direction
Crisp / minimal monochrome (Linear / Vercel-adjacent). Near-black foreground on white,
hairline neutral borders, no shadows beyond a single 1px sub-card lift.

### 2. Typography
Keep **Geist Variable** — already installed and a strong fit for the minimal direction.
Body sets at **13px** (was effectively 10–11px). Date numerals at 17px. Day-of-week labels
in tracked uppercase 11px. Times use tabular numerals.

### 3. Owner color treatment — left-edge accent + fade
Each owner section gets:
- A 2px left-edge accent rule in the owner color
- A horizontal gradient that fades from a tinted background to white over ~45% of the section width

Hex values:
- **Caitie** — accent `#e8c66e` (amber), fade `#fdf9ee → #fff`
- **Nat** — accent `#8ea5e0` (slate-blue), fade `#f4f7fd → #fff`

Color is felt at a glance without dominating. Replaces the current bright blue band
for Nat (`#305CDE`) and yellow band for Caitie.

### 4. Family / multi-day events — spanning ribbon
Multi-day, non-AMION, all-day events (e.g. "Deirdre visiting") render as a **single
spanning ribbon** that bridges the columns the event covers. Same left-edge-accent +
fade pattern as owner sections, in warm terracotta (accent `#c89b6a`, fade `#faf3ed →
#fcf6ec`). No "FAMILY" label — the color carries the meaning.

When multiple multi-day events are in flight, ribbons stack vertically in the banner row.

### 5. Today treatment
Today's day-header gets a soft grey fill (`#f6f6f6`) and the date number is suffixed
with a small "· today" tag. No border or ring (which fought with the section accents).

### 6. Past-day fade
Days that have already passed (relative to today, only when viewing the current week)
render at 50% opacity across all rows. Replaces the current 75%, which was too subtle.

### 7. Row-aligned layout
The week renders as a CSS grid with **shared rows across days**:
- Row 1 — Day headers
- Row 2 — Banner row (spanning ribbons + transparent gaps)
- Row 3 — Caitie row (one cell per day, vertically aligned)
- Row 4 — Nat row (one cell per day, vertically aligned)

Empty owner cells show the owner label and a thin `—` marker so "nothing scheduled"
reads as deliberate, not as a missing card.

The current implementation already uses `lg:grid-rows-subgrid lg:row-span-4`, so this
is closer to a refinement than a rewrite — but the spanning ribbon is genuinely new.

### 8. Density
**Comfortable** — 13px body, 17px date numerals, 6–8px section padding. 7 columns
still fit comfortably on a 1280px+ screen. Easier to read than the current ~10–11px
text without sacrificing the weekly-overview density.

### 9. Background
Page background lifts to neutral `#fafafa` (was `bg-gray-50`, a similar value but
recoded with the rest of the palette). Cards stay pure white. Single soft shadow
(`0 1px 2px rgba(0,0,0,.04)`) on each cell.

---

## Surfaces

### Week dashboard (primary surface)
The full set of decisions above applies here. Reference mockup:
`.superpowers/brainstorm/54650-1777320923/content/week-refined-v2.html`.

### Day-column header expansion (hidden events panel)
Keep current behavior. Restyle: drop the heavy gray fill in favor of a small
inline panel matching the new neutral palette. Hairline border on top.

### Event detail popover
Keep functional structure. Restyle:
- 14px body, 13px secondary
- Replace the override-amber and red-destructive colors with muted variants
  (`#a07a18` for "edited", `#a14040` for destructive actions)
- Remove drop-shadow heaviness; use a single 1px border + faint shadow

### Add-event / Add-task forms
Keep current inline-above-grid pattern. Restyle inputs to match the minimal
aesthetic: 1px gray border, 8px radius, no inner shadow. Primary action buttons in
near-black (`#111`); cancel in ghost neutral.

### Header (top bar)
Slim down. 56px height, hairline bottom border, "Home-Base" wordmark in 14px medium,
avatar + sign-out on the right. Drop the gray-100 border for `#ededed`.

### Login page
Match the new aesthetic:
- White card on `#fafafa` background
- 12px radius (was 16px / `rounded-2xl`)
- Single subtle shadow
- Black "Sign in with Google" button (was using `Button` default; keep but ensure
  the new primary color is `#111`, not the current near-black `oklch(0.205 0 0)`)

### Recently completed tasks (`<details>` block)
Keep. Restyle: 8px radius (was 12px), `#ededed` border, `#f6f6f6` row hover.

### Week navigation (Prev / Refresh / Next + "This week")
Keep functional layout. Restyle:
- Chevron buttons drop the colored hover; use neutral `#666 → #111`
- "This week" pill: 1px `#ededed` border, 8px radius, 12px text, neutral hover

---

## Things deliberately not changing

- 7-day grid structure (Sunday → Saturday)
- Caitie / Nat / family ownership categorization
- AMION shift detection and rendering logic
- Gus pickup/dropoff pill placement (in-section, beneath events)
- Override / hide / edit interaction model
- Mobile: keep current 1-column stacked layout below `lg` breakpoint
- Dark mode: leave current CSS variables intact but do not actively design for it
  in this pass (no current usage; revisit later if needed)
- Routing, state management, data fetching — purely visual changes

---

## Color palette reference

| Token | Value | Use |
|---|---|---|
| `--bg-page` | `#fafafa` | Page background |
| `--bg-card` | `#ffffff` | Cards, headers |
| `--bg-today` | `#f6f6f6` | Today's day-header fill |
| `--border-soft` | `#ededed` | Card outline, separators |
| `--border-rule` | `#f3f3f3` | Internal hairline rules |
| `--fg-primary` | `#111111` | Body text, primary buttons |
| `--fg-secondary` | `#444444` | Owner labels |
| `--fg-muted` | `#888888` | Times, secondary metadata |
| `--fg-faint` | `#bbbbbb` | Empty markers |
| `--cai-accent` | `#e8c66e` | Caitie left edge |
| `--cai-fade` | `#fdf9ee` | Caitie section gradient start |
| `--nat-accent` | `#8ea5e0` | Nat left edge |
| `--nat-fade` | `#f4f7fd` | Nat section gradient start |
| `--family-accent` | `#c89b6a` | Family ribbon edge |
| `--family-fade` | `#faf3ed` | Family ribbon gradient start |

These will live in `web/src/index.css` alongside the existing shadcn token block.

---

## Implementation surface area

The visual changes touch the following files (no new files expected):

| File | Scope of change |
|---|---|
| `web/src/index.css` | Add palette tokens; remove or supersede chart/sidebar tokens unused by app |
| `web/src/components/WeekDashboard.tsx` | Restructure grid to support row-aligned banner row + ribbon span; restyle header controls |
| `web/src/components/DayColumn.tsx` | Significant rework — split into row-cell components OR adapt to render head/banner/cai/nat slots that participate in the parent grid |
| `web/src/components/DayHeaderPanel.tsx` | Light restyle |
| `web/src/components/EventDetail.tsx` | Light restyle |
| `web/src/components/AddEventForm.tsx` | Input/button restyle |
| `web/src/components/tasks/AddTaskForm.tsx` | Input/button restyle |
| `web/src/components/tasks/TaskRow.tsx` | Spacing/typography pass |
| `web/src/components/tasks/CompletedRow.tsx` | Spacing/typography pass |
| `web/src/components/Header.tsx` | Slim down per spec |
| `web/src/pages/LoginPage.tsx` | Restyle card |

The most significant structural change is in `DayColumn` / `WeekDashboard`. Currently
each day is a self-contained card containing all its rows; the new design needs each
day to contribute cells to a parent grid that spans the whole week. The existing
`grid-rows-subgrid` usage establishes the pattern but does not yet handle the
banner-row spanning ribbon. The spanning ribbon needs:

1. A pre-pass that identifies multi-day banner events and computes their column span
2. A renderer that places each ribbon at `grid-column: <start> / <end+1>` in row 2
3. Per-day "empty banner cell" slots so the row exists even when no banner is active

---

## Out of scope

- E-ink display rendering
- Briefing email template (separate Jinja2 template, not part of the web app)
- Asana / Google API logic
- Auth flow
- Performance work
- New features (event-creation flow, override behavior, task assignment) — purely visual

---

## Open implementation questions for the plan stage

1. Should the row-aligned grid restructure happen as one cohesive change, or in
   stages (palette + typography first, then structural restructure)? Probably
   stages — palette/typography is low-risk and immediately improves things.
2. Whether to introduce a small `<DayCells />`-style helper or keep all the cells
   in `WeekDashboard.tsx` directly. Lean toward extracting per-row cell components
   to keep `WeekDashboard.tsx` readable.
