import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  computeWorkload,
  workloadWeekStarts,
  assigneeOwnersFromUsers,
  withDefaultSettings,
  DEFAULT_WORKLOAD_SETTINGS,
  type WorkloadInput,
  type WorkloadSettings,
} from './workload'
import { computeGusCare } from './gus-care'
import { processAmionEvents } from './calendar/process'
import type { AsanaTask, CalendarEvent, GusOverride, GusResponsibility } from './types'

// Invented fixtures only (public repo). 2026-07-05 is a Sunday.
const SUN = '2026-07-05'
const WEEK = [SUN]

function shift(id: string, kind: NonNullable<CalendarEvent['amion_kind']>, start: string, end: string): CalendarEvent {
  return { id, title: 'Shift', start, end, location: null, all_day: false, calendar_name: 'Shifts', is_amion: true, amion_kind: kind }
}

function task(gid: string, name: string, completedAt: string, assigneeGid: string | null): AsanaTask {
  return {
    gid, name, due_on: null, completed: true, completed_at: completedAt,
    assignee: assigneeGid ? { gid: assigneeGid, name: 'x' } : null, notes: null, projects: [],
  }
}

const OWNERS_BY_GID = { 'u-a': 'nat', 'u-b': 'caitie' } as const

// Meals zeroed so a test can look at one bucket at a time.
const NO_MEALS: WorkloadSettings = { ...DEFAULT_WORKLOAD_SETTINGS, dinnersPerWeek: 0, mealPlanningMinutesPerWeek: 0 }

function run(over: Partial<WorkloadInput> = {}) {
  return computeWorkload({
    events: [], gusCare: [], completedTasks: [], assigneeOwners: { ...OWNERS_BY_GID },
    settings: NO_MEALS, weekStarts: WEEK, ...over,
  })
}

describe('computeWorkload — work hours', () => {
  it('credits a weekday night shift 16 h and a weekend 24hr shift 24 h; Nat gets the weekday block', () => {
    const r = run({
      events: [
        shift('n1', 'night', '2026-07-06T16:00:00', '2026-07-07T08:00:00'),
        shift('w1', '24hr', '2026-07-11T08:00:00', '2026-07-12T08:00:00'),
      ],
    })
    expect(r.weeks[0].byOwner.caitie.work).toBe(40)
    expect(r.weeks[0].byOwner.nat.work).toBe(45) // 5 weekdays × 8am–5pm
  })

  it('counts backup 0 h and research 8 h; vacation emits no shift, so 0', () => {
    const r = run({
      events: [
        shift('b1', 'backup', '2026-07-06T00:00:00', '2026-07-07T00:00:00'),
        shift('r1', 'research', '2026-07-07T00:00:00', '2026-07-08T00:00:00'),
      ],
    })
    expect(r.weeks[0].byOwner.caitie.work).toBe(8)
  })

  it('counts a Vacation or Leave day as 0 h: the AMION processor emits no shift for it', () => {
    const raw = (summary: string, date: string, end: string) =>
      ({ summary, status: 'confirmed', start: { date }, end: { date: end } })
    const events = processAmionEvents([
      raw('Vacation', '2026-07-06', '2026-07-07'),
      raw('Leave', '2026-07-07', '2026-07-08'),
      raw('CICU', '2026-07-08', '2026-07-09'), // a regular weekday rotation day
    ])
    const r = run({ events })
    expect(r.weeks[0].byOwner.caitie.work).toBe(10) // only the rotation day
  })

  it('credits a shift crossing midnight to the day it starts', () => {
    const r = run({
      weekStarts: [SUN, '2026-07-12'],
      events: [shift('n1', 'night', '2026-07-11T16:00:00', '2026-07-12T08:00:00')],
    })
    expect(r.weeks[0].byOwner.caitie.work).toBe(16)
    expect(r.weeks[1].byOwner.caitie.work).toBe(0)
  })

  it('reports the earliest date with shift data', () => {
    const r = run({
      events: [
        shift('a', 'day', '2026-07-09T08:00:00', '2026-07-09T18:00:00'),
        shift('b', 'day', '2026-07-07T08:00:00', '2026-07-07T18:00:00'),
      ],
    })
    expect(r.earliestShiftDate).toBe('2026-07-07')
    expect(run().earliestShiftDate).toBeNull()
  })
})

describe('computeWorkload — chores', () => {
  const settings: WorkloadSettings = { ...NO_MEALS, taskKeywordMinutes: [{ keyword: 'LAUNDRY', minutes: 60 }] }

  it('uses the keyword override, the default, and a 50/50 split for unassigned tasks', () => {
    const r = run({
      settings,
      completedTasks: [
        task('1', 'Fold laundry', '2026-07-06T12:00:00.000Z', 'u-a'),   // override 60
        task('2', 'Water plants', '2026-07-07T12:00:00.000Z', 'u-b'),   // default 30
        task('3', 'Take out bins', '2026-07-08T12:00:00.000Z', null),   // 30, split
      ],
    })
    expect(r.weeks[0].byOwner.nat.home.chores).toBeCloseTo(1 + 0.25)
    expect(r.weeks[0].byOwner.caitie.home.chores).toBeCloseTo(0.5 + 0.25)
  })

  it('credits the week of completed_at and ignores tasks outside the window', () => {
    const r = run({
      weekStarts: [SUN, '2026-07-12'],
      completedTasks: [
        task('1', 'A', '2026-07-13T12:00:00.000Z', 'u-a'),
        task('2', 'B', '2026-06-30T12:00:00.000Z', 'u-a'),
      ],
    })
    expect(r.weeks[0].byOwner.nat.home.chores).toBe(0)
    expect(r.weeks[1].byOwner.nat.home.chores).toBeCloseTo(0.5)
  })

  it("excludes a task assigned to someone who isn't an owner", () => {
    const r = run({ completedTasks: [task('1', 'A', '2026-07-06T12:00:00.000Z', 'u-other')] })
    expect(r.totals.nat.home.chores).toBe(0)
    expect(r.totals.caitie.home.chores).toBe(0)
  })
})

describe('computeWorkload — childcare', () => {
  it('credits the override owner when a Gus override flips a pickup', () => {
    const overrides: GusOverride[] = [{ id: '1', date: '2026-07-06', role: 'pickup', owner: 'nat', created_by: 'x' }]
    const gusCare = computeGusCare([], ['2026-07-06'], overrides)
    const r = run({ gusCare })
    // Default with no events: Caitie has both slots; the override hands Nat the pickup.
    expect(r.weeks[0].byOwner.nat.home.childcare).toBeCloseTo(0.5)
    expect(r.weeks[0].byOwner.caitie.home.childcare).toBeCloseTo(0.5)
  })

  it('uses the per-slot minutes from settings', () => {
    const gusCare: GusResponsibility[] = [{ date: '2026-07-06', pickup: 'nat', dropoff: 'nat', reason: '' }]
    const r = run({ gusCare, settings: { ...NO_MEALS, pickupMinutes: 15, dropoffMinutes: 45 } })
    expect(r.weeks[0].byOwner.nat.home.childcare).toBeCloseTo(1)
  })
})

describe('computeWorkload — meals', () => {
  it('splits cooking and planning by the configured shares, spread over the week', () => {
    const r = run({ settings: { ...DEFAULT_WORKLOAD_SETTINGS, cookSplitNatPct: 100, mealPlanningSplitNatPct: 0 } })
    expect(r.weeks[0].byOwner.nat.home.meals).toBeCloseTo((7 * 45) / 60)
    expect(r.weeks[0].byOwner.caitie.home.meals).toBeCloseTo(1)
  })

  it('counts only the days to date in the current week', () => {
    const r = run({ settings: DEFAULT_WORKLOAD_SETTINGS, asOf: '2026-07-07' })
    expect(r.weeks[0].days).toBe(3)
    expect(r.weeks[0].partial).toBe(true)
    expect(r.weeks[0].byOwner.nat.home.meals).toBeCloseTo((((7 * 45) / 60) * 0.5 + 0.5) * 3 / 7)
    expect(r.weeks[0].byOwner.nat.work).toBe(18) // Mon + Tue
  })
})

describe('computeWorkload — remaining', () => {
  it('is never negative, even on a 24 h shift day', () => {
    const r = run({
      settings: DEFAULT_WORKLOAD_SETTINGS,
      events: [shift('w1', '24hr', '2026-07-11T08:00:00', '2026-07-12T08:00:00')],
    })
    const c = r.weeks[0].byOwner.caitie
    const mealsPerDay = c.home.meals / 7
    // Six ordinary days of 16 waking hours less meals; the shift day adds 0.
    expect(c.remaining).toBeCloseTo(6 * (16 - mealsPerDay))
    expect(c.remaining).toBeGreaterThanOrEqual(0)
  })

  it('floors each day at zero rather than borrowing from other days', () => {
    const r = run({ settings: { ...NO_MEALS, sleepHoursPerDay: 23 } })
    expect(r.weeks[0].byOwner.nat.remaining).toBe(2) // weekend days only: 1 h each
  })
})

describe('computeWorkload — empty inputs', () => {
  it('returns 13 weeks without throwing: the weekday block, no shifts, no chores or childcare', () => {
    const weekStarts = workloadWeekStarts('2026-07-08')
    expect(weekStarts).toHaveLength(13)
    const r = computeWorkload({
      events: [], gusCare: [], completedTasks: [], assigneeOwners: {}, settings: NO_MEALS, weekStarts,
    })
    expect(r.weeks).toHaveLength(13)
    for (const w of r.weeks) {
      expect(w.byOwner.nat.work).toBe(45)
      expect(w.byOwner.caitie.work).toBe(0)
      for (const o of ['nat', 'caitie'] as const) expect(w.byOwner[o].home.total).toBe(0)
      expect(w.byOwner.caitie.remaining).toBe(7 * 16)
      expect(w.byOwner.nat.remaining).toBe(7 * 16 - 45)
    }
  })

  it('with default settings, meals are the only home hours and come out of remaining', () => {
    const r = computeWorkload({
      events: [], gusCare: [], completedTasks: [], assigneeOwners: {}, settings: DEFAULT_WORKLOAD_SETTINGS,
      weekStarts: [SUN],
    })
    const c = r.weeks[0].byOwner.caitie
    const meals = ((7 * 45) / 60 + 1) / 2 // half the cooking and half the planning
    expect(c.home.meals).toBeCloseTo(meals)
    expect(c.home.total).toBeCloseTo(meals)
    expect(c.remaining).toBeCloseTo(7 * 16 - meals)
  })
})

describe('computeWorkload — settings drive the output', () => {
  it('changes when a settings value changes', () => {
    const events = [shift('d1', 'day', '2026-07-06T08:00:00', '2026-07-06T18:00:00')]
    const a = run({ events })
    const b = run({ events, settings: { ...NO_MEALS, shiftHours: { ...NO_MEALS.shiftHours, day: 12 } } })
    expect(a.weeks[0].byOwner.caitie.work).toBe(10)
    expect(b.weeks[0].byOwner.caitie.work).toBe(12)
    const c = run({ settings: { ...NO_MEALS, sleepHoursPerDay: 7 } })
    expect(c.weeks[0].byOwner.caitie.remaining).toBe(7 * 17)
  })

  it('fills fields a stored row is missing from the defaults and drops junk', () => {
    const s = withDefaultSettings({ sleepHoursPerDay: 7, shiftHours: { day: 9 }, taskKeywordMinutes: [{ keyword: 'x', minutes: 5 }, 'bad'], extra: 1 })
    expect(s.sleepHoursPerDay).toBe(7)
    expect(s.shiftHours.day).toBe(9)
    expect(s.shiftHours.night).toBe(16)
    expect(s.taskKeywordMinutes).toEqual([{ keyword: 'x', minutes: 5 }])
    expect(withDefaultSettings(null)).toEqual(DEFAULT_WORKLOAD_SETTINGS)
  })

  it('seeds the settings row with exactly the code defaults', () => {
    const dir = join(import.meta.dirname, '../../supabase/migrations')
    const file = readdirSync(dir).find(f => f.endsWith('_workload_settings.sql'))!
    const sql = readFileSync(join(dir, file), 'utf8')
    const json = sql.slice(sql.indexOf("values (1, '") + "values (1, '".length, sql.indexOf("'::jsonb);"))
    expect(JSON.parse(json)).toEqual(DEFAULT_WORKLOAD_SETTINGS)
  })
})

describe('workloadWeekStarts / assigneeOwnersFromUsers', () => {
  it('ends with the Sunday of the current week, 12 full weeks before it', () => {
    const w = workloadWeekStarts('2026-07-08')
    expect(w[12]).toBe('2026-07-05')
    expect(w[0]).toBe('2026-04-12')
    expect(workloadWeekStarts('2026-07-05')[12]).toBe('2026-07-05')
  })

  it('maps users by personal or work email and counts the PAT owner as nat', () => {
    const owners = { nat: { email: 'a@example.com', workEmail: 'a@work.example' }, caitie: { email: 'b@example.com', workEmail: '' } }
    const users = [
      { gid: '1', name: 'A', email: 'A@WORK.example' },
      { gid: '2', name: 'B', email: 'b@example.com' },
      { gid: '3', name: 'C', email: 'c@example.com' },
      { gid: '4', name: 'Me', email: '' },
    ]
    expect(assigneeOwnersFromUsers(users, owners, '4')).toEqual({ 1: 'nat', 2: 'caitie', 4: 'nat' })
  })
})
