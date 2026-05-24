# Briefing ET-Time + Inline Gus Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the weekly briefing email in US Eastern time, and fold Gus drop/pickup into the week-ahead grid as color-coded tags in each owner's column (removing the separate Gus table + Reason column).

**Architecture:** Force the agent process timezone to `America/New_York` so CI (UTC) behaves like the ET dev machine the date code already assumes — a one-line workflow `env:` plus an `index.ts` guard, no `shared/` changes. In `email-template.ts`, derive small `↓ Gus drop` / `↑ Gus pick` tags per owner from the day's existing `gus` field and render them inside the owner's grid column; delete the standalone Gus table. Logic is extracted into pure, exported helpers (`gusTagsForOwner`, `renderOwnerCell`) so it can be unit-tested.

**Tech Stack:** TypeScript (ESM, `.ts` extension imports run via `tsx`), Vitest 4 (mirroring `web/`), GitHub Actions.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `agent/briefing/package.json` | Package manifest | Add `vitest` devDep + `test` script |
| `agent/briefing/vitest.config.ts` | Test config | Create (mirror `web/vitest.config.ts`) |
| `agent/briefing/src/email-template.ts` | HTML render | Add `gusTagsForOwner` + `renderOwnerCell` + owner colors; wire into grid; delete Gus table; add caption |
| `agent/briefing/src/email-template.test.ts` | Unit tests | Create |
| `agent/briefing/src/index.ts` | Orchestrator | Add `process.env.TZ` guard |
| `.github/workflows/weekly_briefing.yml` | Cron workflow | Add `TZ` to run-step `env:` |

---

## Task 1: Add Vitest to the briefing package

**Files:**
- Modify: `agent/briefing/package.json`
- Create: `agent/briefing/vitest.config.ts`

- [ ] **Step 1: Add the test script and devDependency**

In `agent/briefing/package.json`, change the `scripts` and `devDependencies` blocks to:

```json
  "scripts": {
    "dev": "tsx src/index.ts",
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^24.12.0",
    "tsx": "^4.20.0",
    "typescript": "~5.9.3",
    "vitest": "^4.1.5"
  },
```

- [ ] **Step 2: Create the Vitest config**

Create `agent/briefing/vitest.config.ts` (identical pattern to `web/vitest.config.ts`):

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
})
```

- [ ] **Step 3: Install**

Run (from repo root): `npm install`
Expected: installs `vitest` into the workspace, exits 0.

- [ ] **Step 4: Verify the runner works (no tests yet)**

Run: `npm test --workspace @home-base/briefing`
Expected: Vitest runs and passes with "no test files found" (allowed by `passWithNoTests`).

- [ ] **Step 5: Commit**

```bash
git add agent/briefing/package.json agent/briefing/vitest.config.ts package-lock.json
git commit -m "chore(briefing): add vitest test runner"
```

---

## Task 2: Pure Gus-tag logic (`gusTagsForOwner`)

Derives which Gus tags belong in a given owner's column for a day. This is the core branching that the rendering depends on.

**Files:**
- Modify: `agent/briefing/src/email-template.ts`
- Test: `agent/briefing/src/email-template.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agent/briefing/src/email-template.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { gusTagsForOwner } from './email-template.ts'
import type { GusResponsibility } from '@home-base/shared'

const gus = (dropoff: 'nat' | 'caitie', pickup: 'nat' | 'caitie'): GusResponsibility => ({
  date: '2026-05-25',
  dropoff,
  pickup,
  reason: 'unused',
})

describe('gusTagsForOwner', () => {
  it('gives the dropoff owner a drop tag and the pickup owner a pick tag', () => {
    const g = gus('nat', 'caitie')
    expect(gusTagsForOwner('nat', g)).toEqual(['drop'])
    expect(gusTagsForOwner('caitie', g)).toEqual(['pick'])
  })

  it('stacks drop then pick when one person does both', () => {
    const g = gus('nat', 'nat')
    expect(gusTagsForOwner('nat', g)).toEqual(['drop', 'pick'])
    expect(gusTagsForOwner('caitie', g)).toEqual([])
  })

  it('returns no tags when there is no Gus responsibility (e.g. weekend)', () => {
    expect(gusTagsForOwner('nat', null)).toEqual([])
    expect(gusTagsForOwner('caitie', null)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace @home-base/briefing`
Expected: FAIL — `gusTagsForOwner` is not exported by `./email-template.ts`.

- [ ] **Step 3: Implement `gusTagsForOwner`**

In `agent/briefing/src/email-template.ts`, update the imports at the top (lines 1-2) to add the `Owner` type and `GusResponsibility`:

```ts
import type { BriefingData, DayEntry, EventRow, Owner, TodoEntry } from './briefing-data.ts'
import type { GusResponsibility } from '@home-base/shared'
import type { Narrative } from './narrative.ts'
```

Then add, immediately after the imports (before `renderEmailHtml`):

```ts
export type GusTag = 'drop' | 'pick'

/** Which Gus tags belong in `owner`'s column for a day. Order: drop then pick. */
export function gusTagsForOwner(owner: Owner, gus: GusResponsibility | null): GusTag[] {
  if (!gus) return []
  const tags: GusTag[] = []
  if (gus.dropoff === owner) tags.push('drop')
  if (gus.pickup === owner) tags.push('pick')
  return tags
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace @home-base/briefing`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add agent/briefing/src/email-template.ts agent/briefing/src/email-template.test.ts
git commit -m "feat(briefing): add gusTagsForOwner helper"
```

---

## Task 3: Render Gus tags inside owner columns; remove the Gus table

Replaces the per-cell event list with a combined renderer that shows events + Gus tags, applies the "`—` only when truly empty" rule, color-codes tags to the owner, wires it into the grid, deletes the standalone table, and adds the timing caption.

**Files:**
- Modify: `agent/briefing/src/email-template.ts`
- Test: `agent/briefing/src/email-template.test.ts`

- [ ] **Step 1: Write the failing tests for `renderOwnerCell`**

Append to `agent/briefing/src/email-template.test.ts`:

```ts
import { renderOwnerCell } from './email-template.ts'
import type { EventRow } from './briefing-data.ts'

const row = (text: string): EventRow => ({ text, time: '9am – 5pm' })

describe('renderOwnerCell', () => {
  it('shows the em-dash only when there are no events and no Gus duty', () => {
    const html = renderOwnerCell([], 'nat', null)
    expect(html).toContain('—')
    expect(html).not.toContain('Gus')
  })

  it('shows the Gus tag (and no em-dash) when the cell has only a Gus duty', () => {
    const html = renderOwnerCell([], 'nat', gus('nat', 'caitie'))
    expect(html).toContain('Gus drop')
    expect(html).not.toContain('—')
  })

  it('renders events and the owner pick tag together', () => {
    const html = renderOwnerCell([row('Dentist')], 'caitie', gus('nat', 'caitie'))
    expect(html).toContain('Dentist')
    expect(html).toContain('Gus pick')
  })

  it('tints the tag with the owner accent color', () => {
    const natHtml = renderOwnerCell([], 'nat', gus('nat', 'nat'))
    expect(natHtml).toContain('#6c87a6') // Nat accent
    const caitieHtml = renderOwnerCell([], 'caitie', gus('caitie', 'caitie'))
    expect(caitieHtml).toContain('#e8c66e') // Caitie accent
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace @home-base/briefing`
Expected: FAIL — `renderOwnerCell` is not exported.

- [ ] **Step 3: Add owner colors, the tag renderer, and `renderOwnerCell`**

In `agent/briefing/src/email-template.ts`, add after the `gusTagsForOwner` function:

```ts
const OWNER_COLORS: Record<Owner, { accent: string; fade: string }> = {
  nat: { accent: '#6c87a6', fade: '#f1f5f8' },
  caitie: { accent: '#e8c66e', fade: '#fdf9ee' },
}

function renderGusTag(tag: GusTag, owner: Owner): string {
  const c = OWNER_COLORS[owner]
  const arrow = tag === 'drop' ? '↓' : '↑'
  const label = tag === 'drop' ? 'Gus drop' : 'Gus pick'
  return `
    <div style="margin-top: 4px;">
      <span style="display: inline-block; font-size: 11px; line-height: 1.4; padding: 1px 8px; border-radius: 10px; background: ${c.fade}; border: 1px solid ${c.accent}; color: #1a1a1a;">${arrow} ${label}</span>
    </div>`
}

function renderEventItems(events: EventRow[]): string {
  return events.map(e => `
    <div style="margin-bottom: 4px;">
      <span style="color: #666; font-size: 12px;">${escapeHtml(e.time)}</span>
      <span style="margin-left: 6px;">${escapeHtml(e.text)}</span>
    </div>`).join('')
}

/** A single owner's grid cell: their events plus their Gus tags for the day. */
export function renderOwnerCell(events: EventRow[], owner: Owner, gus: GusResponsibility | null): string {
  const tags = gusTagsForOwner(owner, gus)
  if (events.length === 0 && tags.length === 0) {
    return '<span style="color: #ccc;">—</span>'
  }
  return renderEventItems(events) + tags.map(t => renderGusTag(t, owner)).join('')
}
```

- [ ] **Step 4: Delete the old `renderEventList` and `renderGusTable`**

Remove the `renderEventList` function (current lines 74-81) and the `renderGusTable` function (current lines 83-106) entirely — `renderEventItems` + `renderOwnerCell` replace the former, and the Gus table is being removed.

- [ ] **Step 5: Wire `renderOwnerCell` into the day row**

Replace `renderDayRow` (current lines 64-72) with:

```ts
function renderDayRow(day: DayEntry): string {
  const dayBg = day.isWeekend ? '#fafafa' : 'transparent'
  return `
    <tr style="background: ${dayBg};">
      <td style="padding: 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; color: #333; font-weight: 600;">${escapeHtml(day.label)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top;">${renderOwnerCell(day.natEvents, 'nat', day.gus)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top;">${renderOwnerCell(day.caitieEvents, 'caitie', day.gus)}</td>
    </tr>`
}
```

- [ ] **Step 6: Remove the Gus section heading and add the caption**

In `renderEmailHtml`, delete these two lines (current lines 25-26):

```ts
  <h2 style="font-size: 16px; margin: 28px 0 12px 0; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px;">Gus pickup &amp; dropoff</h2>
  ${renderGusTable(data)}
```

Then change the week-grid block (current lines 22-23) from:

```ts
  <h2 style="font-size: 16px; margin: 28px 0 12px 0; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px;">The week ahead</h2>
  ${renderWeekGrid(data.days)}
```

to (adds the caption directly under the grid):

```ts
  <h2 style="font-size: 16px; margin: 28px 0 12px 0; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px;">The week ahead</h2>
  ${renderWeekGrid(data.days)}
  <div style="color: #999; font-size: 12px; margin-top: 8px;">Gus: ↓ drop 7am · ↑ pick 5pm</div>
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test --workspace @home-base/briefing`
Expected: PASS (all `gusTagsForOwner` + `renderOwnerCell` tests).

- [ ] **Step 8: Typecheck (catches the now-unused `data` param / dead imports)**

Run: `npm run typecheck --workspace @home-base/briefing`
Expected: exits 0. If it flags `renderWeekGrid`'s use of `data` or an unused import, resolve by ensuring `renderWeekGrid(data.days)` is still called and `BriefingData` remains imported (it's used by `renderEmailHtml`'s signature). `data` is still referenced via `data.days`/`data.week`/`data.todos`, so no signature change is needed.

- [ ] **Step 9: Commit**

```bash
git add agent/briefing/src/email-template.ts agent/briefing/src/email-template.test.ts
git commit -m "feat(briefing): inline Gus tags in week grid, drop standalone table"
```

---

## Task 4: Force Eastern Time for the agent

No unit test: this is process/CI configuration. `process.env.TZ` is read by Node and by `Intl.DateTimeFormat().resolvedOptions().timeZone` in `shared/.../io.ts`, which sets the Google Calendar request timezone — neither is meaningfully unit-testable without mocking Google. Verified by typecheck + dry-run (Task 5).

**Files:**
- Modify: `agent/briefing/src/index.ts`
- Modify: `.github/workflows/weekly_briefing.yml`

- [ ] **Step 1: Add the TZ guard in the entrypoint**

In `agent/briefing/src/index.ts`, immediately after the import block (after line 26, before `async function main`), add:

```ts
// All of the agent's date logic assumes wall-clock = US Eastern (it was written
// and tested on an ET machine). CI runs under UTC, which would otherwise render
// regular event times in the wrong zone. Set it before any Date is constructed.
// The workflow also sets TZ in its env; this ??= covers local runs where it's unset.
process.env.TZ ??= 'America/New_York'
```

- [ ] **Step 2: Add TZ to the workflow run step**

In `.github/workflows/weekly_briefing.yml`, add `TZ` to the `env:` block of the "Run weekly briefing" step (currently lines 39-46), so it reads:

```yaml
        env:
          TZ: America/New_York
          GOOGLE_OAUTH_TOKEN: ${{ secrets.GOOGLE_OAUTH_TOKEN }}
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          ASANA_PAT: ${{ secrets.ASANA_PAT }}
          ASANA_WORKSPACE_GID: ${{ secrets.ASANA_WORKSPACE_GID }}
          ALLOWED_EMAILS: ${{ secrets.ALLOWED_EMAILS }}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @home-base/briefing`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add agent/briefing/src/index.ts .github/workflows/weekly_briefing.yml
git commit -m "fix(briefing): run agent in America/New_York so email times are ET"
```

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full briefing test suite**

Run: `npm test --workspace @home-base/briefing`
Expected: all tests PASS.

- [ ] **Step 2: Typecheck the package**

Run: `npm run typecheck --workspace @home-base/briefing`
Expected: exits 0.

- [ ] **Step 3: Dry-run render and eyeball the HTML (requires local secrets)**

From `agent/briefing`, with the secrets exported per `CLAUDE.md`'s dry-run instructions:

```bash
BRIEFING_DRY_RUN=true BRIEFING_DRY_RUN_OUT=/tmp/briefing.html npm start
open /tmp/briefing.html
```

Confirm:
- Regular (non-AMION) event times read in ET (e.g. a 6pm event shows "6pm", not "10/11pm").
- There is **no** separate "Gus pickup & dropoff" table.
- `↓ Gus drop` / `↑ Gus pick` tags appear in the correct owner columns, tinted (Nat slate-blue `#6c87a6`, Caitie gold `#e8c66e`).
- The caption `Gus: ↓ drop 7am · ↑ pick 5pm` sits under the week grid.
- A weekday cell with a Gus duty but no events shows the tag (not `—`); a cell with neither shows `—`; weekends show no Gus tags.

- [ ] **Step 4 (optional): Reproduce the timezone bug to confirm the fix**

`TZ=UTC npm start` (with dry-run env) reproduces the old behavior — the `??=` guard does not override an explicitly-set `TZ`, so regular event times appear shifted. `TZ=America/New_York npm start` (or unset `TZ`, letting the guard supply it) renders correct ET times.
