---
date: 2026-05-08
topic: Mobile completed-days hide + icon/family-color refresh
status: design
---

# Mobile completed-days hide + icon/family-color refresh

Three small visual changes to the home-base web dashboard:

1. Hide past days on mobile (current week only)
2. Replace the literal house favicon with a geometric "nested frame" mark
3. Shift the family-event accent color from sage `#87968b` to plum `#8a5a7a`

These are independent. They share a commit because they're all small surface-polish work.

## 1. Mobile: hide past days on current week

**Problem:** On a 1-column mobile layout, by Wednesday the user must scroll past 3 dead days (Sun/Mon/Tue) before reaching today.

**Change:** In [WeekDashboard.tsx](web/src/components/WeekDashboard.tsx) where each `DayColumn` is rendered as a grid child, conditionally apply Tailwind `hidden sm:block` on past-day columns when `weekOffset === 0`.

Logic:
- A day is "past" when `date < todayDate && !isToday` (the `isPast` flag already computed at [WeekDashboard.tsx:248](web/src/components/WeekDashboard.tsx#L248)).
- Hide rule applies only on the current week (`weekOffset === 0`). Past or future weeks show all 8 days on every breakpoint — no "today" anchor exists in those weeks.
- Implementation: pass an extra wrapper class to `DayColumn`, or wrap the rendered `<DayColumn>` in a `<div className="hidden sm:block">` when the day is past on the current week. Wrapping is cleanest because it doesn't require a `DayColumn` API change.

Trade-off accepted: on Saturday of the current week, mobile shows just 2 cards (Sat + the next-Sun peek). That shrinking footprint is the desired behavior.

## 2. App icon: geometric "nested frame" mark

**Files affected:**
- [web/public/favicon.svg](web/public/favicon.svg) — full rewrite
- [web/public/apple-touch-icon.png](web/public/apple-touch-icon.png) — regenerated 180×180 from the new SVG

**New SVG:**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#3a4d63"/>
  <rect x="6" y="6" width="20" height="20" rx="3.5" fill="white"/>
  <rect x="11" y="11" width="10" height="10" rx="2" fill="#3a4d63"/>
</svg>
```

Outer slate base → white inset tile → slate inner cutout. Three concentric rounded squares producing a "frame within a frame" silhouette. ~5px frame ring at 32px viewBox (≈15% of width). Background slate `#3a4d63` matches the existing theme-color meta tag, so no `index.html` changes.

**PNG regeneration:** use `npx --yes @resvg/resvg-js-cli` (zero system deps, WASM renderer):

```
npx --yes @resvg/resvg-js-cli web/public/favicon.svg -o web/public/apple-touch-icon.png --width 180 --height 180
```

If that package isn't on npm under that exact name, fallback to `sharp` via a one-shot script — verify at execution time and adjust.

## 3. Family accent color: sage → plum

**File:** [web/src/index.css](web/src/index.css#L143-L144)

```diff
-  --color-hb-fam-accent: #87968b;
-  --color-hb-fam-fade: #f1f4f1;
+  --color-hb-fam-accent: #8a5a7a;
+  --color-hb-fam-fade: #f5eef2;
```

Used at:
- [DayColumn.tsx:393](web/src/components/DayColumn.tsx#L393) — 6px family-event dot prefix (only place `bg-hb-fam-accent` is applied today)
- `--color-hb-fam-fade` — defined but not currently referenced in TSX/CSS. Updated for parity in case it gets wired up later.

Color sits as a clean third pole alongside Caitie's gold `#e8c66e` and Nat's blue `#6c87a6` — distinct hue, similar value range.

## Out of scope

- TRMNL display icon assets (separate Python pipeline)
- `theme-color` meta tag in [index.html](web/index.html) — stays slate
- Any tablet/desktop layout changes
- Family-event styling beyond the accent dot color

## Verification

- `npm --workspace web run build` succeeds
- Manual: dev server, resize to <640px, confirm past days disappear on the current-week view and reappear when navigating to next/previous week
- Manual: open the new favicon.svg + regenerated PNG in a browser, confirm at 16px and 180px the frame mark is recognizable
- Manual: check the family-event dot on `WeekDashboard` renders in plum
