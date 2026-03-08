import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import type { Session } from '@supabase/supabase-js'

const ALLOWED_EMAILS = ['ncduncan@gmail.com', 'caitante@gmail.com']

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [unauthorized, setUnauthorized] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession && !ALLOWED_EMAILS.includes(newSession.user.email ?? '')) {
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    )
  }

  if (session) return <DashboardPage session={session} />
  return <LoginPage unauthorized={unauthorized} />
}
