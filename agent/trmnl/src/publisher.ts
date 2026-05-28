/**
 * POST the merge_variables payload to the TRMNL Private Plugin webhook.
 * TRMNL applies the (server-side) Liquid template to the payload and renders
 * the resulting 1-bit PNG for the device to fetch on its next refresh.
 */

import { writeFileSync } from 'node:fs'
import type { MergeVariables } from './render-payload.ts'

export type PublishOptions = {
  webhookUrl: string
  dryRun: boolean
  dryRunOutPath: string | null
}

export async function publish(
  payload: { merge_variables: MergeVariables },
  options: PublishOptions,
): Promise<{ bytes: number; dryRun: boolean; outPath: string | null }> {
  const body = JSON.stringify(payload)
  const bytes = Buffer.byteLength(body, 'utf8')

  if (options.dryRun) {
    const out = options.dryRunOutPath ?? '/tmp/trmnl-dry-run.json'
    writeFileSync(out, body, 'utf8')
    return { bytes, dryRun: true, outPath: out }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const resp = await fetch(options.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    })
    if (!resp.ok) {
      throw new Error(`TRMNL webhook returned ${resp.status}`)
    }
  } finally {
    clearTimeout(timeout)
  }

  return { bytes, dryRun: false, outPath: null }
}
