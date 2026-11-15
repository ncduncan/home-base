// Optimistic list state for dashboard mutations.
//
// The visible list is the last server read with the in-flight writes layered on
// top. A write's overlay is added when the user acts, so the screen changes
// before the request returns. If the write fails, the overlay is dropped, which
// is the rollback — there is no snapshot to restore and nothing to get wrong
// when several writes overlap.
//
// A refetch replaces only the server rows, never the overlays, so a refetch
// that lands mid-write can't undo a pending change. A confirmed write keeps its
// overlay until a fetch that *started after it settled* lands: a fetch issued
// earlier may still carry the pre-write row. A monotonic write clock orders the
// two: it ticks once per settled write (see writeClock / nextWriteTick), and
// fetches capture its value when they start.
//
// Pure and React-free so it can be unit-tested; DashboardPage holds one of
// these per list in useState and applies the functions as updaters.

export type Transform<T> = (rows: T[]) => T[]

export interface Overlay<T> {
  id: number
  transform: Transform<T>
  /** null while the write is in flight; the clock tick it settled at after. */
  settledAt: number | null
}

export interface OptimisticList<T> {
  server: T[]
  overlays: Overlay<T>[]
}

export function emptyList<T>(): OptimisticList<T> {
  return { server: [], overlays: [] }
}

export function viewOf<T>(s: OptimisticList<T>): T[] {
  return s.overlays.reduce((rows, o) => o.transform(rows), s.server)
}

export function hasPendingWrites<T>(s: OptimisticList<T>): boolean {
  return s.overlays.some(o => o.settledAt === null)
}

export function beginWrite<T>(s: OptimisticList<T>, id: number, transform: Transform<T>): OptimisticList<T> {
  return { ...s, overlays: [...s.overlays, { id, transform, settledAt: null }] }
}

/**
 * The write succeeded at clock tick `settledAt`. `transform` applies the
 * server's answer (real ids etc).
 */
export function confirmWrite<T>(
  s: OptimisticList<T>, id: number, transform: Transform<T>, settledAt: number,
): OptimisticList<T> {
  if (!s.overlays.some(o => o.id === id)) return s
  return {
    server: transform(s.server),
    overlays: s.overlays.map(o => (o.id === id ? { id, transform, settledAt } : o)),
  }
}

/** The write failed: drop its overlay, which reverts the screen to the server. */
export function failWrite<T>(s: OptimisticList<T>, id: number): OptimisticList<T> {
  return { ...s, overlays: s.overlays.filter(o => o.id !== id) }
}

/**
 * A fetch landed. `startedAt` is the clock value captured when it was issued;
 * confirmed overlays that settled at or before it are now reflected in `rows`.
 */
export function receiveServerRows<T>(s: OptimisticList<T>, rows: T[], startedAt: number): OptimisticList<T> {
  return {
    ...s,
    server: rows,
    overlays: s.overlays.filter(o => o.settledAt === null || o.settledAt > startedAt),
  }
}

// ── Write clock ─────────────────────────────────────────────────────────────
// Module-level so a fetch can read it synchronously from any callback; React
// state can't be read that way without a stale closure.

let clock = 0

/** Current tick. Capture it when a fetch starts; pass it to receiveServerRows. */
export function writeClock(): number {
  return clock
}

/** Advance the clock for a write that just settled; returns its tick. */
export function nextWriteTick(): number {
  clock += 1
  return clock
}

// ── Transforms ──────────────────────────────────────────────────────────────

/** Replace the row with the same key, or append it. Idempotent. */
export function upsertBy<T>(key: (row: T) => string, row: T): Transform<T> {
  const k = key(row)
  return rows => {
    let found = false
    const next = rows.map(r => {
      if (key(r) !== k) return r
      found = true
      return row
    })
    return found ? next : [...next, row]
  }
}

export function removeBy<T>(key: (row: T) => string, k: string): Transform<T> {
  return rows => rows.filter(r => key(r) !== k)
}

// ── Serial write queue ──────────────────────────────────────────────────────

/**
 * Runs writes one at a time, in the order the user made them. Overlapping
 * writes to one row (set an owner, then reset it) could otherwise land at the
 * server in either order and leave it disagreeing with the screen. A failed
 * write doesn't block the next.
 */
export function serialQueue(): <R>(write: () => Promise<R>) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve()
  return write => {
    const run = tail.then(write)
    tail = run.catch(() => {})
    return run
  }
}

// ── Temporary ids for rows the server hasn't created yet ───────────────────

const PENDING_PREFIX = 'pending-'
let pendingSeq = 0

export function pendingId(): string {
  pendingSeq += 1
  return `${PENDING_PREFIX}${pendingSeq}`
}

export function isPendingId(id: string): boolean {
  return id.startsWith(PENDING_PREFIX)
}
