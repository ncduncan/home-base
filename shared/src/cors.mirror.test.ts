import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error — plain .mjs helper, no type declarations
import { MIRRORS, renderMirror } from '../../scripts/sync-edge-shared.mjs'

const ROOT = join(import.meta.dirname, '../..')

// Both Edge Functions get their CORS allowlist from a mirror of shared/src/cors.ts.
// If a mirror drifts, the function no longer runs the tested logic.
describe('CORS mirrors are in sync with shared/src/cors.ts', () => {
  const corsMirrors = (MIRRORS as Array<{ source: string; target: string }>)
    .filter(m => m.source === 'shared/src/cors.ts')

  it('mirrors into both functions', () => {
    expect(corsMirrors.map(m => m.target).sort()).toEqual([
      'supabase/functions/asana-ops/cors.ts',
      'supabase/functions/calendar-ops/cors.ts',
    ])
  })

  for (const mirror of corsMirrors) {
    it(`${mirror.target} matches ${mirror.source}`, () => {
      expect(readFileSync(join(ROOT, mirror.target), 'utf8'),
        `${mirror.target} is stale — run: npm run sync:edge-shared`)
        .toBe(renderMirror(ROOT, mirror))
    })
  }
})
