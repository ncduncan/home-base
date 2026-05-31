import { lazy, Suspense, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
const GoalsPage = lazy(() => import('./pages/GoalsPage'))
import { ALLOWED_EMAILS } from './lib/owners'
import type { Session } from '@supabase/supabase-js'
import type { AppTab } from './components/Header'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [unauthorized, setUnauthorized] = useState(false)
  const [tab, setTab] = useState<AppTab>('home')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (newSession && !ALLOWED_EMAILS.includes((newSession.user.email ?? '').toLowerCase())) {
        void supabase.auth.signOut()
        setUnauthorized(true)
        setSession(null)
        return
      }
      setUnauthorized(false)
      setSession(newSession)

      // Store Google refresh token so the edge function can mint new access tokens.
      // Also persist on TOKEN_REFRESHED in case Supabase rotates the provider
      // refresh token during a silent refresh — losing it would force a re-auth.
      if (
        (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') &&
        newSession?.provider_refresh_token
      ) {
        void supabase.from('google_tokens').upsert(
          {
            user_id: newSession.user.id,
            refresh_token: newSession.provider_refresh_token,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )
      }

      // Remember the signed-in email so LoginPage can pass it as login_hint
      // and Google can skip the account picker on the rare re-auth.
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && newSession?.user.email) {
        try { localStorage.setItem('hb_last_email', newSession.user.email) } catch { /* private mode */ }
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-hb-page">
        <div className="text-hb-fg-faint text-sm">Loading...</div>
      </div>
    )
  }

  if (session) {
    if (tab === 'home') {
      return <DashboardPage session={session} tab={tab} onTabChange={setTab} />
    }
    return (
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-hb-page">
          <div className="text-hb-fg-faint text-sm">Loading...</div>
        </div>
      }>
        <GoalsPage session={session} tab={tab} onTabChange={setTab} />
      </Suspense>
    )
  }
  return <LoginPage unauthorized={unauthorized} />
}
