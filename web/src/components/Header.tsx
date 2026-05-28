import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'
import type { Session } from '@supabase/supabase-js'

export type AppTab = 'home' | 'goals'

interface Props {
  session: Session
  tab?: AppTab
  onTabChange?: (tab: AppTab) => void
}

const TABS: { key: AppTab; label: string }[] = [
  { key: 'home',  label: 'Home' },
  { key: 'goals', label: 'Goals' },
]

export default function Header({ session, tab, onTabChange }: Props) {
  const { user } = session
  const avatarUrl = user.user_metadata.avatar_url as string | undefined
  const displayName = (user.user_metadata.full_name as string | undefined) ?? user.email

  return (
    <header className="h-14 border-b border-hb-border-soft bg-hb-card flex items-center px-6 justify-between">
      <div className="flex items-center gap-5">
        <span className="font-semibold text-hb-fg text-sm tracking-tight">Home-Base</span>
        {tab && onTabChange && (
          <nav className="flex items-center gap-1">
            {TABS.map(t => {
              const active = t.key === tab
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => onTabChange(t.key)}
                  className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                    active
                      ? 'bg-hb-fam-fade text-hb-fam-accent'
                      : 'text-hb-fg-muted hover:text-hb-fg'
                  }`}
                >
                  {t.label}
                </button>
              )
            })}
          </nav>
        )}
      </div>
      <div className="flex items-center gap-3">
        {avatarUrl && (
          <img
            src={avatarUrl}
            alt="avatar"
            className="w-7 h-7 rounded-full"
            referrerPolicy="no-referrer"
          />
        )}
        <span className="text-sm text-hb-fg-secondary hidden sm:block">{displayName}</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-hb-fg-muted text-xs"
          onClick={() => void supabase.auth.signOut()}
        >
          Sign out
        </Button>
      </div>
    </header>
  )
}
