/**
 * Pure transform that turns the fetched data into the merge_variables payload
 * the Liquid template consumes.
 *
 * Layout rules — mirror the web dashboard's DayColumn (single-day variant):
 *   • banners      = all-day, non-AMION events that touch today (incl. multi-day)
 *   • caitie items = AMION shifts + Gus events + all-day Caitie events; non-AMION
 *                    timed Caitie events collapse into one "Research" block
 *                    (matches DayColumn's computeRangeBlock for Caitie).
 *   • nat items    = a static 8a–5p "Work" block on weekdays + every Nat event
 *                    rendered discretely (matches DayColumn's Nat behaviour).
 *   • tasks        = Asana tasks due today + overdue tasks that roll into today.
 */

import {
  eventOwner,
  type AsanaTask,
  type CalendarEvent,
  type GusResponsibility,
} from '@home-base/shared'
import type { WeatherToday } from './weather.ts'

export type ShiftGlyph = 'D' | 'N' | 'T' | '24' | 'B'

export type Item = {
  kind: 'shift' | 'event' | 'block'
  glyph: ShiftGlyph | null
  title: string
  time: string
}

export type Task = {
  name: string
  is_overdue: boolean
}

export type OwnerSection = {
  gus_dropoff: boolean
  gus_pickup: boolean
  items: Item[]
  tasks: Task[]
}

export type Banner = {
  title: string
  continues: boolean
}

export type DayPayload = {
  date_label: string
  generated_at: string
  weather: WeatherToday | null
  banners: Banner[]
  caitie: OwnerSection
  nat: OwnerSection
}

const SHIFT_GLYPH: Record<string, ShiftGlyph> = {
  training: 'T',
  day: 'D',
  night: 'N',
  '24hr': '24',
  backup: 'B',
}

const SHIFT_TITLE: Record<string, string> = {
  training: 'Training',
  day: 'Day Shift',
  night: 'Night Shift',
  '24hr': '24Hr Shift',
  backup: 'Backup',
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n) }

function fmtTime(iso: string): string {
  // "HH:mm:ss" or full ISO — extract hour/minute from local-time string.
  const h = parseInt(iso.slice(11, 13), 10)
  const m = parseInt(iso.slice(14, 16), 10)
  const ampm = h >= 12 ? 'p' : 'a'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12}${ampm}` : `${h12}:${pad2(m)}${ampm}`
}

function fmtRange(startIso: string, endIso: string, today: string): string {
  const startDay = startIso.slice(0, 10)
  const endDay = endIso.slice(0, 10)
  const crossesDay = endDay !== startDay
  const s = fmtTime(startIso)
  const e = fmtTime(endIso)

  // If the shift started yesterday and lands today, render the morning end only.
  if (startDay < today && endDay === today) {
    return `–${e}`
  }
  if (!crossesDay && s.slice(-1) === e.slice(-1)) {
    return `${s.slice(0, -1)}-${e}`
  }
  return `${s}-${e}${crossesDay ? '+1' : ''}`
}

function isGusEvent(event: CalendarEvent): boolean {
  return event.title === 'Gus pickup' || event.title === 'Gus dropoff'
}

function dayCovers(event: CalendarEvent, date: string): boolean {
  if (event.all_day) {
    // Google uses exclusive end-date for all-day events.
    const startDate = event.start.slice(0, 10)
    const endDate = event.end.slice(0, 10)
    if (endDate > startDate) {
      return startDate <= date && date < endDate
    }
    return startDate === date
  }
  // Timed events: render on whichever day they start on.
  return event.start.slice(0, 10) === date
}

function prevDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T12:00:00`).getDay()
  return day === 0 || day === 6
}

function dateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).toUpperCase().replace(',', '')
}

function generatedAtLabel(now: Date): string {
  const h = now.getHours()
  const m = now.getMinutes()
  const h12 = h % 12 || 12
  const ampm = h >= 12 ? 'p' : 'a'
  const monthDay = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${h12}:${pad2(m)}${ampm} ${monthDay}`
}

function buildBanners(events: CalendarEvent[], today: string): Banner[] {
  const out: Banner[] = []
  for (const ev of events) {
    if (!ev.all_day || ev.is_amion) continue
    if (!dayCovers(ev, today)) continue
    const endDate = ev.end.slice(0, 10)
    const startDate = ev.start.slice(0, 10)
    const lastDay = endDate > startDate ? prevDay(endDate) : startDate
    out.push({ title: ev.title || '(untitled)', continues: lastDay > today })
  }
  return out
}

function buildCaitieItems(events: CalendarEvent[], today: string): Item[] {
  const todayEvents = events.filter(e => eventOwner(e) === 'caitie' && dayCovers(e, today))

  const items: Item[] = []

  // 1. AMION shifts — discrete with shift-glyph
  for (const e of todayEvents) {
    if (!e.is_amion || !e.amion_kind) continue
    const glyph = SHIFT_GLYPH[e.amion_kind] ?? null
    const title = SHIFT_TITLE[e.amion_kind] ?? 'Shift'
    const time = e.all_day ? 'all day' : fmtRange(e.start, e.end, today)
    items.push({ kind: 'shift', glyph, title, time })
  }

  // 2. Gus events Caitie owns (discrete, no glyph — pill row handles ownership)
  for (const e of todayEvents) {
    if (!isGusEvent(e)) continue
    items.push({
      kind: 'event',
      glyph: null,
      title: e.title,
      time: e.all_day ? 'all day' : fmtTime(e.start),
    })
  }

  // 3. All-day non-AMION Caitie events (rare — most all-day events are family banners)
  for (const e of todayEvents) {
    if (e.is_amion) continue
    if (isGusEvent(e)) continue
    if (!e.all_day) continue
    items.push({ kind: 'event', glyph: null, title: e.title || '(untitled)', time: 'all day' })
  }

  // 4. Timed non-AMION Caitie events → collapse into a single "Research" block
  //    (mirrors web/src/lib/busy-block.ts computeRangeBlock for Caitie).
  const timedNonAmion = todayEvents.filter(e =>
    !e.is_amion && !e.all_day && !isGusEvent(e)
  )
  if (timedNonAmion.length > 0) {
    let earliest = timedNonAmion[0]
    let latest = timedNonAmion[0]
    for (const e of timedNonAmion) {
      if (e.start < earliest.start) earliest = e
      if (e.end > latest.end) latest = e
    }
    items.push({
      kind: 'block',
      glyph: null,
      title: 'Research',
      time: fmtRange(earliest.start, latest.end, today),
    })
  }

  // Sort: items with parseable start times go in order; the all-day ones (Backup
  // shifts, banners) sort to the top by virtue of their time string.
  return items.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
}

function buildNatItems(events: CalendarEvent[], today: string): Item[] {
  const todayEvents = events.filter(e => eventOwner(e) === 'nat' && dayCovers(e, today))

  const items: Item[] = []

  // Static 8a–5p "Work" block on weekdays (matches computeNatWorkBlock)
  if (!isWeekend(today)) {
    items.push({ kind: 'block', glyph: null, title: 'Work', time: '8a-5p' })
  }

  // Every Nat-owned event rendered discretely (incl. Gus pickup/dropoff)
  for (const e of todayEvents) {
    if (e.all_day) {
      items.push({ kind: 'event', glyph: null, title: e.title || '(untitled)', time: 'all day' })
    } else {
      items.push({
        kind: 'event',
        glyph: null,
        title: e.title || '(untitled)',
        time: fmtRange(e.start, e.end, today),
      })
    }
  }

  return items.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
}

function sortKey(item: Item): string {
  // "all day" sorts before timed entries; the block label "8a-5p" sorts naturally.
  if (item.time === 'all day') return '\x00'
  // Pad hour digits to two — "9a-11a" sorts after "10a-12p" otherwise.
  const m = item.time.match(/^(\d+)(:(\d+))?([ap])/)
  if (!m) return item.time
  let hour = parseInt(m[1], 10)
  if (m[4] === 'p' && hour !== 12) hour += 12
  if (m[4] === 'a' && hour === 12) hour = 0
  const min = m[3] ? parseInt(m[3], 10) : 0
  return `${pad2(hour)}${pad2(min)}`
}

function buildTasks(
  tasks: AsanaTask[],
  today: string,
  forCaitie: boolean,
): Task[] {
  const out: Task[] = []
  for (const t of tasks) {
    if (t.completed) continue
    if (!t.due_on) continue
    const isCait = (t.assignee?.name ?? '').toLowerCase().startsWith('cait')
    if (forCaitie !== isCait) continue
    // Today's bucket: due today OR overdue (rolls forward to today).
    if (t.due_on > today) continue
    out.push({ name: t.name, is_overdue: t.due_on < today })
  }
  // Overdue first within bucket; then by due date ascending.
  out.sort((a, b) => {
    if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return out
}

export function buildDayPayload(input: {
  now: Date
  today: string
  events: CalendarEvent[]
  gusCare: GusResponsibility[]
  asanaTasks: AsanaTask[]
  weather: WeatherToday | null
}): DayPayload {
  const { now, today, events, gusCare, asanaTasks, weather } = input

  const banners = buildBanners(events, today)
  const caitieItems = buildCaitieItems(events, today)
  const natItems = buildNatItems(events, today)

  const gusToday = gusCare.find(g => g.date === today) ?? null
  const caitieDropoff = gusToday?.dropoff === 'caitie'
  const caitiePickup = gusToday?.pickup === 'caitie'
  const natDropoff = gusToday?.dropoff === 'nat'
  const natPickup = gusToday?.pickup === 'nat'

  return {
    date_label: dateLabel(today),
    generated_at: generatedAtLabel(now),
    weather,
    banners,
    caitie: {
      gus_dropoff: caitieDropoff,
      gus_pickup: caitiePickup,
      items: caitieItems,
      tasks: buildTasks(asanaTasks, today, true),
    },
    nat: {
      gus_dropoff: natDropoff,
      gus_pickup: natPickup,
      items: natItems,
      tasks: buildTasks(asanaTasks, today, false),
    },
  }
}
