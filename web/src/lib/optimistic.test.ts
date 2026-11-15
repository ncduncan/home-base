import { describe, it, expect } from 'vitest'
import {
  emptyList,
  viewOf,
  beginWrite,
  confirmWrite,
  failWrite,
  receiveServerRows,
  hasPendingWrites,
  pendingId,
  isPendingId,
  upsertBy,
  removeBy,
  writeClock,
  nextWriteTick,
} from './optimistic'

interface Row { id: string; v: number }
const byId = (r: Row) => r.id

describe('optimistic list store', () => {
  it('shows a pending write on top of server rows immediately', () => {
    let s = receiveServerRows(emptyList<Row>(), [{ id: 'a', v: 1 }], 0)
    s = beginWrite(s, 1, upsertBy(byId, { id: 'a', v: 2 }))
    expect(viewOf(s)).toEqual([{ id: 'a', v: 2 }])
    expect(hasPendingWrites(s)).toBe(true)
  })

  it('rolls back to the server rows when the write fails', () => {
    let s = receiveServerRows(emptyList<Row>(), [{ id: 'a', v: 1 }], 0)
    s = beginWrite(s, 1, removeBy(byId, 'a'))
    expect(viewOf(s)).toEqual([])
    s = failWrite(s, 1)
    expect(viewOf(s)).toEqual([{ id: 'a', v: 1 }])
    expect(hasPendingWrites(s)).toBe(false)
  })

  it('keeps a pending change on screen when a refetch lands mid-write', () => {
    let s = receiveServerRows(emptyList<Row>(), [{ id: 'a', v: 1 }], 0)
    s = beginWrite(s, 1, upsertBy(byId, { id: 'a', v: 2 }))
    // A refetch that started before the write settled returns the old value.
    s = receiveServerRows(s, [{ id: 'a', v: 1 }, { id: 'b', v: 9 }], 0)
    expect(viewOf(s)).toEqual([{ id: 'a', v: 2 }, { id: 'b', v: 9 }])
  })

  it('keeps a confirmed change when a stale refetch (started before confirm) lands after it', () => {
    let s = receiveServerRows(emptyList<Row>(), [{ id: 'a', v: 1 }], 0)
    s = beginWrite(s, 1, upsertBy(byId, { id: 'a', v: 2 }))
    const staleFetchStartedAt = 10
    s = confirmWrite(s, 1, upsertBy(byId, { id: 'a', v: 2 }), 11)
    s = receiveServerRows(s, [{ id: 'a', v: 1 }], staleFetchStartedAt)
    expect(viewOf(s)).toEqual([{ id: 'a', v: 2 }])
  })

  it('matches the server once a fetch that started after the write settled lands', () => {
    let s = receiveServerRows(emptyList<Row>(), [{ id: 'a', v: 1 }], 0)
    s = beginWrite(s, 1, upsertBy(byId, { id: 'a', v: 2 }))
    s = confirmWrite(s, 1, upsertBy(byId, { id: 'a', v: 2 }), 11)
    const freshFetchStartedAt = 11
    // The other user changed it again after our write; the server wins.
    s = receiveServerRows(s, [{ id: 'a', v: 3 }], freshFetchStartedAt)
    expect(viewOf(s)).toEqual([{ id: 'a', v: 3 }])
    expect(s.overlays).toHaveLength(0)
  })

  it('replaces a pending row with the confirmed server row (temp id → real id)', () => {
    let s = emptyList<Row>()
    const tmp = pendingId()
    s = beginWrite(s, 1, upsertBy(byId, { id: tmp, v: 5 }))
    expect(isPendingId(viewOf(s)[0].id)).toBe(true)
    s = confirmWrite(s, 1, upsertBy(byId, { id: 'real', v: 5 }), 1)
    expect(viewOf(s)).toEqual([{ id: 'real', v: 5 }])
    expect(hasPendingWrites(s)).toBe(false)
  })

  it('confirmed transforms are idempotent against the patched server rows', () => {
    let s = emptyList<Row>()
    s = beginWrite(s, 1, upsertBy(byId, { id: 'x', v: 1 }))
    s = confirmWrite(s, 1, upsertBy(byId, { id: 'x', v: 1 }), 1)
    expect(viewOf(s)).toEqual([{ id: 'x', v: 1 }])
  })

  it('the write clock only moves forward', () => {
    const a = writeClock()
    const b = nextWriteTick()
    expect(b).toBe(a + 1)
    expect(writeClock()).toBe(b)
  })

  it('pendingId values are unique and recognisable', () => {
    const a = pendingId()
    const b = pendingId()
    expect(a).not.toBe(b)
    expect(isPendingId(a)).toBe(true)
    expect(isPendingId('1234')).toBe(false)
  })
})
