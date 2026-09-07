import { describe, it, expect } from 'vitest'
import {
  gusEventId,
  buildDesiredGusEvents,
  planGusSync,
  isGusSummary,
  type DesiredGusEvent,
  type ExistingGusEvent,
} from './gus-sync'

const NAT = 'nat@work.example'
const CAI = 'caitie@work.example'

const desiredFor = (gusCare: Array<{ date: string; pickup: 'nat' | 'caitie'; dropoff: 'nat' | 'caitie' }>) =>
  buildDesiredGusEvents({ gusCare, natAttendeeEmail: NAT, caitieAttendeeEmail: CAI })

/** The calendar event Google would return for a desired event that already exists. */
const asExisting = (d: DesiredGusEvent, over: Partial<ExistingGusEvent> = {}): ExistingGusEvent => ({
  eventId: d.eventId,
  summary: d.summary,
  attendeeEmail: d.attendeeEmail,
  start: `${d.startLocal}-04:00`,
  end: `${d.endLocal}-04:00`,
  ...over,
})

describe('gusEventId', () => {
  it('is deterministic and readable', () => {
    expect(gusEventId('2026-09-08', 'pickup', 'caitie')).toBe('hbgus20260908pickupcaitie')
    expect(gusEventId('2026-09-08', 'dropoff', 'nat')).toBe('hbgus20260908dropoffnat')
  })

  it('only uses characters Google accepts (base32hex: a-v and 0-9, length 5-1024)', () => {
    for (const date of ['2026-01-01', '2026-12-31', '2026-09-08']) {
      for (const role of ['pickup', 'dropoff'] as const) {
        for (const owner of ['nat', 'caitie'] as const) {
          const id = gusEventId(date, role, owner)
          expect(id).toMatch(/^[a-v0-9]+$/)
          expect(id.length).toBeGreaterThanOrEqual(5)
          expect(id.length).toBeLessThanOrEqual(1024)
        }
      }
    }
  })

  it('gives each (date, role, owner) its own id', () => {
    const ids = new Set([
      gusEventId('2026-09-08', 'pickup', 'nat'),
      gusEventId('2026-09-08', 'pickup', 'caitie'),
      gusEventId('2026-09-08', 'dropoff', 'nat'),
      gusEventId('2026-09-09', 'pickup', 'nat'),
    ])
    expect(ids.size).toBe(4)
  })
})

describe('buildDesiredGusEvents', () => {
  it('emits one pickup and one dropoff per day with the right attendee and hours', () => {
    const [pickup, dropoff] = desiredFor([{ date: '2026-09-08', pickup: 'nat', dropoff: 'caitie' }])
    expect(pickup).toMatchObject({
      role: 'pickup', owner: 'nat', attendeeEmail: NAT, summary: 'Gus pickup',
      startLocal: '2026-09-08T17:00:00', endLocal: '2026-09-08T18:00:00',
    })
    expect(dropoff).toMatchObject({
      role: 'dropoff', owner: 'caitie', attendeeEmail: CAI, summary: 'Gus dropoff',
      startLocal: '2026-09-08T07:00:00', endLocal: '2026-09-08T08:00:00',
    })
  })
})

describe('planGusSync', () => {
  it('creates both events for a day with nothing on the calendar', () => {
    const desired = desiredFor([{ date: '2026-09-08', pickup: 'caitie', dropoff: 'caitie' }])
    const ops = planGusSync(desired, [])
    expect(ops).toHaveLength(2)
    expect(ops.every(o => o.kind === 'upsert')).toBe(true)
  })

  // The property that stops repeat invite emails: a converged calendar means no writes.
  it('emits NOTHING when the calendar already matches', () => {
    const desired = desiredFor([{ date: '2026-09-08', pickup: 'caitie', dropoff: 'nat' }])
    expect(planGusSync(desired, desired.map(d => asExisting(d)))).toEqual([])
  })

  it('is stable across repeated passes (idempotent)', () => {
    const desired = desiredFor([
      { date: '2026-09-08', pickup: 'caitie', dropoff: 'nat' },
      { date: '2026-09-09', pickup: 'nat', dropoff: 'nat' },
    ])
    const existing = desired.map(d => asExisting(d))
    expect(planGusSync(desired, existing)).toEqual([])
    expect(planGusSync(desired, existing)).toEqual([])
  })

  it('an owner flip cancels the old event and creates the new one', () => {
    const before = desiredFor([{ date: '2026-09-08', pickup: 'caitie', dropoff: 'caitie' }])
    const after = desiredFor([{ date: '2026-09-08', pickup: 'nat', dropoff: 'caitie' }])
    const ops = planGusSync(after, before.map(d => asExisting(d)))

    expect(ops).toHaveLength(2)
    expect(ops).toContainEqual({
      kind: 'delete',
      eventId: 'hbgus20260908pickupcaitie',
      summary: 'Gus pickup',
      date: '2026-09-08',
    })
    expect(ops).toContainEqual({
      kind: 'upsert',
      event: after.find(d => d.eventId === 'hbgus20260908pickupnat'),
    })
    // The dropoff didn't change, so it must not be touched.
    expect(ops.some(o => o.kind === 'upsert' && o.event.role === 'dropoff')).toBe(false)
  })

  it('deletes every legacy duplicate with a random id and creates the canonical one', () => {
    const desired = desiredFor([{ date: '2026-09-08', pickup: 'caitie', dropoff: 'caitie' }])
    const pickup = desired.find(d => d.role === 'pickup')!
    // Four copies of the same slot, as produced by the old non-deterministic sync.
    const existing: ExistingGusEvent[] = ['abc123', 'def456', 'ghi789', 'jkl012'].map(id =>
      asExisting(pickup, { eventId: id }),
    )

    const ops = planGusSync(desired, existing)
    const deletes = ops.filter(o => o.kind === 'delete')
    expect(deletes).toHaveLength(4)
    // ...and exactly one canonical pickup is created in their place.
    const pickupUpserts = ops.filter(o => o.kind === 'upsert' && o.event.role === 'pickup')
    expect(pickupUpserts).toHaveLength(1)
  })

  it('keeps the canonical event and deletes only the duplicates around it', () => {
    const desired = desiredFor([{ date: '2026-09-08', pickup: 'caitie', dropoff: 'caitie' }])
    const existing = [
      ...desired.map(d => asExisting(d)),
      asExisting(desired[0], { eventId: 'strayduplicate' }),
    ]
    const ops = planGusSync(desired, existing)
    expect(ops).toEqual([
      { kind: 'delete', eventId: 'strayduplicate', summary: 'Gus pickup', date: '2026-09-08' },
    ])
  })

  it('deletes events on dates that are no longer desired', () => {
    const stale = desiredFor([{ date: '2026-09-12', pickup: 'nat', dropoff: 'nat' }])
    const ops = planGusSync([], stale.map(d => asExisting(d)))
    expect(ops).toHaveLength(2)
    expect(ops.every(o => o.kind === 'delete')).toBe(true)
  })

  it('re-upserts when the attendee has drifted under a correct id', () => {
    const desired = desiredFor([{ date: '2026-09-08', pickup: 'caitie', dropoff: 'caitie' }])
    const existing = desired.map(d =>
      d.role === 'pickup' ? asExisting(d, { attendeeEmail: 'someone.else@example.com' }) : asExisting(d),
    )
    const ops = planGusSync(desired, existing)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: 'upsert', event: { role: 'pickup' } })
  })

  it('re-upserts when the times have drifted (e.g. someone dragged the event)', () => {
    const desired = desiredFor([{ date: '2026-09-08', pickup: 'caitie', dropoff: 'caitie' }])
    const existing = desired.map(d =>
      d.role === 'dropoff' ? asExisting(d, { start: '2026-09-08T09:00:00-04:00' }) : asExisting(d),
    )
    const ops = planGusSync(desired, existing)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: 'upsert', event: { role: 'dropoff' } })
  })

  it('treats a missing attendee as a mismatch rather than a match', () => {
    const desired = desiredFor([{ date: '2026-09-08', pickup: 'caitie', dropoff: 'caitie' }])
    const existing = [asExisting(desired[0], { attendeeEmail: null }), asExisting(desired[1])]
    expect(planGusSync(desired, existing)).toHaveLength(1)
  })

  it('ignores attendee case differences', () => {
    const desired = desiredFor([{ date: '2026-09-08', pickup: 'caitie', dropoff: 'caitie' }])
    const existing = desired.map(d => asExisting(d, { attendeeEmail: d.attendeeEmail.toUpperCase() }))
    expect(planGusSync(desired, existing)).toEqual([])
  })

  it('ignores timezone-suffix differences on otherwise identical times', () => {
    const desired = desiredFor([{ date: '2026-09-08', pickup: 'caitie', dropoff: 'caitie' }])
    const existing = desired.map(d => asExisting(d, { start: d.startLocal, end: d.endLocal }))
    expect(planGusSync(desired, existing)).toEqual([])
  })

  it('flipping an owner back to a previously-used id is an ordinary upsert', () => {
    // nat → caitie → nat. The final pass must ask for the original nat id again;
    // reviving it is the executor's job (PUT, not insert — the id still exists
    // on Google as a cancelled event).
    const desired = desiredFor([{ date: '2026-09-08', pickup: 'nat', dropoff: 'nat' }])
    const caitieHeldIt = desiredFor([{ date: '2026-09-08', pickup: 'caitie', dropoff: 'nat' }])
    const ops = planGusSync(desired, caitieHeldIt.map(d => asExisting(d)))
    expect(ops).toContainEqual({
      kind: 'delete', eventId: 'hbgus20260908pickupcaitie', summary: 'Gus pickup', date: '2026-09-08',
    })
    expect(ops.filter(o => o.kind === 'upsert')).toHaveLength(1)
    expect(ops.find(o => o.kind === 'upsert')).toMatchObject({
      event: { eventId: 'hbgus20260908pickupnat' },
    })
  })

  it('handles a full week without cross-talk between days', () => {
    const week = [
      { date: '2026-09-07', pickup: 'caitie', dropoff: 'caitie' },
      { date: '2026-09-08', pickup: 'nat', dropoff: 'caitie' },
      { date: '2026-09-09', pickup: 'caitie', dropoff: 'nat' },
    ] as const
    const desired = desiredFor([...week])
    expect(planGusSync(desired, desired.map(d => asExisting(d)))).toEqual([])
    expect(planGusSync(desired, [])).toHaveLength(6)
  })
})

describe('isGusSummary', () => {
  it('matches only the exact Gus titles', () => {
    expect(isGusSummary('Gus pickup')).toBe(true)
    expect(isGusSummary('Gus dropoff')).toBe(true)
    expect(isGusSummary('Gus pickup (old)')).toBe(false)
    expect(isGusSummary('Dentist')).toBe(false)
    expect(isGusSummary(undefined)).toBe(false)
  })
})
