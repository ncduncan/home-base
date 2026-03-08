import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'
import type { Session } from '@supabase/supabase-js'

interface Props {
  session: Session
}

export default function Header({ session }: Props) {
  const { user } = session
  const avatarUrl = user.user_metadata.avatar_url as string | undefined
  const displayName = (user.user_metadata.full_name as string | undefined) ?? user.email

  return (
    <header className="h-14 border-b border-gray-100 bg-white flex items-center px-6 justify-between">
      <span className="font-semibold text-gray-900 text-sm tracking-tight">Home-Base</span>
      <div className="flex items-center gap-3">
        {avatarUrl && (
          <img
            src={avatarUrl}
            alt="avatar"
            className="w-7 h-7 rounded-full"
            referrerPolicy="no-referrer"
          />
        )}
        <span className="text-sm text-gray-600 hidden sm:block">{displayName}</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-gray-500 text-xs"
          onClick={() => void supabase.auth.signOut()}
        >
          Sign out
        </Button>
      </div>
    </header>
  )
}
