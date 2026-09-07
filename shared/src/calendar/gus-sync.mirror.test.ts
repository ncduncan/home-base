import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error — plain .mjs helper, no type declarations
import { MIRRORS, renderMirror } from '../../../scripts/sync-edge-shared.mjs'

const ROOT = join(import.meta.dirname, '../../..')

// The Supabase Edge Function can't import from the npm workspace, so the Gus
// planner is mirrored into supabase/functions/. That mirror is exactly how the
// web dashboard and the Sunday agent ended up running different reconciliation
// logic before — this test is what stops it happening again.
describe('edge-function mirrors are in sync with their shared sources', () => {
  for (const mirror of MIRRORS as Array<{ source: string; target: string }>) {
    it(`${mirror.target} matches ${mirror.source}`, () => {
      const onDisk = readFileSync(join(ROOT, mirror.target), 'utf8')
      expect(onDisk, `${mirror.target} is stale — run: npm run sync:edge-shared`)
        .toBe(renderMirror(ROOT, mirror))
    })
  }
})
