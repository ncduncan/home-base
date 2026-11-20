import { describe, it, expect, vi } from 'vitest'
import { loadWorkloadHistory, type WorkloadHistoryDeps } from './workload-history'
import { DEFAULT_WORKLOAD_SETTINGS } from './workload'
import type { CalendarEvent, CalendarOverride } from './types'

// Invented fixtures only. 2026-07-08 is a Wednesday; its week starts 2026-07-05.
const TODAY = '2026-07-08'

function shift(id: string, start: string, end: string): CalendarEvent {
  return { id, title: 'Shift', start, end, location: null, all_day: false, calendar_name: 'Shifts', is_amion: true, amion_kind: 'day' }
}

function deps(over: Partial<WorkloadHistoryDeps> = {}): WorkloadHistoryDeps {
  return {
    fetchCalendarRange: vi.fn(async () => ({ events: [] as CalendarEvent[], failedSources: 0 })),
    fetchOverrides: vi.fn(async () => [] as CalendarOverride[]),
    fetchGusOverrides: vi.fn(async () => []),
    fetchCompletedTasks: vi.fn(async () => []),
    fetchUsers: vi.fn(async () => []),
    fetchMe: vi.fn(async () => null),
    fetchSettings: vi.fn(async () => DEFAULT_WORKLOAD_SETTINGS),
    owners: { nat: { email: '', workEmail: '' }, caitie: { email: '', workEmail: '' } },
    ...over,
  }
}

describe('loadWorkloadHistory', () => {
  it('covers 12 full weeks plus this week to date', async () => {
    const d = deps()
    const h = await loadWorkloadHistory(d, TODAY)
    expect(h.result.weeks).toHaveLength(13)
    expect(h.start).toBe('2026-04-12')
    expect(h.asOf).toBe(TODAY)
    expect(h.result.weeks[12].days).toBe(4)
    // One day early for Gus care's overnight check; end is exclusive.
    expect(d.fetchCalendarRange).toHaveBeenCalledWith('2026-04-11', '2026-07-09')
  })

  it('reports failed calendar sources instead of hiding them', async () => {
    const h = await loadWorkloadHistory(deps({
      fetchCalendarRange: async () => ({ events: [], failedSources: 2 }),
    }), TODAY)
    expect(h.failedSources).toBe(2)
  })

  it('applies calendar overrides before counting shifts', async () => {
    const hidden: CalendarOverride = {
      id: 'o', event_key: 's2', event_date: '2026-07-07', hidden: true, title_override: null,
      start_override: null, end_override: null, amion_kind_override: null, notes: null, created_by: 'x',
    }
    const h = await loadWorkloadHistory(deps({
      fetchCalendarRange: async () => ({
        events: [shift('s1', '2026-07-06T08:00:00', '2026-07-06T18:00:00'), shift('s2', '2026-07-07T08:00:00', '2026-07-07T18:00:00')],
        failedSources: 0,
      }),
      fetchOverrides: async () => [hidden],
    }), TODAY)
    expect(h.result.weeks[12].byOwner.caitie.work).toBe(10)
    expect(h.result.earliestShiftDate).toBe('2026-07-06')
  })

  it('maps the PAT owner to nat for chores', async () => {
    const h = await loadWorkloadHistory(deps({
      fetchMe: async () => ({ gid: 'me', name: 'Me', email: '' }),
      fetchCompletedTasks: async () => [{
        gid: 't', name: 'Task', due_on: null, completed: true, completed_at: '2026-07-06T12:00:00.000Z',
        assignee: { gid: 'me', name: 'Me' }, notes: null, projects: [],
      }],
    }), TODAY)
    expect(h.result.weeks[12].byOwner.nat.home.chores).toBeCloseTo(0.5)
  })
})
