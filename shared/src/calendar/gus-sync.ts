// Gus pickup/dropoff calendar reconciliation — the pure decision layer.
//
// IMPORTANT: this file must have ZERO imports. It is consumed by two different
// runtimes — the Node briefing agent (via shared/src/calendar/io.ts) and the
// Deno Supabase Edge Function (supabase/functions/calendar-ops/index.ts, which
// imports it by relative path). Adding an import here breaks the Deno bundle.
//
// ── Why deterministic event IDs ──────────────────────────────────────────────
// Every Gus event's Google Calendar id is derived from (date, role, owner).
// Google enforces id uniqueness per calendar, so a duplicate cannot be created
// even when several writers (two browser tabs, the Sunday agent) race. That
// replaces the old "search for an existing event by title, create one if the
// search came back empty" approach, which manufactured duplicates whenever the
// read was incomplete — an unpaginated list can return zero items even when
// matches exist, and the free-text `q` index lags behind writes.
//
// One id PER OWNER rather than per slot. A responsibility flip is therefore
// DELETE <old owner's id> + UPSERT <new owner's id> — two distinct stable ids.
// The delete is a real event cancellation (sendUpdates=all), which is the
// strongest signal available for reaching the removed person's Outlook; merely
// swapping the attendee list on a shared event does not reliably cancel there.

export type GusRole = 'pickup' | 'dropoff'
export type GusOwner = 'nat' | 'caitie'

export const GUS_SPECS: Record<GusRole, { summary: string; startHour: number; endHour: number }> = {
  pickup: { summary: 'Gus pickup', startHour: 17, endHour: 18 },
  dropoff: { summary: 'Gus dropoff', startHour: 7, endHour: 8 },
}

export const GUS_SUMMARIES: string[] = [GUS_SPECS.pickup.summary, GUS_SPECS.dropoff.summary]

export function isGusSummary(summary: string | undefined | null): boolean {
  return summary === GUS_SPECS.pickup.summary || summary === GUS_SPECS.dropoff.summary
}

/**
 * Deterministic Google Calendar event id for a Gus slot.
 *
 * Google requires ids to use the base32hex alphabet — lowercase a-v and 0-9,
 * length 5-1024. Every character produced here is within that set: "hbgus",
 * the digits of the date, and the role/owner words ("pickup", "dropoff",
 * "nat", "caitie") contain no letter past 'v'.
 *
 *   gusEventId('2026-09-08', 'pickup', 'caitie') → 'hbgus20260908pickupcaitie'
 */
export function gusEventId(date: string, role: GusRole, owner: GusOwner): string {
  return `hbgus${date.replace(/-/g, '')}${role}${owner}`
}

/** A Gus event we want to exist, fully resolved. */
export type DesiredGusEvent = {
  eventId: string
  date: string
  role: GusRole
  owner: GusOwner
  attendeeEmail: string
  summary: string
  /** Local wall-clock ISO (no zone suffix) — the executor attaches the timezone. */
  startLocal: string
  endLocal: string
}

/** A Gus event currently on the calendar, as read back from Google. */
export type ExistingGusEvent = {
  eventId: string
  summary: string
  attendeeEmail: string | null
  /** Raw start/end strings straight from Google (dateTime or date). */
  start: string
  end: string
}

export type GusOp =
  | { kind: 'upsert'; event: DesiredGusEvent }
  | { kind: 'delete'; eventId: string; summary: string; date: string }

export type BuildDesiredInput = {
  /** One entry per day, already filtered to the days we're authoritative for. */
  gusCare: Array<{ date: string; pickup: GusOwner; dropoff: GusOwner }>
  natAttendeeEmail: string
  caitieAttendeeEmail: string
}

/** Expand computed responsibilities into the concrete events we want to exist. */
export function buildDesiredGusEvents(input: BuildDesiredInput): DesiredGusEvent[] {
  const desired: DesiredGusEvent[] = []
  for (const g of input.gusCare) {
    for (const role of ['pickup', 'dropoff'] as GusRole[]) {
      const owner = role === 'pickup' ? g.pickup : g.dropoff
      const spec = GUS_SPECS[role]
      desired.push({
        eventId: gusEventId(g.date, role, owner),
        date: g.date,
        role,
        owner,
        attendeeEmail: owner === 'nat' ? input.natAttendeeEmail : input.caitieAttendeeEmail,
        summary: spec.summary,
        startLocal: `${g.date}T${pad2(spec.startHour)}:00:00`,
        endLocal: `${g.date}T${pad2(spec.endHour)}:00:00`,
      })
    }
  }
  return desired
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Compare the events we want against the Gus events currently on the calendar
 * and return the minimal set of operations to converge.
 *
 * `existing` must be the COMPLETE list of Gus events in the window — every page
 * of the read, or the caller must abort rather than call this. A partial list
 * looks like "these events don't exist" and would produce spurious upserts.
 *
 * In the steady state this returns an EMPTY array. That matters: Google makes no
 * promise that a no-op update suppresses notification email, so "don't write
 * unless something actually differs" is what keeps repeat invites from going out.
 */
export function planGusSync(
  desired: DesiredGusEvent[],
  existing: ExistingGusEvent[],
): GusOp[] {
  const ops: GusOp[] = []
  const desiredById = new Map(desired.map(d => [d.eventId, d]))
  const existingById = new Map(existing.map(e => [e.eventId, e]))

  // Anything on the calendar that isn't a desired event goes. One rule covers
  // three cases: the losing side of an owner flip, legacy/duplicate events with
  // randomly-generated ids, and dates that are no longer desired at all.
  for (const ex of existing) {
    if (!desiredById.has(ex.eventId)) {
      ops.push({
        kind: 'delete',
        eventId: ex.eventId,
        summary: ex.summary,
        date: ex.start.slice(0, 10),
      })
    }
  }

  for (const want of desired) {
    const ex = existingById.get(want.eventId)
    if (!ex || !matchesDesired(ex, want)) {
      ops.push({ kind: 'upsert', event: want })
    }
  }

  return ops
}

/**
 * Does the event on the calendar already match what we want? Compared on the
 * fields we own; anything else (description, colour, the user's own RSVP) is
 * left alone. Start/end are compared on the local wall-clock prefix so that a
 * zone suffix or a UTC-normalised offset from Google doesn't read as a diff.
 */
function matchesDesired(ex: ExistingGusEvent, want: DesiredGusEvent): boolean {
  if (ex.summary !== want.summary) return false
  if ((ex.attendeeEmail ?? '').toLowerCase() !== want.attendeeEmail.toLowerCase()) return false
  if (!sameWallClock(ex.start, want.startLocal)) return false
  if (!sameWallClock(ex.end, want.endLocal)) return false
  return true
}

/** Compare "YYYY-MM-DDTHH:mm" prefixes, ignoring seconds and any zone suffix. */
function sameWallClock(a: string, b: string): boolean {
  return a.slice(0, 16) === b.slice(0, 16)
}
