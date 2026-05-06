/**
 * Load and validate the agent's environment.
 * Fails fast on missing required values so we never half-run a briefing.
 */

import { parseOwnerConfig } from '@home-base/shared/owner-config'

export type Config = {
  supabaseUrl: string
  supabaseServiceRoleKey: string
  googleTokenJson: string
  anthropicApiKey: string
  asanaPat: string
  asanaWorkspaceGid: string
  recipients: string[]
  natAttendeeEmail: string
  caitieAttendeeEmail: string
  dryRun: boolean
  dryRunOutPath: string | null
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

export function loadConfig(): Config {
  const inActions = process.env.GITHUB_ACTIONS === 'true'
  const dryRunRaw = process.env.BRIEFING_DRY_RUN === 'true'

  // Refuse dry-run in CI — local-only flag, otherwise public Action logs would
  // leak rendered email content if accidentally enabled.
  const dryRun = dryRunRaw && !inActions

  const allowedRaw = required('ALLOWED_EMAILS')
  const parsed = parseOwnerConfig(allowedRaw)
  const recipients = parsed.allowedEmails
  if (recipients.length === 0) throw new Error('ALLOWED_EMAILS is empty')

  const natAttendeeEmail = parsed.owners.nat.workEmail
  const caitieAttendeeEmail = parsed.owners.caitie.workEmail
  if (!natAttendeeEmail) throw new Error('ALLOWED_EMAILS missing Nat work email (4th colon-field on `nat:` row)')
  if (!caitieAttendeeEmail) throw new Error('ALLOWED_EMAILS missing Caitie work email (4th colon-field on `caitie:` row)')

  return {
    supabaseUrl: required('VITE_SUPABASE_URL'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    googleTokenJson: required('GOOGLE_OAUTH_TOKEN'),
    anthropicApiKey: required('ANTHROPIC_API_KEY'),
    asanaPat: required('ASANA_PAT'),
    asanaWorkspaceGid: required('ASANA_WORKSPACE_GID'),
    recipients,
    natAttendeeEmail,
    caitieAttendeeEmail,
    dryRun,
    dryRunOutPath: process.env.BRIEFING_DRY_RUN_OUT ?? null,
  }
}
