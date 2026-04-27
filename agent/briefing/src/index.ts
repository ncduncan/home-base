/**
 * Sunday-morning weekly briefing agent.
 *
 * Pipeline (single linear flow):
 *   1. Load + validate config
 *   2. Build Google OAuth token getter
 *   3. Fetch calendar / supabase / asana data in parallel
 *   4. Reconcile Gus calendar invites (idempotent — same as the dashboard)
 *   5. Build BriefingData (week grid, gus, todos, conflicts)
 *   6. Gemini narrative pass (intro + action items)
 *   7. Render HTML
 *   8. Send via Gmail (or dry-run to file)
 *
 * Public-repo logging policy: timestamps + counts only, never content.
 */

import { writeFileSync } from 'node:fs'
import { syncGusCareInvites } from '@home-base/shared/calendar/io'
import { loadConfig } from './config.ts'
import { createGoogleTokenGetter } from './google-token.ts'
import { computeWeekWindow } from './week-window.ts'
import { createSupabaseClient, fetchAllData } from './data-fetch.ts'
import { buildBriefingData } from './briefing-data.ts'
import { generateNarrative } from './narrative.ts'
import { renderEmailHtml } from './email-template.ts'
import { sendEmail, htmlToPlainText } from './gmail-send.ts'

async function main(): Promise<void> {
  const t0 = Date.now()
  log('briefing start')

  const config = loadConfig()
  log(`config loaded — recipients: ${config.recipients.length}, dry-run: ${config.dryRun}`)

  const getAccessToken = createGoogleTokenGetter({ tokenJson: config.googleTokenJson })
  // Warm the token cache up front so a token failure surfaces before any work
  await getAccessToken()
  log('google token: ok')

  const week = computeWeekWindow()
  log(`week window: ${week.startDate} → ${week.endDate}`)

  const supabase = createSupabaseClient(config)
  const data = await fetchAllData(supabase, { config, getGoogleAccessToken: getAccessToken, week })
  log(`fetched: events=${data.events.length}, homebase=${data.homebaseEvents.length}, gus=${data.gusCare.length}, asana=${data.asanaTasks.length}`)

  // Reconcile Gus calendar invites (skip in dry-run so we never accidentally
  // mutate the calendar from a local test run).
  if (!config.dryRun) {
    await syncGusCareInvites(getAccessToken, data.gusCare, {
      attendeeEmail: 'nathaniel.duncan@geaerospace.com',
    })
    log('gus calendar sync: ok')
  } else {
    log('gus calendar sync: skipped (dry-run)')
  }

  const briefing = buildBriefingData(week, data.events, data.gusCare, data.asanaTasks)
  log(`briefing data: days=${briefing.days.length}, todos=${briefing.todos.length}, conflicts=${briefing.conflicts.length}`)

  const narrative = await generateNarrative(config.geminiApiKey, briefing)
  log(`narrative: action-items=${narrative.actionItems.length}`)

  const html = renderEmailHtml(briefing, narrative)
  const subject = `Weekly Briefing — ${formatSubjectDate(week.startDate)}`

  if (config.dryRun) {
    const outPath = config.dryRunOutPath ?? '/tmp/briefing-dry-run.html'
    writeFileSync(outPath, html, 'utf-8')
    log(`dry-run: wrote ${html.length} bytes to ${outPath}`)
    log(`done (${Date.now() - t0}ms)`)
    return
  }

  await sendEmail({
    accessToken: await getAccessToken(),
    to: config.recipients,
    subject,
    html,
    text: htmlToPlainText(html),
  })
  log(`email sent: recipients=${config.recipients.length}`)
  log(`done (${Date.now() - t0}ms)`)
}

function log(msg: string): void {
  // Timestamps + counts only; the message is the only thing under our control.
  // Callers must never include event titles, todo content, or rendered HTML.
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

function formatSubjectDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

main().catch(err => {
  // Log the error TYPE/STATUS only — never the full message which may include
  // request bodies / response payloads in error chains.
  const e = err as Error
  console.error(`[${new Date().toISOString()}] FATAL: ${e.name}: ${e.message.split('\n')[0]}`)
  process.exit(1)
})
