import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'

interface Props {
  unauthorized: boolean
}

export default function LoginPage({ unauthorized }: Props) {
  const handleSignIn = () => {
    // We deliberately do NOT pass `prompt: 'consent'` here. Google forces
    // the consent screen every time when that flag is set, which is
    // unnecessary friction — the edge function already has a stored
    // refresh_token, and the silent-refresh path in WeekDashboard's
    // Reconnect button handles the rare case where it's been revoked
    // (and that path DOES pass prompt=consent to recover).
    //
    // `access_type: 'offline'` still ensures Google issues a refresh_token
    // on the very first authorization for a given scope set.
    void supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + import.meta.env.BASE_URL,
        scopes: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events',
        queryParams: { access_type: 'offline' },
      },
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-hb-page">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Home-Base</h1>
        <p className="text-gray-500 text-sm mb-8">Nat &amp; Caitie's dashboard</p>
        {unauthorized && (
          <p className="text-red-600 text-sm mb-4 bg-red-50 rounded-lg p-3">
            This Google account is not authorized.
          </p>
        )}
        <Button className="w-full" onClick={handleSignIn}>
          Sign in with Google
        </Button>
      </div>
    </div>
  )
}
