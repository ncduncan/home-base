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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession && !ALLOWED_EMAILS.includes((newSession.user.email ?? '').toLowerCase())) {
        void supabase.auth.signOut()
        setUnauthorized(true)
        setSession(null)
        return
      }
      setUnauthorized(false)
      setSession(newSession)
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
