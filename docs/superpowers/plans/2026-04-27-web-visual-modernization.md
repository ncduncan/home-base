# Web Visual Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the home-base web dashboard to a minimal, easy-to-read aesthetic with subtle owner-color cues, row-aligned days, and spanning multi-day family banners.

**Architecture:** Almost all changes are local restyling using Tailwind utility classes plus a new palette token block in `web/src/index.css`. The one structural change is in the week grid: `DayColumn` is refactored from a self-contained card into a `display: contents` fragment that emits four grid-children, so the week-level grid can host horizontally-aligned rows and a banner row that supports column-spanning ribbons. New banner-placement logic is unit-tested.

**Tech Stack:** React 19, Vite, TypeScript, Tailwind CSS v4, shadcn/ui, date-fns, lucide-react.

**Spec:** [`docs/superpowers/specs/2026-04-27-web-visual-modernization-design.md`](../specs/2026-04-27-web-visual-modernization-design.md)

---

## File map

| File | Action | Purpose |
|---|---|---|
| `web/src/index.css` | Modify | Add palette tokens, page background, body font sizing |
| `web/src/components/Header.tsx` | Modify | Slim header restyle |
| `web/src/pages/LoginPage.tsx` | Modify | Card restyle |
| `web/src/components/WeekDashboard.tsx` | Modify | Banner-row support, restyle nav controls |
| `web/src/components/DayColumn.tsx` | Modify (significant) | Convert to `display: contents` row-cell emitter; new owner section treatment; empty-state rendering |
| `web/src/components/DayHeaderPanel.tsx` | Modify | Light restyle |
| `web/src/components/EventDetail.tsx` | Modify | Light restyle, palette swap |
| `web/src/components/AddEventForm.tsx` | Modify | Input/button restyle |
| `web/src/components/tasks/AddTaskForm.tsx` | Modify | Input/button restyle |
| `web/src/components/tasks/TaskRow.tsx` | Modify | Spacing, typography pass |
| `web/src/components/tasks/CompletedRow.tsx` | Modify | Spacing, typography pass |
| `web/src/lib/banner-layout.ts` | Create | Multi-day banner → grid-column-span computation |
| `web/src/lib/banner-layout.test.ts` | Create | Unit tests for banner-layout |
| `web/vitest.config.ts` | Create (if absent) | Test runner config |
| `web/package.json` | Modify | Add `vitest` devDep + `test` script (only if not present) |

---

## Verification approach

For visual changes the verification is `npm run dev` + browser at `http://localhost:5173` rather than unit tests. Each phase ends with a manual-verification step describing exactly what to look for. The one piece of new logic — banner-layout — is unit-tested.

When running the dev server, the existing Supabase env vars are required. Assume `.env.local` is already set up. If not, copy from `.env.example`.

---

## Phase 1 — Foundation tokens & typography

### Task 1.1: Add palette tokens to index.css

**Files:**
- Modify: `web/src/index.css`

- [ ] **Step 1: Add a new `@theme inline` block (or extend the existing one) with home-base palette tokens**

Open `web/src/index.css`. After the existing `@theme inline { ... }` block (around line 83–123), add a new block specifically for the home-base palette:

```css
@theme inline {
  /* Home-base modernization palette */
  --color-hb-page: #fafafa;
  --color-hb-card: #ffffff;
  --color-hb-today-bg: #f6f6f6;

  --color-hb-border-soft: #ededed;
  --color-hb-border-rule: #f3f3f3;

  --color-hb-fg: #111111;
  --color-hb-fg-secondary: #444444;
  --color-hb-fg-muted: #888888;
  --color-hb-fg-faint: #bbbbbb;

  --color-hb-cai-accent: #e8c66e;
  --color-hb-cai-fade: #fdf9ee;

  --color-hb-nat-accent: #8ea5e0;
  --color-hb-nat-fade: #f4f7fd;

  --color-hb-fam-accent: #c89b6a;
  --color-hb-fam-fade: #faf3ed;
}
```

These become available as Tailwind utilities like `bg-hb-page`, `text-hb-fg-muted`, `border-hb-border-soft`, etc.

- [ ] **Step 2: Update body background from gray-50 to hb-page**

Find existing `App.tsx` and `DashboardPage.tsx` usages of `bg-gray-50`. Leave them alone for now — they get updated in later tasks alongside the surfaces they live on. (Tokens being available is the only goal of this task.)

- [ ] **Step 3: Verify the dev server still builds cleanly**

```bash
cd web && npm run dev
```

Expected: server starts, no Tailwind compile errors. Visit `http://localhost:5173` — page should render exactly as before (no visible changes yet — tokens are defined but unused).

Stop the server (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
git add web/src/index.css
git commit -m "style(web): add home-base palette tokens"
```

---

### Task 1.2: Update page background and shell

**Files:**
- Modify: `web/src/App.tsx:46-50`
- Modify: `web/src/pages/DashboardPage.tsx:163-164`
- Modify: `web/src/pages/LoginPage.tsx:29-30`

- [ ] **Step 1: Replace gray-50 with hb-page on the loading screen**

In [web/src/App.tsx](../../web/src/App.tsx), change the loading screen wrapper's class from `bg-gray-50` to `bg-hb-page`. Update the loading text color too:

```tsx
if (session === undefined) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-hb-page">
      <div className="text-hb-fg-faint text-sm">Loading...</div>
    </div>
  )
}
```

- [ ] **Step 2: Update DashboardPage background**

In [web/src/pages/DashboardPage.tsx](../../web/src/pages/DashboardPage.tsx), change the outer wrapper class from `bg-gray-50` to `bg-hb-page`:

```tsx
return (
  <div className="min-h-screen bg-hb-page">
    <Header session={session} />
    <main className="px-6 py-6">
      ...
```

- [ ] **Step 3: Update LoginPage background**

In [web/src/pages/LoginPage.tsx](../../web/src/pages/LoginPage.tsx), update the outer wrapper:

```tsx
return (
  <div className="min-h-screen flex items-center justify-center bg-hb-page">
    ...
```

- [ ] **Step 4: Manual verification**

Run `cd web && npm run dev`. Open `http://localhost:5173`.

Expected: page background is now a slightly warmer near-white. The change is subtle but visible if you compare side-by-side with the previous gray-50 (which had a slight blue cast).

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/pages/DashboardPage.tsx web/src/pages/LoginPage.tsx
git commit -m "style(web): switch page background to hb-page token"
```

---

## Phase 2 — Page chrome (Header, Login)

### Task 2.1: Slim and restyle Header

**Files:**
- Modify: `web/src/components/Header.tsx`

- [ ] **Step 1: Replace Header content**

Open [web/src/components/Header.tsx](../../web/src/components/Header.tsx). Replace the entire `<header>` element with:

```tsx
return (
  <header className="h-14 border-b border-hb-border-soft bg-hb-card flex items-center px-6 justify-between">
    <span className="font-semibold text-hb-fg text-sm tracking-tight">Home-Base</span>
    <div className="flex items-center gap-3">
      {avatarUrl && (
        <img
          src={avatarUrl}
          alt="avatar"
          className="w-7 h-7 rounded-full"
          referrerPolicy="no-referrer"
        />
      )}
      <span className="text-sm text-hb-fg-secondary hidden sm:block">{displayName}</span>
      <Button
        variant="ghost"
        size="sm"
        className="text-hb-fg-muted text-xs"
        onClick={() => void supabase.auth.signOut()}
      >
        Sign out
      </Button>
    </div>
  </header>
)
```

The change is mostly token swaps (`gray-100` → `hb-border-soft`, `gray-900` → `hb-fg`, etc.). Functionally identical.

- [ ] **Step 2: Manual verification**

Run `cd web && npm run dev`. Sign in. Confirm the header looks essentially unchanged but with the new neutral palette (no blue cast in the border).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Header.tsx
git commit -m "style(web): retoken header"
```

---

### Task 2.2: Restyle LoginPage card

**Files:**
- Modify: `web/src/pages/LoginPage.tsx:31-43`

- [ ] **Step 1: Replace the card markup**

In [web/src/pages/LoginPage.tsx](../../web/src/pages/LoginPage.tsx), replace the inner card div and its contents:

```tsx
<div className="bg-hb-card rounded-xl border border-hb-border-soft shadow-sm p-10 w-full max-w-sm text-center">
  <h1 className="text-2xl font-semibold text-hb-fg mb-1 tracking-tight">Home-Base</h1>
  <p className="text-hb-fg-muted text-sm mb-8">Nat &amp; Caitie's dashboard</p>
  {unauthorized && (
    <p className="text-[#a14040] text-sm mb-4 bg-[#fcf0f0] border border-[#f1d8d8] rounded-lg p-3">
      This Google account is not authorized.
    </p>
  )}
  <Button className="w-full" onClick={handleSignIn}>
    Sign in with Google
  </Button>
</div>
```

Changes: `rounded-2xl` → `rounded-xl` (12px), `shadow-lg` → `border + shadow-sm` (calmer), `font-bold` → `font-semibold` + `tracking-tight`, error palette swapped from `red-*` to muted custom hex values from spec.

- [ ] **Step 2: Manual verification**

Run `cd web && npm run dev`. Open the login page (sign out if signed in). The card should look calmer — smaller corner radius, hairline border instead of heavy shadow, more refined heading weight.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/LoginPage.tsx
git commit -m "style(web): restyle login card"
```

---

## Phase 3 — Week grid restructure (the big one)

This phase is the highest-risk change. We restructure `DayColumn` so its top-level element uses `display: contents`, emitting four grid-children that participate directly in the week-level grid. After this, rows align horizontally (Caitie row, Nat row) across all days.

### Task 3.1: Restructure WeekDashboard grid + DayColumn cell emission

**Files:**
- Modify: `web/src/components/WeekDashboard.tsx:247-287`
- Modify: `web/src/components/DayColumn.tsx:246-346`

- [ ] **Step 1: Update the WeekDashboard grid container**

In [web/src/components/WeekDashboard.tsx](../../web/src/components/WeekDashboard.tsx), find the `div` around line 247 with class `grid grid-cols-1 lg:grid-cols-7 ...` and replace with:

```tsx
<div className="grid grid-cols-1 lg:grid-cols-7 lg:grid-rows-[auto_auto_1fr_1fr] gap-2 lg:gap-x-2 lg:gap-y-0">
  {days.map(({ date }) => {
    const dayDateStr = format(date, 'yyyy-MM-dd')
    const isToday = isSameDay(date, todayDate)
    const isPast = date < todayDate && !isToday
    const dayEvents = events.filter(e => {
      if (e.all_day && !e.is_amion) {
        const start = parseISO(e.start)
        const end = parseISO(e.end)
        return start <= date && end > date
      }
      return isSameDay(parseISO(e.start), date)
    })
    const dayTasks = tasksForDay(dayDateStr, isToday)

    return (
      <DayColumn
        key={dayDateStr}
        dayIndex={days.findIndex(d => d.date === date)}
        date={date}
        isToday={isToday}
        isPast={isPast}
        events={dayEvents}
        rawEvents={rawEvents}
        overrides={overrides}
        weather={weatherByDate.get(dayDateStr)}
        gusCare={gusCareByDate.get(dayDateStr)}
        tasks={dayTasks}
        users={users}
        userEmail={userEmail}
        onSaveOverride={onSaveOverride}
        onDeleteOverride={onDeleteOverride}
        onDeleteHomebaseEvent={onDeleteHomebaseEvent}
        onToggleTask={(gid, c) => void mutations.toggleTask(gid, c)}
        onDeleteTask={(gid) => void mutations.removeTask(gid)}
        onUpdateTask={mutations.editTask}
      />
    )
  })}
</div>
```

The grid now has explicit row template `auto_auto_1fr_1fr` (header, banner, caitie, nat). We pass `dayIndex` so `DayColumn` knows its column number (1-based for CSS grid).

- [ ] **Step 2: Restructure DayColumn to emit four grid cells via `display: contents`**

In [web/src/components/DayColumn.tsx](../../web/src/components/DayColumn.tsx), replace the entire returned JSX (currently a single `<div className="flex flex-col lg:grid ...">` wrapping all four sections) with four sibling cells inside a `display: contents` fragment.

Add `dayIndex: number` to the `Props` interface (line 23–41).

Replace the return block (line 246 onwards) with:

```tsx
const colClass = `lg:col-start-${dayIndex + 1}`

return (
  <div className="contents">
    {/* Cell 1 — Day header */}
    <div className={`${colClass} lg:row-start-1 bg-hb-card border border-hb-border-soft rounded-t-xl border-b-0 ${
      isToday ? 'bg-hb-today-bg' : ''
    } ${isPast ? 'opacity-50' : ''}`}>
      <button
        onClick={() => setHeaderExpanded(!headerExpanded)}
        className="w-full px-3 py-2.5 flex items-start justify-between gap-2 text-left"
      >
        <div>
          <div className={`text-[11px] font-medium uppercase tracking-[.08em] ${
            isToday ? 'text-hb-fg-secondary' : 'text-hb-fg-muted'
          }`}>
            {format(date, 'EEE')}
          </div>
          <div className="text-[17px] font-semibold text-hb-fg leading-tight tracking-tight mt-0.5">
            {format(date, 'MMM d')}
            {isToday && <span className="ml-1.5 text-[10px] font-medium text-hb-fg-muted tracking-normal normal-case">· today</span>}
          </div>
        </div>
        {weather && (
          <div className="text-right shrink-0">
            <div className="text-base leading-none">{wmoToIcon(weather.weatherCode)}</div>
            <div className="text-[11px] text-hb-fg-muted leading-tight mt-0.5 tabular-nums">
              {weather.tempMin}–{weather.tempMax}°F
            </div>
          </div>
        )}
      </button>
      {headerExpanded && (
        <DayHeaderPanel
          date={dayDateStr}
          rawEvents={rawEvents}
          overrides={overrides}
          onUnhide={async (id) => { await onDeleteOverride(id) }}
          onClose={() => setHeaderExpanded(false)}
        />
      )}
    </div>

    {/* Cell 2 — Banner row (placeholder; spanning ribbons added in Task 5) */}
    <div className={`${colClass} lg:row-start-2 ${isPast ? 'opacity-50' : ''}`}>
      {bannerEvents.map(event => (
        <div
          key={event.id}
          className="px-3 py-1.5 bg-hb-fam-fade border-l-2 border-hb-fam-accent text-[12px] text-[#3d2f23] leading-tight border-y border-r border-hb-border-soft"
          title={event.title}
        >
          {event.title}
        </div>
      ))}
    </div>

    {/* Cell 3 — CAITIE row */}
    <div className={`${colClass} lg:row-start-3 bg-hb-card border-x border-hb-border-soft border-t border-hb-border-rule ${
      isPast ? 'opacity-50' : ''
    }`}>
      <OwnerSection
        owner="caitie"
        events={caitieEvents}
        tasks={caitieTasks}
        users={users}
        overrideMap={overrideMap}
        dayDateStr={dayDateStr}
        expandedEventId={expandedEventId}
        setExpandedEventId={setExpandedEventId}
        userEmail={userEmail}
        hasDropoff={caitieDropoff}
        hasPickup={caitiePickup}
        onSaveOverride={onSaveOverride}
        onDeleteOverride={onDeleteOverride}
        onDeleteHomebaseEvent={onDeleteHomebaseEvent}
        onToggleTask={onToggleTask}
        onDeleteTask={onDeleteTask}
        onUpdateTask={onUpdateTask}
      />
    </div>

    {/* Cell 4 — NAT row */}
    <div className={`${colClass} lg:row-start-4 bg-hb-card border border-hb-border-soft border-t-0 rounded-b-xl ${
      isPast ? 'opacity-50' : ''
    }`}>
      <OwnerSection
        owner="nat"
        events={natEvents}
        tasks={natTasks}
        users={users}
        overrideMap={overrideMap}
        dayDateStr={dayDateStr}
        expandedEventId={expandedEventId}
        setExpandedEventId={setExpandedEventId}
        userEmail={userEmail}
        hasDropoff={natDropoff}
        hasPickup={natPickup}
        onSaveOverride={onSaveOverride}
        onDeleteOverride={onDeleteOverride}
        onDeleteHomebaseEvent={onDeleteHomebaseEvent}
        onToggleTask={onToggleTask}
        onDeleteTask={onDeleteTask}
        onUpdateTask={onUpdateTask}
      />
    </div>
  </div>
)
```

Key changes:
- Outer wrapper is `<div className="contents">` (semantic `display: contents` to keep React happy with a parent).
- Each of the four cells gets its own `lg:col-start-N` and `lg:row-start-M`.
- Today is now the soft-grey header fill plus a `· today` suffix on the date number — not a border ring.
- Past day fade is `opacity-50` (was 75%) and applied to each cell individually.
- Borders are arranged so the four stacked cells visually look like one continuous card: top cell has `rounded-t-xl border-b-0`, bottom cell has `rounded-b-xl border-t-0`, middle cells have side borders only with hairline rules between.

- [ ] **Step 3: Manual verification**

Run `cd web && npm run dev`. Open the dashboard. Inspect:
- Does the week still render with 7 columns?
- Do the days look like single visually-continuous cards from header to Nat section?
- Does today have the soft-grey header + "· today" suffix?
- Are past days at 50% opacity (more faded than before)?
- Do family banner events still appear, even if styled crudely?

If the columns don't line up vertically, check that `display: contents` is preserving grid placement and that `lg:col-start-N` is being generated. Tailwind v4's JIT requires the class strings to be statically detectable — `lg:col-start-${dayIndex + 1}` produces a dynamic string. **If this is a problem**, replace with an explicit lookup:

```tsx
const COL_CLASS = ['lg:col-start-1','lg:col-start-2','lg:col-start-3','lg:col-start-4','lg:col-start-5','lg:col-start-6','lg:col-start-7'] as const
const colClass = COL_CLASS[dayIndex]
```

Apply the explicit lookup if Step 3 shows columns collapsing to col 1.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/WeekDashboard.tsx web/src/components/DayColumn.tsx
git commit -m "refactor(web): emit DayColumn cells into a 4-row week grid"
```

---

### Task 3.2: New owner section treatment + empty-state rendering

**Files:**
- Modify: `web/src/components/DayColumn.tsx` (the `OwnerSection` component, lines 94–213)

- [ ] **Step 1: Restyle the OwnerSection container**

In [web/src/components/DayColumn.tsx](../../web/src/components/DayColumn.tsx), replace the `OwnerSection` component's outer JSX. Replace:

```tsx
const headerClass = owner === 'nat'
  ? 'bg-[#305CDE] text-white'
  : 'bg-yellow-100 text-yellow-800'
const headerLabel = owner === 'nat' ? 'NAT' : 'CAITIE'

return (
  <div className="border-t border-gray-100 first:border-t-0">
    <div className={`px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${headerClass}`}>
      {headerLabel}
    </div>
    ...
  </div>
)
```

with the new edge-rule + fade pattern:

```tsx
const sectionClass = owner === 'nat'
  ? 'border-l-2 border-hb-nat-accent bg-gradient-to-r from-hb-nat-fade to-hb-card to-45%'
  : 'border-l-2 border-hb-cai-accent bg-gradient-to-r from-hb-cai-fade to-hb-card to-45%'
const headerLabel = owner === 'nat' ? 'Nat' : 'Caitie'

const isEmpty = events.length === 0 && tasks.length === 0 && !hasDropoff && !hasPickup

return (
  <div className={`${sectionClass} min-h-[80px] py-2`}>
    <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[.1em] text-hb-fg-secondary">
      {headerLabel}
    </div>

    {isEmpty && (
      <div className="px-3 text-[11px] text-hb-fg-faint italic">—</div>
    )}

    {/* Gus pills owned by this person */}
    {hasDropoff && <GusPill kind="dropoff" label="7am" />}
    {hasPickup && <GusPill kind="pickup" label="5pm" />}

    {events.length > 0 && (
      <ul>
        {events.map(event => {
          /* unchanged event rendering — keep as-is */
          ...
        })}
      </ul>
    )}

    {tasks.length > 0 && (
      <ul>
        {tasks.map(task => (
          <TaskRow
            key={task.gid}
            task={task}
            users={users}
            onToggle={onToggleTask}
            onDelete={onDeleteTask}
            onUpdate={onUpdateTask}
            compact
          />
        ))}
      </ul>
    )}
  </div>
)
```

Keep the inner `events.map(...)` body untouched (the popover trigger, override delete, etc.). Only the outer container, header label, and empty-state are new.

- [ ] **Step 2: Update GusPill colors**

In the same file, replace the `GusPill` function:

```tsx
function GusPill({ kind, label }: { kind: 'pickup' | 'dropoff'; label: string }) {
  return (
    <div className="px-3 py-1 flex items-center gap-1.5 text-[11px] text-hb-fg-secondary">
      <span className="text-hb-fg-faint">{kind === 'dropoff' ? '↓' : '↑'}</span>
      Gus {kind} <span className="text-hb-fg-muted">{label}</span>
    </div>
  )
}
```

- [ ] **Step 3: Update event row text colors inside the `events.map(...)` block**

Inside `OwnerSection`'s events list, find the `triggerButton` definition (around line 125–149) and update the inner classNames:

```tsx
const triggerButton = (
  <button
    className={`w-full text-left px-3 py-1.5 transition-colors ${
      isExpanded ? 'bg-black/[.03]' : 'hover:bg-black/[.02]'
    }`}
  >
    <div className="text-[13px] text-hb-fg leading-tight pr-5">
      {event.is_amion ? shiftLabel(event.amion_kind) : event.title}
    </div>
    <div className="text-[11px] text-hb-fg-muted leading-tight tabular-nums">
      {event.is_amion
        ? formatAmionTime(event)
        : event.all_day ? 'all day' : format(parseISO(event.start), 'h:mm a')}
    </div>
    {event.location && !event.is_amion && (
      <div className="text-[11px] text-hb-fg-muted truncate">{event.location}</div>
    )}
    {event.notes && (
      <div className="text-[11px] text-hb-fg-secondary italic">{event.notes}</div>
    )}
    {event.overridden && (
      <div className="text-[10px] text-[#a07a18] font-medium">edited</div>
    )}
  </button>
)
```

Changes: bumped event title from `text-[11px]` to `text-[13px]`, swapped grays for `hb-fg-*` tokens, swapped `amber-500` → muted `#a07a18`, added `tabular-nums` to time row.

- [ ] **Step 4: Manual verification**

Run `cd web && npm run dev`. Inspect:
- Caitie sections have a soft amber left edge fading to white from the left.
- Nat sections have a soft slate-blue left edge fading to white from the left.
- A day with no Caitie events shows the "Caitie" label + a thin `—`.
- Same for empty Nat sections.
- The horizontal Caitie row reads across all days; same for Nat row.
- Body text feels noticeably more readable (13px vs the old ~11px).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/DayColumn.tsx
git commit -m "style(web): edge-rule + fade for owner sections, empty-state rendering"
```

---

## Phase 4 — Week dashboard nav + week label

### Task 4.1: Restyle WeekDashboard header controls

**Files:**
- Modify: `web/src/components/WeekDashboard.tsx:137-200`

- [ ] **Step 1: Replace the `header` variable JSX**

In [web/src/components/WeekDashboard.tsx](../../web/src/components/WeekDashboard.tsx), find the `header` const (line 137) and replace its JSX:

```tsx
const header = (
  <div className="flex items-center justify-between mb-4 gap-4">
    <div className="flex items-center gap-1 w-44">
      <button
        onClick={() => onWeekChange(-1)}
        className="text-hb-fg-muted hover:text-hb-fg transition-colors p-1"
        aria-label="Previous week"
      >
        <ChevronLeft size={18} />
      </button>
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        className="text-hb-fg-faint hover:text-hb-fg-secondary transition-colors disabled:opacity-40 p-1"
        aria-label="Refresh"
      >
        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
      </button>
      <button
        onClick={() => onWeekChange(1)}
        className="text-hb-fg-muted hover:text-hb-fg transition-colors p-1"
        aria-label="Next week"
      >
        <ChevronRight size={18} />
      </button>
      <button
        onClick={() => onWeekChange(-weekOffset)}
        disabled={weekOffset === 0}
        className="ml-1 text-xs h-7 px-2.5 rounded-md border bg-hb-card text-hb-fg-secondary border-hb-border-soft hover:border-hb-fg-faint transition-colors disabled:opacity-40 disabled:cursor-default"
      >
        This week
      </button>
    </div>

    <h2 className="text-sm font-semibold text-hb-fg-secondary uppercase tracking-[.16em]">
      {weekLabel(weekOffset)}
    </h2>

    <div className="flex items-center gap-2 w-32 justify-end">
      <button
        onClick={() => setAddMode(addMode === 'event' ? null : 'event')}
        className={`flex items-center gap-1 text-xs h-7 px-2.5 rounded-md border transition-colors ${
          addMode === 'event'
            ? 'bg-hb-fg text-white border-hb-fg'
            : 'bg-hb-card text-hb-fg-secondary border-hb-border-soft hover:border-hb-fg-faint'
        }`}
      >
        <CalendarPlus size={12} />
        Event
      </button>
      <button
        onClick={() => setAddMode(addMode === 'task' ? null : 'task')}
        className={`flex items-center gap-1 text-xs h-7 px-2.5 rounded-md border transition-colors ${
          addMode === 'task'
            ? 'bg-hb-fg text-white border-hb-fg'
            : 'bg-hb-card text-hb-fg-secondary border-hb-border-soft hover:border-hb-fg-faint'
        }`}
      >
        <Plus size={12} />
        Task
      </button>
    </div>
  </div>
)
```

Pure token swap — no behavior changes.

- [ ] **Step 2: Manual verification**

Run dev server. Check the week-nav strip at the top of the dashboard — chevrons, refresh, "This week" pill, "Event"/"Task" toggle pills. All should look like the previous version but with the new neutral palette (no blue tinges).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/WeekDashboard.tsx
git commit -m "style(web): retoken week nav controls"
```

---

## Phase 5 — Spanning multi-day banner ribbons

This is the only phase with new logic, so we test-drive it.

### Task 5.1: Set up vitest if not already configured

**Files:**
- Modify (or create): `web/package.json`
- Create (if absent): `web/vitest.config.ts`

- [ ] **Step 1: Check if vitest is already installed**

```bash
cd web && cat package.json | grep -E 'vitest|"test"'
```

If `vitest` is listed in `devDependencies` and a `"test"` script exists, skip to Task 5.2.

- [ ] **Step 2: Add vitest as a dev dependency**

```bash
cd web && npm install --save-dev vitest
```

- [ ] **Step 3: Add a test script to package.json**

In [web/package.json](../../web/package.json), add inside `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Create a minimal vitest config**

Create [web/vitest.config.ts](../../web/vitest.config.ts):

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 5: Verify test runner starts**

```bash
cd web && npm test
```

Expected: vitest runs, finds no tests, exits 0 with "No test files found".

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.ts
git commit -m "chore(web): add vitest"
```

---

### Task 5.2: Banner-layout function — write the failing tests

**Files:**
- Create: `web/src/lib/banner-layout.test.ts`

- [ ] **Step 1: Write the test file**

Create [web/src/lib/banner-layout.test.ts](../../web/src/lib/banner-layout.test.ts):

```ts
import { describe, it, expect } from 'vitest'
import { computeBannerSpans } from './banner-layout'
import type { CalendarEvent } from '../types'

function makeBannerEvent(id: string, startDate: string, endDate: string): CalendarEvent {
  return {
    id,
    title: id,
    start: `${startDate}T00:00:00Z`,
    end: `${endDate}T00:00:00Z`,
    all_day: true,
    is_amion: false,
    amion_kind: null,
    calendar_name: 'family',
    organizer_email: null,
    location: null,
    notes: null,
    overridden: false,
  } as unknown as CalendarEvent
}

const WEEK_DATES = ['2026-04-26','2026-04-27','2026-04-28','2026-04-29','2026-04-30','2026-05-01','2026-05-02']
//                  Sun         Mon         Tue         Wed         Thu         Fri         Sat

describe('computeBannerSpans', () => {
  it('returns empty for no banner events', () => {
    expect(computeBannerSpans([], WEEK_DATES)).toEqual([])
  })

  it('produces a single-day span for a one-day banner', () => {
    const events = [makeBannerEvent('e1', '2026-04-29', '2026-04-30')]  // Wed only (end is exclusive)
    const spans = computeBannerSpans(events, WEEK_DATES)
    expect(spans).toEqual([
      { id: 'e1', title: 'e1', startCol: 4, endCol: 5, lane: 0 },
    ])
  })

  it('spans the visible portion when event covers Wed–Fri', () => {
    const events = [makeBannerEvent('e1', '2026-04-29', '2026-05-02')]  // Wed, Thu, Fri (end exclusive)
    const spans = computeBannerSpans(events, WEEK_DATES)
    expect(spans).toEqual([
      { id: 'e1', title: 'e1', startCol: 4, endCol: 7, lane: 0 },
    ])
  })

  it('clips an event that starts before the visible week', () => {
    const events = [makeBannerEvent('e1', '2026-04-23', '2026-04-28')]  // ...Sun, Mon (visible part)
    const spans = computeBannerSpans(events, WEEK_DATES)
    expect(spans).toEqual([
      { id: 'e1', title: 'e1', startCol: 1, endCol: 3, lane: 0 },
    ])
  })

  it('clips an event that ends after the visible week', () => {
    const events = [makeBannerEvent('e1', '2026-05-01', '2026-05-05')]  // Fri, Sat (visible part)
    const spans = computeBannerSpans(events, WEEK_DATES)
    expect(spans).toEqual([
      { id: 'e1', title: 'e1', startCol: 6, endCol: 8, lane: 0 },
    ])
  })

  it('drops events that fall entirely outside the week', () => {
    const events = [makeBannerEvent('e1', '2026-05-10', '2026-05-12')]
    expect(computeBannerSpans(events, WEEK_DATES)).toEqual([])
  })

  it('lays overlapping events into separate lanes', () => {
    const events = [
      makeBannerEvent('e1', '2026-04-27', '2026-04-30'),  // Mon-Wed (lane 0)
      makeBannerEvent('e2', '2026-04-29', '2026-05-02'),  // Wed-Fri (overlaps e1 on Wed → lane 1)
    ]
    const spans = computeBannerSpans(events, WEEK_DATES)
    expect(spans).toEqual([
      { id: 'e1', title: 'e1', startCol: 2, endCol: 5, lane: 0 },
      { id: 'e2', title: 'e2', startCol: 4, endCol: 7, lane: 1 },
    ])
  })

  it('reuses lane 0 when events do not overlap', () => {
    const events = [
      makeBannerEvent('e1', '2026-04-26', '2026-04-28'),  // Sun-Mon (lane 0)
      makeBannerEvent('e2', '2026-04-30', '2026-05-02'),  // Thu-Fri (no overlap → lane 0)
    ]
    const spans = computeBannerSpans(events, WEEK_DATES)
    expect(spans).toEqual([
      { id: 'e1', title: 'e1', startCol: 1, endCol: 3, lane: 0 },
      { id: 'e2', title: 'e2', startCol: 5, endCol: 7, lane: 0 },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && npm test
```

Expected: FAIL with "Cannot find module './banner-layout'" or similar — the implementation file doesn't exist yet.

- [ ] **Step 3: Commit (test-first)**

```bash
git add web/src/lib/banner-layout.test.ts
git commit -m "test(web): banner span computation tests"
```

---

### Task 5.3: Banner-layout function — implement

**Files:**
- Create: `web/src/lib/banner-layout.ts`

- [ ] **Step 1: Implement `computeBannerSpans`**

Create [web/src/lib/banner-layout.ts](../../web/src/lib/banner-layout.ts):

```ts
import { parseISO, isBefore, isAfter } from 'date-fns'
import type { CalendarEvent } from '../types'

export interface BannerSpan {
  id: string
  title: string
  startCol: number   // 1-based grid column (inclusive)
  endCol: number     // 1-based grid column (exclusive — i.e. grid-column-end)
  lane: number       // 0 = first banner row, 1 = second, etc.
}

/**
 * Given the full list of banner-eligible events (all_day, !is_amion) and the
 * week's date strings (YYYY-MM-DD, length 7, Sunday→Saturday), produce a list
 * of grid-positioned spans with non-overlapping lane assignments.
 */
export function computeBannerSpans(
  events: CalendarEvent[],
  weekDates: string[],
): BannerSpan[] {
  const weekStart = parseISO(`${weekDates[0]}T00:00:00`)
  const weekEnd = parseISO(`${weekDates[weekDates.length - 1]}T00:00:00`)
  // weekEnd is the START of the last day (Saturday); the visible week runs
  // up to but not including the next Sunday. We compare event ranges
  // (which are [start, end) in calendar-event terms) against [weekStart, weekEnd+1day).

  const visibleEnd = new Date(weekEnd.getTime() + 24 * 60 * 60 * 1000)

  type Raw = { id: string; title: string; startCol: number; endCol: number }
  const raw: Raw[] = []

  for (const event of events) {
    const start = parseISO(event.start)
    const end = parseISO(event.end)

    // Skip if event ends before week starts, or starts on/after week ends
    if (!isAfter(end, weekStart)) continue
    if (!isBefore(start, visibleEnd)) continue

    // Clip to visible range
    const clippedStart = isBefore(start, weekStart) ? weekStart : start
    const clippedEnd = isAfter(end, visibleEnd) ? visibleEnd : end

    // Convert to column indices (1-based)
    const startCol = Math.floor((clippedStart.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000)) + 1
    const endCol = Math.ceil((clippedEnd.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000)) + 1

    raw.push({ id: event.id, title: event.title ?? '', startCol, endCol })
  }

  // Sort by startCol (then by length desc, then id) for stable lane assignment
  raw.sort((a, b) =>
    a.startCol - b.startCol
    || (b.endCol - b.startCol) - (a.endCol - a.startCol)
    || a.id.localeCompare(b.id)
  )

  // Assign lanes greedily: pack each into the lowest-numbered lane
  // whose last span ended at or before this span's start.
  const laneEnds: number[] = [] // laneEnds[i] = endCol of last span placed in lane i
  const result: BannerSpan[] = []

  for (const span of raw) {
    let lane = laneEnds.findIndex(end => end <= span.startCol)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(span.endCol)
    } else {
      laneEnds[lane] = span.endCol
    }
    result.push({ ...span, lane })
  }

  return result
}
```

- [ ] **Step 2: Run tests**

```bash
cd web && npm test
```

Expected: PASS for all 8 test cases. If any fail, read the diff carefully — the column math is off-by-one prone. Trace one failing case by hand against the implementation and adjust.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/banner-layout.ts
git commit -m "feat(web): banner span computation"
```

---

### Task 5.4: Wire banner spans into WeekDashboard render

**Files:**
- Modify: `web/src/components/WeekDashboard.tsx`
- Modify: `web/src/components/DayColumn.tsx` (remove the per-cell banner rendering added in Task 3.1, since it's now centralized)

- [ ] **Step 1: Compute spans in WeekDashboard and render the banner row**

In [web/src/components/WeekDashboard.tsx](../../web/src/components/WeekDashboard.tsx), at the top of the component imports section, add:

```tsx
import { computeBannerSpans } from '../lib/banner-layout'
```

Inside the `WeekDashboard` component, just before the `return (...)` (around line 211), compute the banner spans for the visible week:

```tsx
// All-day, non-AMION events that should render as spanning ribbons
const bannerEvents = events.filter(e => e.all_day && !e.is_amion)
const weekDateStrs = days.map(d => format(d.date, 'yyyy-MM-dd'))
const bannerSpans = computeBannerSpans(bannerEvents, weekDateStrs)
```

Inside the grid (around line 247, the same `<div>` that maps over `days`), insert the banner span elements as additional children **after** the existing day cells:

```tsx
<div className="grid grid-cols-1 lg:grid-cols-7 lg:grid-rows-[auto_auto_1fr_1fr] gap-2 lg:gap-x-2 lg:gap-y-0">
  {days.map(({ date }) => {
    /* unchanged DayColumn render */
  })}

  {/* Spanning banner ribbons — always render in row 2 */}
  {bannerSpans.map(span => (
    <div
      key={span.id}
      className="hidden lg:block lg:row-start-2 px-3 py-1.5 mx-1 my-1 text-[12.5px] text-[#3d2f23] leading-tight border-l-2 border-hb-fam-accent bg-gradient-to-r from-hb-fam-fade via-[#fdf6ee] to-hb-fam-fade rounded-md border-y border-r border-[#f1e6da]"
      style={{
        gridColumnStart: span.startCol,
        gridColumnEnd: span.endCol,
        gridRowStart: 2 + span.lane,  // stack overlapping spans into successive rows
      }}
      title={span.title}
    >
      <span>{span.title}</span>
    </div>
  ))}
</div>
```

**Note on lane stacking:** if `lane > 0`, that span needs to render in row 3 instead of row 2. But the grid template only reserves one auto row for banners. For the common case (≤1 lane), this is fine. For overlap cases, we extend the grid row template dynamically:

```tsx
const bannerLaneCount = bannerSpans.reduce((max, s) => Math.max(max, s.lane + 1), 0)
const bannerRowsTemplate = bannerLaneCount > 0
  ? `auto ${'auto '.repeat(bannerLaneCount).trim()} 1fr 1fr`
  : 'auto auto 1fr 1fr'
```

Then on the grid container:

```tsx
<div
  className="grid grid-cols-1 lg:grid-cols-7 gap-2 lg:gap-x-2 lg:gap-y-0"
  style={{ gridTemplateRows: bannerRowsTemplate }}
>
```

And update `DayColumn`'s row-start values for the Caitie/Nat cells:

```tsx
const caitieRowStart = 3 + Math.max(0, bannerLaneCount - 1)
const natRowStart = 4 + Math.max(0, bannerLaneCount - 1)
```

But that means `DayColumn` now needs the banner-lane-count as a prop. Add `bannerLaneCount: number` to its props and pass it from `WeekDashboard`.

In `DayColumn`, change:

```tsx
{/* Cell 3 — CAITIE row */}
<div className={`${colClass} lg:row-start-3 ...`}>
```

to:

```tsx
const caitieRow = 3 + Math.max(0, bannerLaneCount - 1)
const natRow = caitieRow + 1
```

and use `lg:row-start-${caitieRow}` via an explicit lookup:

```tsx
const ROW_START = ['', 'lg:row-start-1','lg:row-start-2','lg:row-start-3','lg:row-start-4','lg:row-start-5','lg:row-start-6'] as const
```

(Tailwind v4 JIT requires statically-detectable class strings. Cap support at 6 banner-lanes — you'd need 5+ overlapping multi-day visits in one week to exceed it, which is implausible.)

- [ ] **Step 2: Remove the per-day banner rendering from `DayColumn.tsx`**

In [web/src/components/DayColumn.tsx](../../web/src/components/DayColumn.tsx), remove the banner rendering from Cell 2 (added in Task 3.1). Cell 2 now renders nothing per-day — banner spans come from `WeekDashboard`. Replace:

```tsx
{/* Cell 2 — Banner row (placeholder; spanning ribbons added in Task 5) */}
<div className={`${colClass} lg:row-start-2 ${isPast ? 'opacity-50' : ''}`}>
  {bannerEvents.map(event => (
    <div ...>{event.title}</div>
  ))}
</div>
```

with: nothing. Delete the entire Cell 2 block. Also remove the `bannerEvents` filter at the top of the component body and remove the import / variable references.

The grid still needs row 2 to exist — it's reserved by the `gridTemplateRows` value `'auto auto 1fr 1fr'`. The banner spans rendered by `WeekDashboard` populate it.

- [ ] **Step 3: Manual verification**

Run `cd web && npm run dev`. Test cases:

1. **No multi-day events visible.** Banner row should be empty (height collapses thanks to `auto`).
2. **One multi-day event** (e.g. add a manual all-day event spanning 2–3 days via the calendar feed). The ribbon should bridge those columns physically.
3. **An event clipped at the start of the week** (started last week). Should render only from column 1 onwards.
4. **An event clipped at the end of the week** (ends next week). Should render up to column 7.

If you don't have real data to test with, temporarily inject a test event in `WeekDashboard`:

```tsx
const bannerSpans = computeBannerSpans([
  ...bannerEvents,
  // DEBUG — remove before commit
  { id: 'debug', title: 'TEST visit', start: weekDateStrs[2] + 'T00:00:00', end: weekDateStrs[5] + 'T00:00:00', all_day: true, is_amion: false } as any,
], weekDateStrs)
```

Verify the ribbon spans Wed–Fri visually. Then **remove the debug injection before committing**.

- [ ] **Step 4: Run unit tests one more time to confirm no regressions**

```bash
cd web && npm test
```

Expected: all banner-layout tests still pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/WeekDashboard.tsx web/src/components/DayColumn.tsx
git commit -m "feat(web): render multi-day banners as spanning ribbons"
```

---

## Phase 6 — Forms restyle

### Task 6.1: AddEventForm

**Files:**
- Modify: `web/src/components/AddEventForm.tsx`

- [ ] **Step 1: Replace the form's outer styling and field tokens**

In [web/src/components/AddEventForm.tsx](../../web/src/components/AddEventForm.tsx), replace the JSX inside `return (...)`:

```tsx
return (
  <div className="px-4 py-3 bg-hb-card border border-hb-border-soft rounded-xl shadow-sm space-y-2">
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold text-hb-fg-secondary uppercase tracking-[.1em]">New event</span>
      <button onClick={onClose} className="text-hb-fg-muted hover:text-hb-fg-secondary">
        <X size={14} />
      </button>
    </div>

    <input
      autoFocus
      className="w-full text-sm bg-hb-card border border-hb-border-soft rounded-md px-2 py-1.5 outline-none focus:border-hb-fg-faint"
      placeholder="Event title..."
      value={title}
      onChange={e => setTitle(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && title.trim()) void submit()
        if (e.key === 'Escape') onClose()
      }}
    />

    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => setOwner(owner === 'nat' ? 'caitie' : 'nat')}
        title={`Owner: ${owner === 'nat' ? 'Nat' : 'Caitie'} (click to switch)`}
        className={`w-6 h-6 rounded-full text-[11px] font-semibold flex items-center justify-center border ${
          owner === 'nat'
            ? 'bg-hb-nat-fade border-hb-nat-accent text-hb-fg'
            : 'bg-hb-cai-fade border-hb-cai-accent text-hb-fg'
        }`}
      >
        {owner === 'nat' ? 'N' : 'C'}
      </button>

      <input
        type="date"
        value={date}
        onChange={e => setDate(e.target.value)}
        className="text-xs h-7 border border-hb-border-soft rounded-md px-2 bg-hb-card"
      />

      <label className="flex items-center gap-1 text-xs text-hb-fg-secondary">
        <input
          type="checkbox"
          checked={allDay}
          onChange={e => setAllDay(e.target.checked)}
          className="h-3 w-3"
        />
        all day
      </label>

      {!allDay && (
        <>
          <input
            type="time"
            value={startTime}
            onChange={e => setStartTime(e.target.value)}
            className="text-xs h-7 border border-hb-border-soft rounded-md px-2 bg-hb-card"
          />
          <span className="text-xs text-hb-fg-muted">–</span>
          <input
            type="time"
            value={endTime}
            onChange={e => setEndTime(e.target.value)}
            className="text-xs h-7 border border-hb-border-soft rounded-md px-2 bg-hb-card"
          />
        </>
      )}

      <div className="flex-1" />

      <button
        onClick={() => void submit()}
        disabled={saving || !title.trim()}
        className="text-xs h-7 px-3 bg-hb-fg text-white rounded-md disabled:opacity-40 hover:bg-black transition-colors"
      >
        {saving ? 'Adding...' : 'Add event'}
      </button>
    </div>

    {error && (
      <div className="px-2 py-1 bg-[#fcf0f0] border border-[#f1d8d8] rounded">
        <p className="text-[11px] text-[#a14040]">{error}</p>
      </div>
    )}
  </div>
)
```

Notable: the owner avatar button now uses the soft fade backgrounds with the accent border instead of a saturated fill — matches the new owner-section treatment and is far less in-your-face.

- [ ] **Step 2: Update userColors.ts to provide subtle owner-button styles**

Open [web/src/lib/userColors.ts](../../web/src/lib/userColors.ts). Replace:

```ts
export const USER_COLORS = {
  nat:    { avatar: 'bg-[#305CDE] text-white' },
  caitie: { avatar: 'bg-yellow-100 text-yellow-800' },
} as const
```

with:

```ts
export const USER_COLORS = {
  nat:    { avatar: 'bg-hb-nat-fade border border-hb-nat-accent text-hb-fg' },
  caitie: { avatar: 'bg-hb-cai-fade border border-hb-cai-accent text-hb-fg' },
} as const
```

This prevents drift between AddEventForm (which now hardcodes the same pattern) and any other consumer of `USER_COLORS`. Search for other usages:

```bash
cd web && grep -r 'USER_COLORS' src/
```

Confirm any other usage still works with the new class string. (`AssigneeButton` may use it — check that it still renders correctly in subsequent tasks.)

- [ ] **Step 3: Manual verification**

Run dev server. Click "Event" in the top nav — the new event form should open. The owner avatar should be a soft round button (not bright blue/yellow). Inputs should have hairline borders. The "Add event" button should be near-black.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AddEventForm.tsx web/src/lib/userColors.ts
git commit -m "style(web): restyle AddEventForm; soften user color tokens"
```

---

### Task 6.2: AddTaskForm

**Files:**
- Read: `web/src/components/tasks/AddTaskForm.tsx` (familiarize yourself with current structure)
- Modify: `web/src/components/tasks/AddTaskForm.tsx`

- [ ] **Step 1: Read the current file and identify color/spacing patterns**

Open [web/src/components/tasks/AddTaskForm.tsx](../../web/src/components/tasks/AddTaskForm.tsx). It uses similar patterns to `AddEventForm` — `bg-white border border-gray-200 rounded-xl`, gray-* text colors, `bg-gray-900` for primary action.

- [ ] **Step 2: Apply the same token swaps as AddEventForm**

Without changing the form's structure, replace tokens throughout:
- `bg-white` → `bg-hb-card`
- `border-gray-200` → `border-hb-border-soft`
- `text-gray-500` → `text-hb-fg-secondary`
- `text-gray-400` → `text-hb-fg-muted`
- `text-gray-900` → `text-hb-fg`
- `bg-gray-900 text-white` → `bg-hb-fg text-white`
- `hover:bg-gray-700` → `hover:bg-black`
- `red-50 / red-200 / red-600` (error block) → `bg-[#fcf0f0] border-[#f1d8d8] text-[#a14040]`
- `rounded-xl` → `rounded-xl` (keep)

Do this surgically rather than rewriting — preserve all logic and prop usage.

- [ ] **Step 3: Manual verification**

Run dev server. Click "Task" in the top nav. Form should look quieter and consistent with the new event form.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/tasks/AddTaskForm.tsx
git commit -m "style(web): retoken AddTaskForm"
```

---

## Phase 7 — Detail popover, task rows, day-header panel

### Task 7.1: EventDetail popover

**Files:**
- Modify: `web/src/components/EventDetail.tsx`

- [ ] **Step 1: Apply token swaps**

In [web/src/components/EventDetail.tsx](../../web/src/components/EventDetail.tsx), surgically replace tokens:

- `text-gray-900` → `text-hb-fg`
- `text-gray-500` → `text-hb-fg-secondary`
- `text-gray-400` → `text-hb-fg-muted`
- `text-amber-500` → `text-[#a07a18]` (the "(overridden)" badge and "edited" indicator)
- `border-gray-200 / border-gray-300` → `border-hb-border-soft / border-hb-fg-faint`
- `bg-red-50 border-red-200 text-red-600` (the "Hidden" toggle when active) → `bg-[#fcf0f0] border-[#f1d8d8] text-[#a14040]`
- `bg-white` → `bg-hb-card`

Don't change behavior or interaction logic.

- [ ] **Step 2: Manual verification**

Run dev server. Click an event in the calendar to open the detail popover. Confirm:
- Heading reads in `hb-fg`
- "Hide this event" toggle is calm (white pill, hairline border) when off, muted-red when on
- "Save Override" / "Reset" buttons unchanged in behavior

- [ ] **Step 3: Commit**

```bash
git add web/src/components/EventDetail.tsx
git commit -m "style(web): retoken EventDetail popover"
```

---

### Task 7.2: TaskRow + CompletedRow

**Files:**
- Modify: `web/src/components/tasks/TaskRow.tsx`
- Modify: `web/src/components/tasks/CompletedRow.tsx`

- [ ] **Step 1: Retoken TaskRow**

In [web/src/components/tasks/TaskRow.tsx](../../web/src/components/tasks/TaskRow.tsx), apply the surgical token swap:

- `border-gray-50 / border-gray-100 / border-gray-200` → `border-hb-border-rule / border-hb-border-soft`
- `text-gray-900` → `text-hb-fg`
- `text-gray-500` → `text-hb-fg-secondary`
- `text-gray-400` → `text-hb-fg-muted`
- `text-gray-200 / text-gray-300` → `text-hb-fg-faint`
- `bg-gray-50/50` → `bg-black/[.02]`
- `border-blue-400` (input underline) → `border-hb-fg`
- `hover:text-blue-600` → `hover:text-hb-fg`
- `text-red-500 / hover:text-red-700 / hover:text-red-400` → `text-[#a14040] / hover:text-[#7f3232]`
- Bump task name from `text-xs` to `text-[13px]` for readability consistency

- [ ] **Step 2: Retoken CompletedRow**

In [web/src/components/tasks/CompletedRow.tsx](../../web/src/components/tasks/CompletedRow.tsx), perform the equivalent token swap. Same patterns.

- [ ] **Step 3: Update the WeekDashboard's `<details>` block for completed tasks**

Find the `<details>` block at the bottom of [web/src/components/WeekDashboard.tsx](../../web/src/components/WeekDashboard.tsx) (around line 289):

```tsx
<details className="mt-6 bg-hb-card rounded-xl border border-hb-border-soft shadow-sm overflow-hidden">
  <summary className="px-4 py-2.5 text-xs text-hb-fg-muted cursor-pointer hover:text-hb-fg-secondary select-none list-none flex items-center gap-1.5">
    <span className="text-hb-fg-faint">▸</span>
    Completed recently ({recentlyCompleted.length})
  </summary>
  <ul>
    {/* unchanged list rendering */}
  </ul>
</details>
```

- [ ] **Step 4: Manual verification**

Run dev server. Verify:
- Task names are slightly larger (13px)
- Hovering a task row shows a subtle dark tint, not a tinted gray
- The completed-tasks `<details>` block has the new neutral palette
- Delete confirmation buttons use muted red, not bright red

- [ ] **Step 5: Commit**

```bash
git add web/src/components/tasks/TaskRow.tsx web/src/components/tasks/CompletedRow.tsx web/src/components/WeekDashboard.tsx
git commit -m "style(web): retoken task rows and completed-tasks block"
```

---

### Task 7.3: DayHeaderPanel (hidden events panel)

**Files:**
- Modify: `web/src/components/DayHeaderPanel.tsx`

- [ ] **Step 1: Apply token swaps**

In [web/src/components/DayHeaderPanel.tsx](../../web/src/components/DayHeaderPanel.tsx), replace tokens:

- `bg-gray-50` → `bg-[#fafafa]` (page background tone — slightly distinguishes from card)
- `border-gray-100 / border-gray-200` → `border-hb-border-soft`
- `text-gray-500 / text-gray-400 / text-gray-600 / text-gray-700` → `text-hb-fg-secondary / text-hb-fg-muted / text-hb-fg`
- `bg-white` → `bg-hb-card`
- `text-blue-600 / hover:text-blue-700` → `text-hb-fg / hover:text-black` (the "Restore" link)

- [ ] **Step 2: Manual verification**

Run dev server. Click a day header to expand it. Hide an event (via EventDetail popover), then re-open the day header — the Hidden list should appear with the new palette. The "Restore" link should read in near-black, not blue.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/DayHeaderPanel.tsx
git commit -m "style(web): retoken DayHeaderPanel"
```

---

## Phase 8 — Final visual QA pass

### Task 8.1: Cross-page sweep

- [ ] **Step 1: Walk every screen / state**

Run `cd web && npm run dev`. Methodically check:

1. **Login page** — card, button, error state if you can trigger one.
2. **Loading state** — briefly visible on first load.
3. **Header** — wordmark, avatar, sign-out button.
4. **Week nav strip** — chevrons, "This week" pill, "Event"/"Task" toggle pills.
5. **Day headers** — today highlighted, past days faded, weather icon, temp.
6. **Caitie row** — read across all 7 days. Empty days show `—`. Active days show shift/event with edge-fade. AMION shifts read as expected.
7. **Nat row** — same checks.
8. **Family banner** — if there's a multi-day non-AMION event in the visible week, ribbon spans correctly.
9. **Event popover** — open one. Check time inputs, AMION kind selector, notes box, save/reset.
10. **Add Event form** — open, type, change owner, change date/time, save.
11. **Add Task form** — open, type, change assignee, save.
12. **Task rows** — name editing inline, expand/collapse for notes, due-date chip, assignee chip, delete confirmation.
13. **Completed-tasks `<details>`** — expand, restore a task.
14. **Day header click** — expand the hidden-events panel.

Note any misses or visual hitches. Fix them in-place before continuing.

- [ ] **Step 2: Tailwind class regeneration check**

Tailwind v4 JIT can sometimes miss dynamically-built class names. If anything looks unstyled in production, run a build and look for unused `lg:col-start-N` or `lg:row-start-N`:

```bash
cd web && npm run build
```

Expected: build succeeds, no errors.

- [ ] **Step 3: Lint pass**

```bash
cd web && npm run lint
```

Fix any unused imports / variables introduced during the refactor.

- [ ] **Step 4: Run tests one final time**

```bash
cd web && npm test
```

Expected: all banner-layout tests pass.

- [ ] **Step 5: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore(web): final visual QA cleanup"
```

(Skip if there were no changes after the QA walk.)

---

## Self-review

**Spec coverage check:**

| Spec section | Implementing task |
|---|---|
| Aesthetic direction (minimal mono) | Tokens (Task 1.1) + global retokenization throughout |
| Typography (Geist, 13px body) | Task 3.2 (event/task body sizes), 7.2 (task name) |
| Owner color (edge + fade) | Task 3.2 (OwnerSection) |
| Family ribbon (spanning) | Tasks 5.2–5.4 |
| Today (tinted header + label) | Task 3.1 (Cell 1 styling) |
| Past-day fade (50%) | Task 3.1 (per-cell `opacity-50`) |
| Row-aligned grid | Task 3.1 (display:contents + 4-row grid) |
| Empty owner state | Task 3.2 (`isEmpty` block) |
| Comfortable density (13px body, 17px date) | Task 3.1 (date 17px), 3.2 (event body 13px), 7.2 (task body 13px) |
| Page background `#fafafa` | Task 1.2 |
| Card white + 1px shadow | Phase 3 cards, Phase 6 forms |
| Header restyle | Task 2.1 |
| Login restyle | Task 2.2 |
| Event detail popover restyle | Task 7.1 |
| Add event/task form restyle | Tasks 6.1, 6.2 |
| Recently completed `<details>` | Task 7.2 |
| Week nav controls | Task 4.1 |
| Day header panel | Task 7.3 |
| TaskRow / CompletedRow | Task 7.2 |
| Color palette tokens | Task 1.1 |

All spec sections have a corresponding task.

**Placeholder scan:** No "TODO", "TBD", or "implement later". The error-handling references existing patterns. The mention of "if Tailwind JIT has trouble with dynamic classes" includes the explicit fix (use a static lookup array) rather than leaving it open.

**Type/symbol consistency:**

- `BannerSpan` defined in 5.3, used in 5.4. Properties match: `id`, `title`, `startCol`, `endCol`, `lane`.
- `computeBannerSpans` signature consistent across 5.2 and 5.3.
- `bannerLaneCount` derivation is consistent in 5.4 (Step 1 and Step 2).
- `dayIndex` prop added to DayColumn in 3.1, used in 3.1 and referenced in 5.4 (when discussing row-start lookup).
- `USER_COLORS.nat.avatar` / `caitie.avatar` shape unchanged (still a single string), so existing call-sites (e.g. AssigneeButton) keep working.

**Scope:** Single coherent visual refresh of the web app. No backend, auth, or data-flow changes. Right-sized for a single execution pass.

---

## Execution Handoff

Plan complete and saved to [docs/superpowers/plans/2026-04-27-web-visual-modernization.md](docs/superpowers/plans/2026-04-27-web-visual-modernization.md). Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
