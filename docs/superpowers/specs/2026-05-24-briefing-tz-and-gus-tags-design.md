# Weekly Briefing: Eastern-Time Rendering + Inline Gus Tags

**Date:** 2026-05-24
**Surface:** Sunday briefing agent (`agent/briefing/`) only. The web dashboard is untouched.

## Problem

Two issues with the rendered weekly briefing email:

1. **Wrong times.** The agent runs in GitHub Actions under a UTC clock. `shared/.../io.ts`
   derives the Google Calendar `timeZone` request parameter from the process timezone
   (`Intl.DateTimeFormat().resolvedOptions().timeZone`), which resolves to `UTC` in CI.
   Google therefore returns regular (non-AMION) timed events in UTC, and
   `briefing-data.ts` `formatTimeRange()` reads the hour positionally — so a 6pm ET event
   renders as "10pm/11pm", and events near midnight can bucket onto the wrong day.
   AMION shifts are unaffected because the processor authors them as floating ET
   wall-clock strings (no offset).

2. **Redundant Gus table.** Gus pickup/dropoff lives in its own second table with a
   `Day | Dropoff | Pickup | Reason` shape. The Reason column is noise, and the separate
   table duplicates the day axis already present in "The week ahead".

## Goals

- The email renders all calendar/event times in US Eastern, regardless of where the
  agent runs.
- Gus dropoff/pickup is folded into "The week ahead" grid as small color-coded tags in
  each responsible person's own column. The separate Gus table (and its Reason column) is
  removed.

## Non-goals

- No changes to `shared/` rules (AMION processing, gus-care computation, calendar IO).
- No changes to the web dashboard.
- No change to the Gus calendar-invite sync (`syncGusCareInvites`) — it already writes
  events with an explicit `timeZone: 'America/New_York'`.

## Design

### 1. Force Eastern Time for the agent process

All of the agent's date code already implicitly assumes "system local time = ET" (it was
written/tested on an ET dev machine). The fix makes CI match that assumption rather than
reworking each call site.

- **`.github/workflows/weekly_briefing.yml`** — add `TZ: America/New_York` to the
  `env:` block of the "Run weekly briefing" step (alongside the existing secrets). This is
  the production-critical change: it is guaranteed to be set before the Node process
  starts.
- **`agent/briefing/src/index.ts`** — add `process.env.TZ ??= 'America/New_York'` as the
  first executable statement of the module (before `main()` runs and before any
  timezone-sensitive `Date` is constructed). This bulletproofs local dry-runs on non-ET
  machines and documents the intent in code.

With the process in ET:
- `io.ts` sends `timeZone=America/New_York` to Google, so returned `dateTime` values
  carry the ET offset (e.g. `2026-05-25T18:00:00-04:00`). Positional slicing of both the
  hour (`formatTimeRange`) and the date (`eventDates`) is then correct.
- AMION floating datetimes are interpreted as ET — unchanged, still correct.
- `computeWeekWindow()` and the `T12:00:00` day-label parsing resolve in ET — correct.

**Logging policy:** unaffected. The log helper uses `new Date().toISOString()`, which
always emits UTC (`Z`) regardless of `TZ`. No event content is logged.

### 2. Gus tags inside each owner's column

Edits are confined to `agent/briefing/src/email-template.ts`. `briefing-data.ts` already
exposes `day.gus: GusResponsibility | null` (with `pickup` / `dropoff` owners), so no
data-shape change is needed. The `reason` field is simply no longer read.

- **Remove** the "Gus pickup &amp; dropoff" `<h2>` heading, the `renderGusTable(data)`
  call, and the `renderGusTable` function.
- **Per day, per owner column**, after the event list, render Gus tags derived from
  `day.gus`:
  - if `day.gus.dropoff === <owner>` → a `↓ Gus drop` tag
  - if `day.gus.pickup === <owner>` → a `↑ Gus pick` tag
  - both can appear in one column (same person drops and picks); order is drop then pick.
- **Tag style** mirrors the dashboard avatar chip: owner *fade* background, owner *accent*
  border, dark text, small font. Owner colors (from `web/src/index.css`):
  - Nat — accent `#6c87a6`, fade `#f1f5f8`
  - Caitie — accent `#e8c66e`, fade `#fdf9ee`
- **Empty-cell rule:** a column cell shows the `—` placeholder only when it has *neither*
  events *nor* Gus tags. (Today `renderEventList` returns `—` on empty events; the cell
  renderer must instead consider events + tags together.)
- **Weekends:** `day.gus` is `null` on weekends, so no tags appear — no special-casing
  needed.
- **Caption:** directly beneath the week-grid table, add one muted caption line preserving
  the timing the old table conveyed: `Gus: ↓ drop 7am · ↑ pick 5pm`.

## Affected files

| File | Change |
|---|---|
| `.github/workflows/weekly_briefing.yml` | Add `TZ: America/New_York` to the run step `env:` |
| `agent/briefing/src/index.ts` | Add `process.env.TZ ??= 'America/New_York'` as first statement |
| `agent/briefing/src/email-template.ts` | Remove Gus table + Reason; render Gus tags in owner columns; add caption; cell `—` considers events+tags |

## Verification

- Local dry-run (`BRIEFING_DRY_RUN=true`, `BRIEFING_DRY_RUN_OUT=/tmp/briefing.html`) on the
  ET dev machine: open the HTML and confirm (a) regular event times read in ET, (b) no
  separate Gus table, (c) `↓ Gus drop` / `↑ Gus pick` tags appear in the correct owner
  columns with correct colors, (d) caption present, (e) days with no events but a Gus duty
  show the tag (not `—`), and days with neither show `—`.
- To exercise the UTC→ET path that production hits: `TZ=UTC npm start` reproduces the
  old bug (the `??=` guard does not override an explicitly-set `TZ`, so this mimics the
  old CI behavior — regular event times appear shifted). Then `TZ=America/New_York npm
  start` (or unset `TZ` so the guard supplies it) confirms times render in ET.
