/**
 * Refresh a Google OAuth access token using the long-lived refresh_token
 * stored as the GOOGLE_OAUTH_TOKEN GitHub secret.
 *
 * The secret holds the raw JSON contents of token.json (as produced by
 * scripts/generate_token.py). It contains client_id, client_secret, and
 * refresh_token — sufficient to mint a fresh access token on demand.
 */

type TokenJson = {
  refresh_token: string
  client_id: string
  client_secret: string
  token_uri?: string
  // The remaining fields (token, scopes, expiry) are ignored — we always refresh.
}

export type GoogleTokenSource = {
  /** Raw JSON contents of token.json (string). */
  tokenJson: string
}

export function createGoogleTokenGetter(source: GoogleTokenSource): () => Promise<string> {
  const parsed: TokenJson = JSON.parse(source.tokenJson)
  if (!parsed.refresh_token || !parsed.client_id || !parsed.client_secret) {
    throw new Error('GOOGLE_OAUTH_TOKEN missing required fields (refresh_token, client_id, client_secret)')
  }

  let cached: { token: string; expiresAt: number } | null = null

  return async function getAccessToken(): Promise<string> {
    if (cached && Date.now() < cached.expiresAt - 5 * 60_000) {
      return cached.token
    }

    const tokenUri = parsed.token_uri ?? 'https://oauth2.googleapis.com/token'
    const params = new URLSearchParams({
      client_id: parsed.client_id,
      client_secret: parsed.client_secret,
      refresh_token: parsed.refresh_token,
      grant_type: 'refresh_token',
    })

    const resp = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

    if (!resp.ok) {
      throw new Error(`Google token refresh failed: ${resp.status}`)
    }

    const json = await resp.json() as { access_token: string; expires_in: number }
    cached = {
      token: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    }
    return json.access_token
  }
}
