import { describe, it, expect, vi } from 'vitest'
import { createDashboardMutations, type DashboardApi } from './dashboard-mutations'
import { createTaskMutations, type TaskApi } from './task-mutations'
import { emptyList, receiveServerRows, viewOf, hasPendingWrites, isPendingId, type OptimisticList } from './optimistic'
import type { AsanaTask, AsanaUser, CalendarOverride, GusOverride } from '@home-base/shared/types'
import type { HomebaseEvent } from '@home-base/shared/homebase-events'

// A tiny stand-in for useState: holds a value and applies updaters.
function store<T>(initial: T) {
  let value = initial
  return {
    get: () => value,
    update: (fn: (v: T) => T) => { value = fn(value) },
    set: (next: T | ((v: T) => T)) => {
      value = typeof next === 'function' ? (next as (v: T) => T)(value) : next
    },
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function listOf<T>(rows: T[]): OptimisticList<T> {
  return receiveServerRows(emptyList<T>(), rows, 0)
}

const override = (o: Partial<CalendarOverride> = {}): CalendarOverride => ({
  id: 'ov1',
  event_key: 'evt1',
  event_date: '2026-11-16',
  hidden: false,
  title_override: null,
  start_override: null,
  end_override: null,
  amion_kind_override: null,
  notes: null,
  created_by: 'a@example.com',
  ...o,
})

const gus = (o: Partial<GusOverride> = {}): GusOverride => ({
  id: 'g1', date: '2026-11-16', role: 'pickup', owner: 'nat', created_by: 'a@example.com', ...o,
})

const hbFields: Omit<HomebaseEvent, 'id'> = {
  title: 'Event', start_time: '2026-11-16T09:00:00', end_time: '2026-11-16T10:00:00', all_day: false,
  location: null, notes: null, owner: 'nat', created_by: 'a@example.com',
}

function setup(api: Partial<DashboardApi>, init: {
  overrides?: CalendarOverride[]; gus?: GusOverride[]; hb?: HomebaseEvent[]
} = {}) {
  const overrides = store(listOf(init.overrides ?? []))
  const gusOverrides = store(listOf(init.gus ?? []))
  const homebaseEvents = store(listOf(init.hb ?? []))
  const notify = vi.fn()
  const m = createDashboardMutations({
    overrides, gusOverrides, homebaseEvents,
    api: api as DashboardApi,
    notify,
    userEmail: 'a@example.com',
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  return { m, overrides, gusOverrides, homebaseEvents, notify }
}

describe('dashboard mutations: pickup/dropoff owner', () => {
  it('shows the new owner before the write returns, then keeps it once saved', async () => {
    const d = deferred<GusOverride>()
    const t = setup({ upsertGusOverride: () => d.promise })
    const done = t.m.setGusOwner('2026-11-16', 'pickup', 'caitie')
    expect(viewOf(t.gusOverrides.get())).toMatchObject([{ date: '2026-11-16', role: 'pickup', owner: 'caitie' }])
    expect(hasPendingWrites(t.gusOverrides.get())).toBe(true)
    d.resolve(gus({ id: 'real', owner: 'caitie' }))
    await done
    expect(viewOf(t.gusOverrides.get())).toEqual([gus({ id: 'real', owner: 'caitie' })])
    expect(hasPendingWrites(t.gusOverrides.get())).toBe(false)
    expect(t.notify).not.toHaveBeenCalled()
  })

  it('rolls back and toasts when setting an owner fails', async () => {
    const t = setup({ upsertGusOverride: () => Promise.reject(new Error('offline')) }, { gus: [gus()] })
    await t.m.setGusOwner('2026-11-16', 'pickup', 'caitie')
    expect(viewOf(t.gusOverrides.get())).toEqual([gus()])
    expect(hasPendingWrites(t.gusOverrides.get())).toBe(false)
    expect(t.notify).toHaveBeenCalledWith("Couldn't change the pickup owner")
  })

  it('rolls back and toasts when clearing an owner fails', async () => {
    const t = setup({ deleteGusOverride: () => Promise.reject(new Error('offline')) }, { gus: [gus({ role: 'dropoff' })] })
    const done = t.m.clearGusOwner('2026-11-16', 'dropoff')
    expect(viewOf(t.gusOverrides.get())).toEqual([])
    await done
    expect(viewOf(t.gusOverrides.get())).toEqual([gus({ role: 'dropoff' })])
    expect(t.notify).toHaveBeenCalledWith("Couldn't reset the dropoff owner")
  })

  it('reports pending until the write settles, so the invite sync can wait for it', async () => {
    const d = deferred<GusOverride>()
    const t = setup({ upsertGusOverride: () => d.promise })
    const done = t.m.setGusOwner('2026-11-16', 'pickup', 'caitie')
    expect(hasPendingWrites(t.gusOverrides.get())).toBe(true)
    d.reject(new Error('offline'))
    await done
    expect(hasPendingWrites(t.gusOverrides.get())).toBe(false)
    expect(viewOf(t.gusOverrides.get())).toEqual([])
  })
})

describe('dashboard mutations: calendar overrides', () => {
  it('shows a saved override immediately and keeps the existing id while pending', () => {
    const t = setup({ upsertOverride: () => new Promise(() => {}) }, { overrides: [override()] })
    void t.m.saveOverride({ ...override(), notes: 'x', id: undefined } as unknown as Omit<CalendarOverride, 'id'>)
    expect(viewOf(t.overrides.get())).toEqual([override({ notes: 'x' })])
  })

  it('gives a brand-new override a pending id until the server answers', async () => {
    const d = deferred<CalendarOverride>()
    const t = setup({ upsertOverride: () => d.promise })
    const { id: _id, ...fields } = override({ hidden: true })
    void _id
    const done = t.m.saveOverride(fields)
    expect(isPendingId(viewOf(t.overrides.get())[0].id)).toBe(true)
    d.resolve(override({ id: 'srv', hidden: true }))
    await done
    expect(viewOf(t.overrides.get())).toEqual([override({ id: 'srv', hidden: true })])
  })

  it('rolls back and toasts when saving fails', async () => {
    const t = setup({ upsertOverride: () => Promise.reject(new Error('x')) }, { overrides: [override()] })
    const { id: _id, ...fields } = override({ notes: 'changed' })
    void _id
    await t.m.saveOverride(fields)
    expect(viewOf(t.overrides.get())).toEqual([override()])
    expect(t.notify).toHaveBeenCalledWith("Couldn't save the event change")
  })

  it('rolls back and toasts when deleting fails', async () => {
    const t = setup({ deleteOverride: () => Promise.reject(new Error('x')) }, { overrides: [override()] })
    const done = t.m.deleteOverride('ov1')
    expect(viewOf(t.overrides.get())).toEqual([])
    await done
    expect(viewOf(t.overrides.get())).toEqual([override()])
    expect(t.notify).toHaveBeenCalledWith("Couldn't reset the event")
  })

  it('ignores a delete of an override that has no server id yet', async () => {
    const del = vi.fn()
    const t = setup({ deleteOverride: del, upsertOverride: () => new Promise(() => {}) })
    const { id: _id, ...fields } = override()
    void _id
    void t.m.saveOverride(fields)
    const tmp = viewOf(t.overrides.get())[0].id
    await t.m.deleteOverride(tmp)
    expect(del).not.toHaveBeenCalled()
    expect(viewOf(t.overrides.get())).toHaveLength(1)
  })
})

describe('dashboard mutations: home-base events', () => {
  it('adds the event immediately with a pending id, then swaps in the server id', async () => {
    const d = deferred<HomebaseEvent>()
    const t = setup({ createHomebaseEvent: () => d.promise })
    const done = t.m.createHomebaseEvent(hbFields)
    const [pending] = viewOf(t.homebaseEvents.get())
    expect(isPendingId(pending.id)).toBe(true)
    d.resolve({ ...hbFields, id: 'srv' })
    await done
    expect(viewOf(t.homebaseEvents.get())).toEqual([{ ...hbFields, id: 'srv' }])
  })

  it('removes the event and toasts when creating fails', async () => {
    const t = setup({ createHomebaseEvent: () => Promise.reject(new Error('x')) })
    await t.m.createHomebaseEvent(hbFields)
    expect(viewOf(t.homebaseEvents.get())).toEqual([])
    expect(t.notify).toHaveBeenCalledWith("Couldn't add the event")
  })

  it('restores the event and toasts when deleting fails', async () => {
    const t = setup({ deleteHomebaseEvent: () => Promise.reject(new Error('x')) }, { hb: [{ ...hbFields, id: 'e1' }] })
    const done = t.m.deleteHomebaseEvent('e1')
    expect(viewOf(t.homebaseEvents.get())).toEqual([])
    await done
    expect(viewOf(t.homebaseEvents.get())).toEqual([{ ...hbFields, id: 'e1' }])
    expect(t.notify).toHaveBeenCalledWith("Couldn't delete the event")
  })

  it('ignores a delete of an event that has no server id yet', async () => {
    const del = vi.fn()
    const t = setup({ deleteHomebaseEvent: del, createHomebaseEvent: () => new Promise(() => {}) })
    void t.m.createHomebaseEvent(hbFields)
    await t.m.deleteHomebaseEvent(viewOf(t.homebaseEvents.get())[0].id)
    expect(del).not.toHaveBeenCalled()
  })
})

// ── Tasks ───────────────────────────────────────────────────────────────────

const users: AsanaUser[] = [{ gid: 'u1', name: 'Alex Smith', email: 'a@example.com' }]
const task = (o: Partial<AsanaTask> = {}): AsanaTask => ({
  gid: 't1', name: 'Task', due_on: '2026-11-16', completed: false, completed_at: null,
  assignee: null, notes: null, projects: [], ...o,
})

function setupTasks(api: Partial<TaskApi>, initial: AsanaTask[] = []) {
  const tasks = store(initial)
  const notify = vi.fn()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const m = createTaskMutations({ setTasks: tasks.set, users, api: api as TaskApi, notify })
  return { m, tasks, notify }
}

describe('task mutations', () => {
  it('applies an edit immediately, including the assignee name', () => {
    const t = setupTasks({ updateTask: () => new Promise(() => {}) }, [task()])
    void t.m.editTask('t1', { name: 'Renamed', assignee_gid: 'u1' })
    expect(t.tasks.get()).toEqual([task({ name: 'Renamed', assignee: { gid: 'u1', name: 'Alex Smith' } })])
  })

  it('rolls back only the edited fields and toasts when an edit fails', async () => {
    const d = deferred<AsanaTask>()
    const t = setupTasks({ updateTask: () => d.promise }, [task()])
    const done = t.m.editTask('t1', { due_on: '2026-12-01' })
    // An unrelated change lands while the edit is in flight.
    t.tasks.set(prev => prev.map(x => ({ ...x, completed: true })))
    d.reject(new Error('offline'))
    await done
    expect(t.tasks.get()).toEqual([task({ completed: true })])
    expect(t.notify).toHaveBeenCalledWith("Couldn't update the task")
  })

  it('adds a task immediately with a pending gid, then swaps in the created task', async () => {
    const d = deferred<AsanaTask>()
    const t = setupTasks({ createTask: () => d.promise }, [task()])
    const done = t.m.createTask({ name: 'New', due_on: '2026-11-17', assignee: 'u1' })
    const [first] = t.tasks.get()
    expect(isPendingId(first.gid)).toBe(true)
    expect(first).toMatchObject({ name: 'New', due_on: '2026-11-17', assignee: { gid: 'u1', name: 'Alex Smith' } })
    d.resolve(task({ gid: 'srv', name: 'New' }))
    await done
    expect(t.tasks.get().map(x => x.gid)).toEqual(['srv', 't1'])
  })

  it('removes the pending task and toasts when creating fails', async () => {
    const t = setupTasks({ createTask: () => Promise.reject(new Error('x')) }, [task()])
    await t.m.createTask({ name: 'New' })
    expect(t.tasks.get()).toEqual([task()])
    expect(t.notify).toHaveBeenCalledWith("Couldn't add the task")
  })

  it('ignores edits to a task that has no server gid yet', async () => {
    const upd = vi.fn()
    const t = setupTasks({ updateTask: upd, createTask: () => new Promise(() => {}) })
    void t.m.createTask({ name: 'New' })
    const gid = t.tasks.get()[0].gid
    await t.m.editTask(gid, { name: 'x' })
    expect(upd).not.toHaveBeenCalled()
    expect(t.tasks.get()[0].name).toBe('New')
  })
})
