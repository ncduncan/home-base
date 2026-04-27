/**
 * Load and validate the agent's environment.
 * Fails fast on missing required values so we never half-run a briefing.
 */

export type Config = {
  supabaseUrl: string
  supabaseServiceRoleKey: string
  googleTokenJson: string
  anthropicApiKey: string
  asanaPat: string
  asanaWorkspaceGid: string
  recipients: string[]
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

  const recipientsRaw = required('ALLOWED_EMAILS')
  const recipients = recipientsRaw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (recipients.length === 0) throw new Error('ALLOWED_EMAILS is empty')

  return {
    supabaseUrl: required('VITE_SUPABASE_URL'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    googleTokenJson: required('GOOGLE_OAUTH_TOKEN'),
    anthropicApiKey: required('ANTHROPIC_API_KEY'),
    asanaPat: required('ASANA_PAT'),
    asanaWorkspaceGid: required('ASANA_WORKSPACE_GID'),
    recipients,
    dryRun,
    dryRunOutPath: process.env.BRIEFING_DRY_RUN_OUT ?? null,
  }
}
