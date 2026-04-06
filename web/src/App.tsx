import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import type { Session } from '@supabase/supabase-js'

const ALLOWED_EMAILS = (import.meta.env.VITE_ALLOWED_EMAILS as string ?? '')
  .split(',').map((e: string) => e.trim()).filter(Boolean)

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [unauthorized, setUnauthorized] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (newSession && !ALLOWED_EMAILS.includes(newSession.user.email ?? '')) {
        void supabase.auth.signOut()
        setUnauthorized(true)
        setSession(null)
        return
      }
      setUnauthorized(false)
      setSession(newSession)

      // Store Google refresh token so the edge function can mint new access tokens
      if (event === 'SIGNED_IN' && newSession?.provider_refresh_token) {
        void supabase.from('google_tokens').upsert(
          {
            user_id: newSession.user.id,
            refresh_token: newSession.provider_refresh_token,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    )
  }

  if (session) return <DashboardPage session={session} />
  return <LoginPage unauthorized={unauthorized} />
}
