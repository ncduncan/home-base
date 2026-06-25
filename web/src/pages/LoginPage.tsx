import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'

interface Props {
  unauthorized: boolean
}

export default function LoginPage({ unauthorized }: Props) {
  const [email, setEmail] = useState<string>(() => {
    try { return localStorage.getItem('hb_last_email') ?? '' } catch { return '' }
  })
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    if (signInError) {
      setError(signInError.message)
      setSubmitting(false)
      return
    }
    try { localStorage.setItem('hb_last_email', email.trim().toLowerCase()) } catch { /* private mode */ }
    // App.tsx's onAuthStateChange takes over from here.
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-hb-page">
      <form
        onSubmit={handleSubmit}
        className="bg-hb-card rounded-md border border-hb-border-soft shadow-sm p-10 w-full max-w-sm text-center space-y-4"
      >
        <h1 className="text-2xl font-semibold text-hb-fg mb-6 tracking-tight">Home-Base</h1>

        {unauthorized && (
          <p className="text-[#a14040] text-sm bg-[#fcf0f0] border border-[#f1d8d8] rounded-lg p-3 text-left">
            This account isn't authorized.
          </p>
        )}
        {error && (
          <p className="text-[#a14040] text-sm bg-[#fcf0f0] border border-[#f1d8d8] rounded-lg p-3 text-left">
            {error}
          </p>
        )}

        <div className="space-y-3 text-left">
          <label className="block text-xs font-medium text-hb-fg-secondary">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-hb-border-soft rounded-md bg-white focus:outline-none focus:border-hb-fg-secondary"
            />
          </label>
          <label className="block text-xs font-medium text-hb-fg-secondary">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-hb-border-soft rounded-md bg-white focus:outline-none focus:border-hb-fg-secondary"
            />
          </label>
        </div>

        <Button type="submit" className="w-full" disabled={submitting || !email || !password}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  )
}
