/**
 * Cap and shape the final merge_variables payload.
 *
 * Display is 800×480 monochrome, so there's only so much we can render before
 * rows clip. We also stay under TRMNL's documented ~2KB payload budget — the
 * Liquid template lives server-side, only the variable values travel.
 */

import type { DayPayload, OwnerSection } from './build-day.ts'

const MAX_BANNERS = 3
const MAX_ITEMS_PER_OWNER = 8
const MAX_TASKS_PER_OWNER = 4
const MAX_TITLE_CHARS = 34
const MAX_BYTES = 1900

function truncate(s: string, max = MAX_TITLE_CHARS): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1).trimEnd()}…`
}

function capSection(section: OwnerSection): OwnerSection {
  return {
    gus_dropoff: section.gus_dropoff,
    gus_pickup: section.gus_pickup,
    items: section.items.slice(0, MAX_ITEMS_PER_OWNER).map(it => ({
      ...it,
      title: truncate(it.title),
    })),
    tasks: section.tasks.slice(0, MAX_TASKS_PER_OWNER).map(t => ({
      ...t,
      name: truncate(t.name),
    })),
  }
}

export type MergeVariables = DayPayload

export function renderPayload(day: DayPayload): { merge_variables: MergeVariables } {
  const capped: DayPayload = {
    ...day,
    banners: day.banners.slice(0, MAX_BANNERS).map(b => ({
      ...b,
      title: truncate(b.title),
    })),
    caitie: capSection(day.caitie),
    nat: capSection(day.nat),
  }

  const payload = { merge_variables: capped }
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
  if (bytes > MAX_BYTES) {
    // Break down each top-level slot so we can see where the bloat is.
    const breakdown: Record<string, number> = {
      banners: Buffer.byteLength(JSON.stringify(capped.banners)),
      caitie_items: Buffer.byteLength(JSON.stringify(capped.caitie.items)),
      caitie_tasks: Buffer.byteLength(JSON.stringify(capped.caitie.tasks)),
      nat_items: Buffer.byteLength(JSON.stringify(capped.nat.items)),
      nat_tasks: Buffer.byteLength(JSON.stringify(capped.nat.tasks)),
    }
    throw new Error(
      `TRMNL payload too large: ${bytes} bytes (max ${MAX_BYTES}). ` +
      `Breakdown: ${JSON.stringify(breakdown)}`
    )
  }
  return payload
}
