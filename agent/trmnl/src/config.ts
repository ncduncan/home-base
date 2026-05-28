/**
 * Load and validate the TRMNL agent's environment.
 * Fails fast on missing required values so we never half-render a screen.
 */

export type Config = {
  supabaseUrl: string
  supabaseServiceRoleKey: string
  googleTokenJson: string
  asanaPat: string
  asanaWorkspaceGid: string
  webhookUrl: string
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
  const dryRunRaw = process.env.TRMNL_DRY_RUN === 'true'

  // Refuse dry-run in CI — local-only flag, so public Action logs never grow
  // a code path that writes rendered payload contents to disk in CI.
  const dryRun = dryRunRaw && !inActions

  return {
    supabaseUrl: required('VITE_SUPABASE_URL'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    googleTokenJson: required('GOOGLE_OAUTH_TOKEN'),
    asanaPat: required('ASANA_PAT'),
    asanaWorkspaceGid: required('ASANA_WORKSPACE_GID'),
    webhookUrl: required('TRMNL_WEBHOOK_URL'),
    dryRun,
    dryRunOutPath: process.env.TRMNL_DRY_RUN_OUT ?? null,
  }
}
