// Optimistic dashboard writes: overrides, pickup/dropoff owners, home-base
// events. Each handler changes the screen immediately, writes in the
// background, and on failure drops its overlay (the rollback) and shows a
// toast. Handlers return a promise that settles with the write and never
// rejects, so callers can close their form without awaiting it.
//
// IO is injected, so this module stays free of the Supabase singleton and can
// be unit-tested in node.

import type { CalendarOverride, GusOverride } from '@home-base/shared/types'
import type { HomebaseEvent } from '@home-base/shared/homebase-events'
import {
  beginWrite, confirmWrite, failWrite, nextWriteTick, serialQueue, upsertBy, removeBy, pendingId, isPendingId,
  type OptimisticList, type Transform,
} from './optimistic'

export interface ListHandle<T> {
  update: (fn: (s: OptimisticList<T>) => OptimisticList<T>) => void
}

export interface DashboardApi {
  upsertOverride: (o: Omit<CalendarOverride, 'id'>) => Promise<CalendarOverride>
  deleteOverride: (id: string) => Promise<void>
  upsertGusOverride: (o: Omit<GusOverride, 'id' | 'updated_at'>) => Promise<GusOverride>
  deleteGusOverride: (date: string, role: 'pickup' | 'dropoff') => Promise<void>
  createHomebaseEvent: (fields: Omit<HomebaseEvent, 'id'>) => Promise<HomebaseEvent>
  deleteHomebaseEvent: (id: string) => Promise<void>
}

let writeSeq = 0

/**
 * Apply `pending` now, run `write`, then either swap in the server's answer or
 * roll back and call `onFail`. Toast text names the action only — never the
 * event or task content (public-repo logging policy applies to the UI too).
 */
export function runOptimisticWrite<T, R>(
  list: ListHandle<T>,
  pending: Transform<T>,
  write: () => Promise<R>,
  confirmed: (result: R) => Transform<T>,
  onFail: () => void,
): Promise<void> {
  const id = ++writeSeq
  list.update(s => beginWrite(s, id, pending))
  return write().then(
    result => {
      const at = nextWriteTick()
      list.update(s => confirmWrite(s, id, confirmed(result), at))
    },
    err => {
      console.error('Dashboard write failed:', err)
      list.update(s => failWrite(s, id))
      onFail()
    },
  )
}

const overrideKey = (o: Pick<CalendarOverride, 'event_key' | 'event_date'>) => `${o.event_key}|${o.event_date}`
const overrideId = (o: CalendarOverride) => o.id
const gusKey = (o: { date: string; role: string }) => `${o.date}|${o.role}`
const hbId = (e: HomebaseEvent) => e.id

/**
 * Upsert by key, keeping the id of the row being replaced so later actions on
 * it (reset, delete) still target the saved row. A new row takes `tmpId`,
 * fixed when the user acts so the transform is stable across re-application.
 */
function upsertKeepingId<T extends { id: string }>(
  key: (r: Omit<T, 'id'>) => string,
  row: Omit<T, 'id'>,
  tmpId: string,
): Transform<T> {
  const k = key(row)
  return rows => {
    const existing = rows.find(r => key(r) === k)
    return upsertBy<T>(key, { ...row, id: existing?.id ?? tmpId } as T)(rows)
  }
}

export function createDashboardMutations(deps: {
  overrides: ListHandle<CalendarOverride>
  gusOverrides: ListHandle<GusOverride>
  homebaseEvents: ListHandle<HomebaseEvent>
  api: DashboardApi
  notify: (message: string) => void
  userEmail: string
}) {
  const { overrides, gusOverrides, homebaseEvents, api, notify, userEmail } = deps
  // One queue per list: writes to the same list reach the server in the order
  // the user made them (see serialQueue). The overlays still show all of them
  // at once, newest on top.
  const q = { overrides: serialQueue(), gus: serialQueue(), hb: serialQueue() }
  return {
    saveOverride(o: Omit<CalendarOverride, 'id'>): Promise<void> {
      return runOptimisticWrite(
        overrides,
        upsertKeepingId<CalendarOverride>(overrideKey, o, pendingId()),
        () => q.overrides(() => api.upsertOverride(o)),
        saved => upsertBy(overrideKey, saved),
        () => notify("Couldn't save the event change"),
      )
    },

    deleteOverride(id: string): Promise<void> {
      // Not saved yet: the UI disables reset for these; nothing to delete.
      if (isPendingId(id)) return Promise.resolve()
      return runOptimisticWrite(
        overrides,
        removeBy(overrideId, id),
        () => q.overrides(() => api.deleteOverride(id)),
        () => removeBy(overrideId, id),
        () => notify("Couldn't reset the event"),
      )
    },

    setGusOwner(date: string, role: 'pickup' | 'dropoff', owner: 'nat' | 'caitie'): Promise<void> {
      const row = { date, role, owner, created_by: userEmail }
      return runOptimisticWrite(
        gusOverrides,
        upsertKeepingId<GusOverride>(gusKey, row, pendingId()),
        () => q.gus(() => api.upsertGusOverride(row)),
        saved => upsertBy(gusKey, saved),
        () => notify(`Couldn't change the ${role} owner`),
      )
    },

    clearGusOwner(date: string, role: 'pickup' | 'dropoff'): Promise<void> {
      const k = gusKey({ date, role })
      return runOptimisticWrite(
        gusOverrides,
        removeBy<GusOverride>(gusKey, k),
        () => q.gus(() => api.deleteGusOverride(date, role)),
        () => removeBy<GusOverride>(gusKey, k),
        () => notify(`Couldn't reset the ${role} owner`),
      )
    },

    createHomebaseEvent(fields: Omit<HomebaseEvent, 'id'>): Promise<void> {
      const tmp = pendingId()
      return runOptimisticWrite(
        homebaseEvents,
        upsertBy(hbId, { ...fields, id: tmp }),
        () => q.hb(() => api.createHomebaseEvent(fields)),
        created => rows => upsertBy(hbId, created)(removeBy(hbId, tmp)(rows)),
        () => notify("Couldn't add the event"),
      )
    },

    deleteHomebaseEvent(id: string): Promise<void> {
      if (isPendingId(id)) return Promise.resolve()
      return runOptimisticWrite(
        homebaseEvents,
        removeBy(hbId, id),
        () => q.hb(() => api.deleteHomebaseEvent(id)),
        () => removeBy(hbId, id),
        () => notify("Couldn't delete the event"),
      )
    },
  }
}

export type DashboardMutations = ReturnType<typeof createDashboardMutations>
