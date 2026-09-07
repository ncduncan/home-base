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

function parseArgs(argv: string[]): { apply: boolean; days: number } {
  const apply = argv.includes('--apply')
  const daysIdx = argv.indexOf('--days')
  const days = daysIdx >= 0 ? Number(argv[daysIdx + 1]) : DEFAULT_WINDOW_DAYS
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('--days must be a positive number')
  }
  return { apply, days }
}

async function main(): Promise<void> {
  const { apply, days } = parseArgs(process.argv.slice(2))

  const tokenJson = process.env.GOOGLE_OAUTH_TOKEN
  if (!tokenJson) throw new Error('Missing required env var: GOOGLE_OAUTH_TOKEN')
  const getAccessToken = createGoogleTokenGetter({ tokenJson })

  const timeMin = new Date()
  timeMin.setHours(0, 0, 0, 0)
  timeMin.setDate(timeMin.getDate() - days)
  const timeMax = new Date()
  timeMax.setHours(23, 59, 59, 999)
  timeMax.setDate(timeMax.getDate() + days)

  console.log(
    `[cleanup-gus] window ${timeMin.toISOString().slice(0, 10)} → ${timeMax.toISOString().slice(0, 10)}` +
    ` (${apply ? 'APPLY' : 'dry run'})`
  )

  const removed = await purgeGusEvents(getAccessToken, timeMin, timeMax, { dryRun: !apply })

  const byDate = new Map<string, number>()
  for (const e of removed) byDate.set(e.date, (byDate.get(e.date) ?? 0) + 1)

  console.log(`[cleanup-gus] ${removed.length} Gus event(s) across ${byDate.size} date(s)`)

  // A healthy date holds at most 2 events (one pickup + one dropoff); anything
  // above that is the duplicate backlog.
  const counts = [...byDate.values()]
  const overfull = counts.filter(n => n > 2).length
  const worst = counts.length > 0 ? Math.max(...counts) : 0
  console.log(`[cleanup-gus] ${overfull} date(s) hold more than 2 events; worst is ${worst}`)

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
