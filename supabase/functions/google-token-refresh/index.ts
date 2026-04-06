import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!
const ALLOWED_EMAILS = (Deno.env.get('ALLOWED_EMAILS') ?? '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    })
  }

  // Authenticate the caller via their Supabase JWT
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return Response.json({ error: 'Missing authorization header' }, { status: 401 })
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  )
  if (authError || !user) {
    return Response.json({ error: 'Invalid token' }, { status: 401 })
  }

  // Server-side email allowlist — defence in depth in case the client check
  // is bypassed or the auth.users insert trigger isn't installed.
  const callerEmail = (user.email ?? '').toLowerCase()
  if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(callerEmail)) {
    return Response.json({ error: 'Not authorized' }, { status: 403 })
  }

  // Look up the stored Google refresh token
  const { data: tokenRow, error: dbError } = await supabase
    .from('google_tokens')
    .select('refresh_token')
    .eq('user_id', user.id)
    .single()

  if (dbError || !tokenRow) {
    return Response.json(
      { error: 'No refresh token stored — please sign out and sign back in' },
      { status: 404 }
    )
  }

  // Exchange refresh token for a new access token
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: tokenRow.refresh_token,
    }),
  })

  if (!resp.ok) {
    const body = await resp.text()
    console.error('Google token refresh failed:', resp.status, body)
    return Response.json(
      { error: 'Google token refresh failed — please sign out and sign back in' },
      { status: 502 }
    )
  }

  const { access_token, expires_in } = await resp.json() as {
    access_token: string
    expires_in: number
  }

  return Response.json(
    { access_token, expires_in },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    }
  )
})
