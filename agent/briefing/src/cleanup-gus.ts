/**
 * One-off migration: clear the Gus invite backlog.
 *
 * The pre-deterministic-id sync created Gus events with server-generated ids
 * and an unreliable existence check, so the calendar accumulated several copies
 * of the same pickup/dropoff slot. Those strays can't be adopted — nothing ties
 * them to a (date, role, owner) — so the migration is: delete every Gus event in
 * a wide window, then let the fixed sync recreate the current and upcoming weeks
 * at their canonical ids.
 *
 * Deletes use sendUpdates=none: this is housekeeping for events that are mostly
 * in the past, and a burst of cancellation emails would be pure noise.
 *
 * Usage (from repo root, with GOOGLE_OAUTH_TOKEN exported):
 *
 *   npm run cleanup-gus -w agent/briefing              # dry run, deletes nothing
 *   npm run cleanup-gus -w agent/briefing -- --apply   # actually delete
 *   npm run cleanup-gus -w agent/briefing -- --days 30 # narrower window
 *
 * Also runnable without a local token via the cleanup_gus_events workflow,
 * which reuses the GOOGLE_OAUTH_TOKEN Actions secret.
 *
 * Logging: never titles or attendees. Locally it also prints a per-date
 * breakdown so a dry run is reviewable; under GITHUB_ACTIONS that breakdown is
 * suppressed to counts only, because this repo is public and its Action logs
 * are world-readable — a list of pickup dates is the household's schedule.
 */

import { purgeGusEvents } from '@home-base/shared'
import { createGoogleTokenGetter } from './google-token.ts'

const DEFAULT_WINDOW_DAYS = 90

function parseArgs(argv: string[]): { apply: boolean; days: number; fromToday: boolean } {
  const apply = argv.includes('--apply')
  // Restrict the window to today onward. The sync never touches past dates, so
  // purging them destroys history for no benefit — but the forward window still
  // needs clearing when migrating to deterministic ids, and doing it here (with
  // sendUpdates=none) avoids the cancel/invite email burst the sync would
  // otherwise send on its first pass over each week.
  const fromToday = argv.includes('--from-today')
  const daysIdx = argv.indexOf('--days')
  const days = daysIdx >= 0 ? Number(argv[daysIdx + 1]) : DEFAULT_WINDOW_DAYS
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('--days must be a positive number')
  }
  return { apply, days, fromToday }
}

/** Shape produced by gusEventId(): hbgus<YYYYMMDD><role><owner>. */
const CANONICAL_ID = /^hbgus\d{8}(pickup|dropoff)(nat|caitie)$/

const roleOf = (summary: string): string =>
  summary === 'Gus pickup' ? 'pickup' : summary === 'Gus dropoff' ? 'dropoff' : 'other'

async function main(): Promise<void> {
  const { apply, days, fromToday } = parseArgs(process.argv.slice(2))

  const tokenJson = process.env.GOOGLE_OAUTH_TOKEN
  if (!tokenJson) throw new Error('Missing required env var: GOOGLE_OAUTH_TOKEN')
  const getAccessToken = createGoogleTokenGetter({ tokenJson })

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const timeMin = new Date(today)
  if (!fromToday) timeMin.setDate(timeMin.getDate() - days)
  const timeMax = new Date()
  timeMax.setHours(23, 59, 59, 999)
  timeMax.setDate(timeMax.getDate() + days)
  const todayStr = today.toISOString().slice(0, 10)

  console.log(
    `[cleanup-gus] window ${timeMin.toISOString().slice(0, 10)} → ${timeMax.toISOString().slice(0, 10)}` +
    `${fromToday ? ' (from today)' : ''} (${apply ? 'APPLY' : 'dry run'})`
  )

  const removed = await purgeGusEvents(getAccessToken, timeMin, timeMax, { dryRun: !apply })

  const byDate = new Map<string, number>()
  for (const e of removed) byDate.set(e.date, (byDate.get(e.date) ?? 0) + 1)

  console.log(`[cleanup-gus] ${removed.length} Gus event(s) across ${byDate.size} date(s)`)

  // Count per (date, role), not per date. A date holding two pickups and no
  // dropoff also totals 2 and would look healthy under a per-date count — so
  // per-date totals can't distinguish "one pickup + one dropoff" from a real
  // duplicate. This is the count that actually answers "are there duplicates?"
  const bySlot = new Map<string, number>()
  for (const e of removed) {
    const key = `${e.date}|${roleOf(e.summary)}`
    bySlot.set(key, (bySlot.get(key) ?? 0) + 1)
  }
  const slotCounts = [...bySlot.values()]
  const dupSlots = slotCounts.filter(n => n > 1).length
  const worstSlot = slotCounts.length > 0 ? Math.max(...slotCounts) : 0
  console.log(
    `[cleanup-gus] ${dupSlots} duplicated slot(s) — a slot is one (date, role);` +
    ` most copies of any single slot: ${worstSlot}`
  )

  // Past vs upcoming. The sync never touches past dates, so those events are
  // inert history; only the upcoming ones will be migrated to canonical ids.
  const past = removed.filter(e => e.date < todayStr).length
  console.log(`[cleanup-gus] ${past} in the past (sync never touches these), ${removed.length - past} today or later`)

  // Have the upcoming events migrated to deterministic ids yet? A legacy
  // (randomly-named) event still pending migration will be deleted+recreated on
  // its first sync, which sends a cancellation and a fresh invite. All-canonical
  // means the migration is done and no further invite churn is expected.
  const upcoming = removed.filter(e => e.date >= todayStr)
  const canonical = upcoming.filter(e => CANONICAL_ID.test(e.eventId)).length
  console.log(
    `[cleanup-gus] of the ${upcoming.length} upcoming: ${canonical} canonical id(s),` +
    ` ${upcoming.length - canonical} legacy id(s) awaiting migration`
  )

  // Churn probe. Every create sends Outlook a fresh invite and every update
  // re-sends it, so if the sync is rewriting events it should be leaving alone,
  // these counts climb every time a dashboard week is loaded. A converged sync
  // writes nothing, so on a week that has already migrated both should be 0.
  const ageBuckets = [15, 60] as const
  const now = Date.now()
  for (const mins of ageBuckets) {
    const cutoff = now - mins * 60_000
    const createdRecently = upcoming.filter(e => e.created && Date.parse(e.created) >= cutoff).length
    const updatedRecently = upcoming.filter(e => e.updated && Date.parse(e.updated) >= cutoff).length
    console.log(`[cleanup-gus] last ${mins}min: ${createdRecently} created, ${updatedRecently} updated`)
  }

  if (process.env.GITHUB_ACTIONS === 'true') {
    // Public repo → public logs. A list of pickup dates is the household's
    // schedule, so the per-date breakdown stays local-only.
    console.log('[cleanup-gus] per-date breakdown suppressed in CI')
  } else {
    for (const date of [...byDate.keys()].sort()) {
      const n = byDate.get(date)!
      console.log(`  ${date}: ${n}${n > 2 ? '  ← duplicates' : ''}`)
    }
  }

  if (!apply) {
    console.log('[cleanup-gus] dry run — nothing deleted. Re-run with --apply to delete.')
  } else {
    console.log('[cleanup-gus] done. Load the dashboard for this week and next so the')
    console.log('[cleanup-gus] sync recreates them at their canonical ids.')
  }
}

main().catch(err => {
  console.error('[cleanup-gus] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
