// ⚠️  GENERATED FILE — DO NOT EDIT.
//
// Verbatim copy of shared/src/cors.ts. Supabase Edge Functions run on
// Deno and cannot resolve the npm workspace, so this dependency-free module
// is mirrored here to keep both functions on one tested CORS allowlist.
//
// Edit the shared original, then run:  npm run sync:edge-shared
// cors.mirror.test.ts fails if the two drift apart.

// CORS allowlist for the Supabase Edge Functions (calendar-ops, asana-ops).
//
// ZERO IMPORTS — mirrored verbatim into each function directory by
// `npm run sync:edge-shared` (Deno can't resolve the npm workspace).
//
// Production origins come from the ALLOWED_ORIGINS function secret. The default
// is local dev only, so a missing secret fails closed instead of trusting a
// hardcoded host. The caller's Origin is echoed only on an exact match — no
// prefixes, no wildcards — so preview deploys and other sites are refused.

export const DEFAULT_ALLOWED_ORIGINS = 'http://localhost:5173'

export function parseAllowedOrigins(secret: string | undefined): string[] {
  return (secret ?? DEFAULT_ALLOWED_ORIGINS)
    .split(',')
    // Browsers send Origin with no trailing slash, so tolerate one in the secret.
    .map(o => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}
