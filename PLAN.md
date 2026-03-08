# Home-Base Web App — Implementation Plan

> **Last updated:** 2026-03-08
> **Status:** Approved, ready for implementation
> **Branch:** claude/home-base-briefing-agent-NDftN

---

## What We're Building

A shared household web dashboard for Nat (ncduncan@gmail.com) and Caitie (caitante@gmail.com) replacing the Sunday-morning Python briefing agent. Features:

1. **Google OAuth login** — restricted to the two emails above
2. **Calendar view** — upcoming 7 days from each user's own Google Calendar (shared family calendars surface automatically since both accounts have access)
3. **Todo list** — shared todos (both see) and private todos (only creator sees), replacing Asana
4. **Deprecated (not deleted):** Gemini AI briefing, GitHub Actions cron schedule, Asana integration

---

## Architecture

```
GitHub Pages (static SPA)
    ↕ Supabase Auth (Google OAuth callback)
    ↕ Supabase Postgres (todos + RLS)
    ↕ Google Calendar REST API (direct from browser via provider_token)
```

**No Vercel. No server code. $0.**

- **GitHub Pages** hosts the static React/Vite build (deployed via GitHub Actions on push to `main`)
- **Supabase** (free tier) handles:
  - Google OAuth callback at `https://[project].supabase.co/auth/v1/callback`
  - Postgres database for todos with Row Level Security
  - Returns `session.provider_token` (Google access token with `calendar.readonly`) after login
- **Google Calendar API** is called directly from the browser using `provider_token` — Google REST APIs support CORS for authenticated requests

---

## Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | React 19 + Vite | Pure client-side SPA, no SSR needed |
| Auth | Supabase Auth + Google OAuth | Supabase hosts OAuth callback |
| Database | Supabase Postgres + RLS | Todos with shared/private visibility |
| UI | Tailwind CSS + shadcn/ui | |
| Calendar API | Google Calendar REST (direct browser) | Via `session.provider_token` |
| Hosting | GitHub Pages | Built via GitHub Actions |
| CI/CD | GitHub Actions | On push to `main`, builds `web/` → deploys to `gh-pages` branch |

---

## Directory Structure

```
home-base/
├── agent/                              ← UNCHANGED. Stays dormant. Do not delete.
├── .github/
│   └── workflows/
│       ├── weekly_briefing.yml         ← MODIFY: remove schedule: block, keep workflow_dispatch
│       └── deploy.yml                  ← CREATE: build + deploy to GitHub Pages
├── PLAN.md                             ← THIS FILE
├── CLAUDE.md                           ← UPDATE: add web/ architecture section
└── web/                                ← CREATE: entire React + Vite SPA
    ├── src/
    │   ├── main.tsx                    ← Entry point
    │   ├── App.tsx                     ← Session routing (login ↔ dashboard)
    │   ├── lib/
    │   │   ├── supabase.ts             ← Supabase singleton client
    │   │   └── calendar.ts             ← Google Calendar API (fetchCalendarEvents)
    │   ├── components/
    │   │   ├── Header.tsx              ← User avatar + sign-out button
    │   │   ├── CalendarView.tsx        ← Fetches + renders week events
    │   │   └── TodoList.tsx            ← Full CRUD: shared + private todos
    │   ├── pages/
    │   │   ├── LoginPage.tsx           ← "Sign in with Google" button
    │   │   └── DashboardPage.tsx       ← Header + 2-column grid
    │   └── types/
    │       └── index.ts                ← CalendarEvent, Todo TypeScript interfaces
    ├── public/
    │   └── 404.html                    ← GitHub Pages SPA redirect hack
    ├── index.html
    ├── vite.config.ts                  ← base: '/home-base/' for GitHub Pages
    ├── tailwind.config.ts
    ├── tsconfig.json
    ├── package.json
    └── .env.example                    ← Committed template (no secrets)
```

---

## Prerequisites (Manual Steps — Do Once Before Coding)

### 1. Supabase Project

1. Create free project at [supabase.com](https://supabase.com)
2. **Authentication → Providers → Google**: enable, paste Google client ID + secret, add extra scope:
   ```
   https://www.googleapis.com/auth/calendar.readonly
   ```
3. **Run this SQL** in Supabase SQL Editor:

```sql
CREATE TABLE todos (
  id         UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  title      TEXT    NOT NULL,
  notes      TEXT,
  due_date   DATE,
  completed  BOOLEAN DEFAULT false,
  visibility TEXT    NOT NULL DEFAULT 'shared', -- 'shared' | 'private'
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT    NOT NULL
);

CREATE INDEX todos_created_at_idx ON todos(created_at DESC);
CREATE INDEX todos_visibility_idx ON todos(visibility, created_by);

ALTER TABLE todos ENABLE ROW LEVEL SECURITY;

-- Only authorized users can access any row
CREATE POLICY "authorized users only" ON todos
  FOR ALL USING (
    auth.jwt()->>'email' IN ('ncduncan@gmail.com', 'caitante@gmail.com')
  );

-- Shared todos visible to all; private only to creator
CREATE POLICY "visibility filter" ON todos
  FOR SELECT USING (
    visibility = 'shared' OR created_by = auth.jwt()->>'email'
  );

-- created_by must match the session user
CREATE POLICY "insert own todos" ON todos
  FOR INSERT WITH CHECK (created_by = auth.jwt()->>'email');

-- Only creator can delete
CREATE POLICY "delete own todos" ON todos
  FOR DELETE USING (created_by = auth.jwt()->>'email');
```

4. From **Project Settings → API**, collect:
   - `VITE_SUPABASE_URL` (the project URL)
   - `VITE_SUPABASE_ANON_KEY` (the anon/public key — safe for browser)

### 2. Google Cloud Console

1. Enable **Google Calendar API** (if not already enabled in the existing project)
2. Create a new **OAuth 2.0 Client ID** → Application type: "Web application"
3. **Authorized redirect URIs:**
   - `https://[your-supabase-project].supabase.co/auth/v1/callback`
   - `http://localhost:5173` (Vite dev server)
4. **Authorized JavaScript origins:**
   - `http://localhost:5173`
   - `https://[yourgithubusername].github.io`
5. Paste Client ID + Secret into **Supabase Auth → Google provider**

> Note: The Google credentials live ONLY in Supabase's dashboard. They never appear in `.env` files or code.

### 3. GitHub Pages

- Repo Settings → Pages → Source: "Deploy from a branch" → `gh-pages` branch, `/` folder
- Note the Pages URL: `https://[username].github.io/home-base`
  - Update `vite.config.ts` `base` field to match (e.g., `'/home-base/'`)

### 4. GitHub Actions Secrets

Add these two secrets in repo Settings → Secrets → Actions:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

## Implementation Steps

### Step 1: Scaffold Vite + React App

```bash
# From repo root
npm create vite@latest web -- --template react-ts
cd web
npm install @supabase/supabase-js date-fns
npm install -D tailwindcss postcss autoprefixer @types/node
npx tailwindcss init -p
npx shadcn@latest init
npx shadcn@latest add button card checkbox input textarea badge
```

Create `web/.env.local` (gitignored):
```
VITE_SUPABASE_URL=https://[project].supabase.co
VITE_SUPABASE_ANON_KEY=[anon key]
```

Create `web/.env.example` (committed):
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

---

### Step 2: Types (`web/src/types/index.ts`)

```typescript
export interface Todo {
  id: string
  title: string
  notes: string | null
  due_date: string | null      // 'YYYY-MM-DD'
  completed: boolean
  visibility: 'shared' | 'private'
  created_at: string           // ISO timestamp
  created_by: string           // email
}

export interface CalendarEvent {
  id: string
  title: string
  start: string                // ISO datetime (all-day: date + T00:00:00)
  end: string
  location: string | null
  all_day: boolean
  calendar_name: string
  is_amion: boolean
}
```

---

### Step 3: Supabase Client (`web/src/lib/supabase.ts`)

```typescript
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

---

### Step 4: Google Calendar (`web/src/lib/calendar.ts`)

Key points:
- `AMION_CALENDAR_NAME = 'Caitie Work'` — matches existing Python agent logic
- Skip events titled "Vacation" or "Leave" from AMION calendar
- Skip all-day recurring events from AMION calendar
- `provider_token` from Supabase session is the Google OAuth access token
- If `provider_token` is missing/expired, call `supabase.auth.refreshSession()` then retry
- Fetch all calendars first, then fetch events from each in parallel (`Promise.all`)
- Return events sorted by start time, covering today → today+7 days

```typescript
import { supabase } from './supabase'
import type { CalendarEvent } from '../types'

const AMION_CALENDAR_NAME = 'Caitie Work'
const SKIP_TITLES = new Set(['Vacation', 'Leave'])

async function getProviderToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  let token = data.session?.provider_token
  if (!token) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    token = refreshed.session?.provider_token
  }
  if (!token) throw new Error('No Google access token — please sign in again')
  return token
}

export async function fetchCalendarEvents(): Promise<CalendarEvent[]> {
  const token = await getProviderToken()
  const now = new Date()
  const weekEnd = new Date(now)
  weekEnd.setDate(weekEnd.getDate() + 7)

  const listResp = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList',
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!listResp.ok) throw new Error('Failed to fetch calendar list')
  const { items: calendars = [] } = await listResp.json()

  const results = await Promise.all(
    calendars
      .filter((cal: any) => cal.selected !== false)
      .map(async (cal: any) => {
        const params = new URLSearchParams({
          timeMin: now.toISOString(),
          timeMax: weekEnd.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
        })
        const resp = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!resp.ok) return []
        const { items = [] } = await resp.json()

        const isAmion = cal.summary === AMION_CALENDAR_NAME
        return items
          .filter((e: any) => {
            if (e.status === 'cancelled') return false
            if (!isAmion) return true
            if (SKIP_TITLES.has(e.summary)) return false
            const allDay = 'date' in (e.start ?? {})
            if (allDay && e.recurringEventId) return false
            return true
          })
          .map((e: any) => {
            const allDay = 'date' in (e.start ?? {})
            return {
              id: e.id,
              title: e.summary ?? '(No title)',
              start: allDay ? `${e.start.date}T00:00:00` : e.start.dateTime,
              end: allDay ? `${e.end.date}T00:00:00` : e.end.dateTime,
              location: e.location ?? null,
              all_day: allDay,
              calendar_name: cal.summary,
              is_amion: isAmion,
            } as CalendarEvent
          })
      })
  )

  return results.flat().sort((a, b) => a.start.localeCompare(b.start))
}
```

---

### Step 5: App Root (`web/src/App.tsx`)

```typescript
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !ALLOWED_EMAILS.includes(session.user.email ?? '')) {
        supabase.auth.signOut()
        setUnauthorized(true)
        setSession(null)
        return
      }
      setUnauthorized(false)
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return null  // loading

  if (session) return <DashboardPage session={session} />
  return <LoginPage unauthorized={unauthorized} />
}
```

---

### Step 6: Login Page (`web/src/pages/LoginPage.tsx`)

```typescript
import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'

export default function LoginPage({ unauthorized }: { unauthorized: boolean }) {
  const handleSignIn = () => {
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Home-Base</h1>
        <p className="text-gray-500 text-sm mb-8">Nat & Caitie's dashboard</p>
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
```

---

### Step 7: Header (`web/src/components/Header.tsx`)

```typescript
import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'
import type { Session } from '@supabase/supabase-js'

export default function Header({ session }: { session: Session }) {
  return (
    <header className="h-14 border-b border-gray-100 bg-white flex items-center px-6 justify-between">
      <span className="font-semibold text-gray-900 text-sm tracking-tight">Home-Base</span>
      <div className="flex items-center gap-3">
        {session.user.user_metadata.avatar_url && (
          <img
            src={session.user.user_metadata.avatar_url}
            alt="avatar"
            className="w-7 h-7 rounded-full"
          />
        )}
        <span className="text-sm text-gray-600 hidden sm:block">
          {session.user.user_metadata.full_name ?? session.user.email}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="text-gray-500 text-xs"
          onClick={() => supabase.auth.signOut()}
        >
          Sign out
        </Button>
      </div>
    </header>
  )
}
```

---

### Step 8: Calendar View (`web/src/components/CalendarView.tsx`)

```typescript
import { useEffect, useState } from 'react'
import { format, parseISO, isSameDay } from 'date-fns'
import { fetchCalendarEvents } from '../lib/calendar'
import { Badge } from '@/components/ui/badge'
import type { CalendarEvent } from '../types'

export default function CalendarView() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCalendarEvents()
      .then(setEvents)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-4 text-gray-400 text-sm">Loading calendar...</div>
  if (error) return <div className="p-4 text-red-500 text-sm">{error}</div>
  if (!events.length) return <div className="p-4 text-gray-400 text-sm">Nothing on the calendar this week.</div>

  // Group by day
  const days: { date: Date; events: CalendarEvent[] }[] = []
  for (const event of events) {
    const d = parseISO(event.start)
    const existing = days.find(g => isSameDay(g.date, d))
    if (existing) existing.events.push(event)
    else days.push({ date: d, events: [event] })
  }

  return (
    <div>
      {days.map(({ date, events: dayEvents }) => (
        <div key={date.toISOString()} className="border-b border-gray-50 last:border-0">
          <div className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {format(date, 'EEEE, MMM d')}
          </div>
          <ul>
            {dayEvents.map(event => (
              <li key={event.id} className="flex gap-3 px-4 py-2.5 items-start">
                <div className="w-16 shrink-0 text-xs text-gray-400 pt-0.5">
                  {event.all_day ? 'all day' : format(parseISO(event.start), 'h:mm a')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-gray-900">{event.title}</span>
                    {event.is_amion && (
                      <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 border-0">
                        AMION
                      </Badge>
                    )}
                  </div>
                  {event.location && (
                    <div className="text-xs text-gray-400 mt-0.5 truncate">{event.location}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
```

---

### Step 9: Todo List (`web/src/components/TodoList.tsx`)

Key behaviors:
- Fetch all visible todos on mount (RLS handles private/shared filter server-side)
- `visibility` toggle in add form: "Shared" (default) vs "Just me"
- Shared todos show `👥` icon; private todos show `🔒` icon
- Overdue: `due_date < today` and `completed = false` → red date
- Optimistic toggle for `completed`
- Delete only enabled if `todo.created_by === session.user.email`
- Incomplete todos first; completed in `<details>` toggle

Supabase calls (all direct from browser, RLS enforces access):
```typescript
// Fetch (RLS filters automatically)
const { data } = await supabase.from('todos').select('*')
  .order('completed', { ascending: true })
  .order('due_date', { ascending: true, nullsFirst: false })
  .order('created_at', { ascending: false })

// Create
await supabase.from('todos').insert({ title, notes, due_date, visibility, created_by: email })

// Toggle
await supabase.from('todos').update({ completed }).eq('id', id)

// Delete
await supabase.from('todos').delete().eq('id', id)
```

---

### Step 10: Dashboard Page (`web/src/pages/DashboardPage.tsx`)

```typescript
import Header from '../components/Header'
import CalendarView from '../components/CalendarView'
import TodoList from '../components/TodoList'
import type { Session } from '@supabase/supabase-js'

export default function DashboardPage({ session }: { session: Session }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header session={session} />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">This Week</h2>
            </div>
            <CalendarView />
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">To Do</h2>
            </div>
            <TodoList session={session} />
          </div>
        </div>
      </main>
    </div>
  )
}
```

---

### Step 11: Vite Config (`web/vite.config.ts`)

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/home-base/',   // ← update to match your actual GitHub Pages path
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
```

**GitHub Pages SPA redirect** (`web/public/404.html`):
```html
<!DOCTYPE html>
<html>
<head>
  <script>
    // Redirect all 404s back to index.html for client-side routing
    const path = window.location.pathname;
    const base = '/home-base';
    window.location.replace(base + '/?p=' + encodeURIComponent(path.slice(base.length)));
  </script>
</head>
</html>
```

And in `web/index.html`, add a script to restore the path from `?p=` query param.

---

### Step 12: Deploy Workflow (`.github/workflows/deploy.yml`)

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
    paths: ['web/**']
  workflow_dispatch:

permissions:
  contents: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: web/package-lock.json

      - name: Install dependencies
        run: npm ci
        working-directory: web

      - name: Build
        run: npm run build
        working-directory: web
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: web/dist
```

---

### Step 13: Disable Briefing Cron (`.github/workflows/weekly_briefing.yml`)

Change the `on:` block from:
```yaml
on:
  schedule:
    - cron: '0 12 * * 0'
  workflow_dispatch:
```
To:
```yaml
on:
  workflow_dispatch:
    # Cron schedule removed 2026-03-08: replaced by web app (web/)
    # Re-add schedule block to restore automated Sunday briefings
```

---

## Environment Variables

| Variable | Where it lives | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local` (dev), GitHub Actions secret (prod) | Public — safe in browser |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` (dev), GitHub Actions secret (prod) | Public — safe in browser |
| Google Client ID + Secret | Supabase dashboard only | Never in code or env files |

---

## Verification Checklist

- [ ] `npm run dev` in `web/` → app loads at `http://localhost:5173`
- [ ] Sign in with ncduncan@gmail.com → lands on dashboard
- [ ] Sign in with a non-allowlisted account → immediately signed out, error shown
- [ ] Calendar loads this week's events; AMION events show blue badge
- [ ] Add shared todo → visible after page reload
- [ ] Add private todo → visible only when signed in as creator
- [ ] Toggle complete → optimistic update, persists on reload
- [ ] Delete own todo → gone on reload
- [ ] Sign out → redirected to login; can't access dashboard directly
- [ ] Push to `main` → GitHub Actions builds and deploys → live on GitHub Pages URL
- [ ] caitante@gmail.com can log in, sees shared todos, does not see ncduncan's private todos
- [ ] No automatic Sunday runs in GitHub Actions

---

## Files Summary

| Action | File |
|---|---|
| **Create** | `web/` (entire directory, ~15 files) |
| **Create** | `.github/workflows/deploy.yml` |
| **Modify** | `.github/workflows/weekly_briefing.yml` (remove `schedule:`) |
| **Update** | `CLAUDE.md` (add web/ section to architecture) |
| **No change** | `agent/` (all files stay, just unused) |
