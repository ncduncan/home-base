#!/usr/bin/env node
// Regenerate the Deno-side copies of shared/ modules used by Supabase Edge
// Functions.
//
// Edge Functions run on Deno and can't resolve the npm workspace, so a small
// number of dependency-free shared modules are mirrored into the function
// directory. This script is the only sanctioned way to update a mirror; the
// matching *.mirror.test.ts fails if a mirror drifts from its source.
//
//   npm run sync:edge-shared

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const MIRRORS = [
  {
    source: 'shared/src/calendar/gus-sync.ts',
    target: 'supabase/functions/calendar-ops/gus-sync.ts',
    purpose: 'keep the web path and the Sunday agent on identical\n// reconciliation logic.',
    test: 'gus-sync.mirror.test.ts',
  },
  {
    source: 'shared/src/cors.ts',
    target: 'supabase/functions/calendar-ops/cors.ts',
    purpose: 'keep both functions on one tested CORS allowlist.',
    test: 'cors.mirror.test.ts',
  },
  {
    source: 'shared/src/cors.ts',
    target: 'supabase/functions/asana-ops/cors.ts',
    purpose: 'keep both functions on one tested CORS allowlist.',
    test: 'cors.mirror.test.ts',
  },
]

export function headerFor({ source, purpose, test }) {
  return [
    '// ⚠️  GENERATED FILE — DO NOT EDIT.',
    '//',
    `// Verbatim copy of ${source}. Supabase Edge Functions run on`,
    '// Deno and cannot resolve the npm workspace, so this dependency-free module',
    `// is mirrored here to ${purpose}`,
    '//',
    '// Edit the shared original, then run:  npm run sync:edge-shared',
    `// ${test} fails if the two drift apart.`,
    '',
    '',
  ].join('\n')
}

export function renderMirror(root, mirror) {
  return headerFor(mirror) + readFileSync(join(root, mirror.source), 'utf8')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const mirror of MIRRORS) {
    writeFileSync(join(root, mirror.target), renderMirror(root, mirror))
    console.log(`synced ${mirror.source} → ${mirror.target}`)
  }
}
