// Web-side wrapper that binds the shared owner-config parser to Vite's
// build-time env var. Two accepted formats — see shared/src/owner-config.ts.
//
// Note on secrecy: this value is baked into the client JS bundle at build
// time. The OAuth gate keeps random visitors out of the app, but anyone
// who loads the page can read these values from the bundle. Treat them as
// public-with-friction, not secret.

import { parseOwnerConfig } from '@home-base/shared/owner-config'

const env = import.meta.env

const PARSED = parseOwnerConfig((env.VITE_ALLOWED_EMAILS as string | undefined) ?? '')

export const OWNER_LABELS = {
  nat:    PARSED.owners.nat.label,
  caitie: PARSED.owners.caitie.label,
} as const

export const OWNER_EMAILS = {
  nat:    PARSED.owners.nat.email,
  caitie: PARSED.owners.caitie.email,
} as const

export const NAT_WORK_EMAIL = PARSED.owners.nat.workEmail
export const CAITIE_WORK_EMAIL = PARSED.owners.caitie.workEmail

export const ALLOWED_EMAILS: readonly string[] = PARSED.allowedEmails
