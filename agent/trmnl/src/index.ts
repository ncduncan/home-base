/**
 * TRMNL e-ink display updater (single-day view).
 *
 * Pipeline:
 *   1. Load + validate config
 *   2. Build Google OAuth token getter
 *   3. Fetch calendar / supabase / asana + weather in parallel
 *   4. Build merge_variables for today
 *   5. Cap + render the payload (byte-budget enforced)
 *   6. POST to TRMNL_WEBHOOK_URL (or dry-run to file)
 *
 * Public-repo logging policy: counts and step transitions only — never event
 * titles, task content, or rendered payload bodies.
 */

import { loadConfig } from './config.ts'
import { createGoogleTokenGetter } from './google-token.ts'
import { computeDayWindow } from './day-window.ts'
import { createSupabaseClient, fetchAllData } from './data-fetch.ts'
import { fetchTodayWeather } from './weather.ts'
import { buildDayPayload } from './build-day.ts'
import { renderPayload } from './render-payload.ts'
import { publish } from './publisher.ts'

async function main(): Promise<void> {
  const t0 = Date.now()
  log('trmnl start')

  const config = loadConfig()
  log(`config loaded — dry-run: ${config.dryRun}`)

  const getAccessToken = createGoogleTokenGetter({ tokenJson: config.googleTokenJson })
  await getAccessToken()
  log('google token: ok')

  const window = computeDayWindow()
  log(`day window: ${window.today} (fetch ${window.fetchStart} → ${window.fetchEnd})`)

  const supabase = createSupabaseClient(config)
  const [data, weather] = await Promise.all([
    fetchAllData(supabase, { config, getGoogleAccessToken: getAccessToken, window }),
    fetchTodayWeather(window.today),
  ])
  log(`fetched: events=${data.events.length}, gus=${data.gusCare.length}, asana=${data.asanaTasks.length}, weather=${weather ? 'ok' : 'none'}`)

  const day = buildDayPayload({
    now: new Date(),
    today: window.today,
    events: data.events,
    gusCare: data.gusCare,
    asanaTasks: data.asanaTasks,
    weather,
  })
  log(`day built: banners=${day.banners.length}, caitie_items=${day.caitie.items.length}, caitie_tasks=${day.caitie.tasks.length}, nat_items=${day.nat.items.length}, nat_tasks=${day.nat.tasks.length}`)

  const payload = renderPayload(day)

  const result = await publish(payload, {
    webhookUrl: config.webhookUrl,
    dryRun: config.dryRun,
    dryRunOutPath: config.dryRunOutPath,
  })

  if (result.dryRun) {
    log(`dry-run: wrote ${result.bytes} bytes to ${result.outPath}`)
  } else {
    log(`published: ${result.bytes} bytes`)
  }
  log(`done (${Date.now() - t0}ms)`)
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

main().catch(err => {
  const e = err as Error
  console.error(`[${new Date().toISOString()}] FATAL: ${e.name}: ${e.message.split('\n')[0]}`)
  process.exit(1)
})
