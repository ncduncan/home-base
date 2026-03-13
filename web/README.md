# Home-Base Web App

Personal dashboard for Nat and Caitie — calendar, Asana tasks, and weather in one place.

**Live:** https://ncduncan.github.io/home-base/

---

## What it does

- **Calendar** — shows the current week's Google Calendar events, including AMION shift badges
- **Tasks** — live Asana task list showing everything past due, due today, or due in the next 7 days; supports create, edit, complete, delete, and reassign between Nat and Caitie
- **Weather** — 7-day Boston forecast inline with each calendar day

Access is restricted to `ncduncan@gmail.com` and `caitante@gmail.com` via Google OAuth.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + Vite (static SPA) |
| Auth | Supabase Auth — Google OAuth |
| Tasks | Asana REST API (direct from browser) |
| Calendar | Google Calendar REST API (via Supabase `provider_token`) |
| Weather | Open-Meteo (free, no key required) |
| Hosting | GitHub Pages (deployed on push to `main`) |

---

## Local Development

```bash
cd web
cp .env.example .env.local   # fill in values (see below)
npm install
npm run dev                  # http://localhost:5173
```

### Required environment variables

| Variable | Where to get it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `VITE_ASANA_PAT` | https://app.asana.com/0/my-apps → Personal Access Token |
| `VITE_ASANA_WORKSPACE_GID` | Your Asana workspace GID |

`.env.local` is gitignored — never commit real credentials.

---

## Deployment

Pushes to `main` that touch `web/**` automatically trigger the GitHub Actions deploy workflow, which builds the Vite app and publishes it to GitHub Pages.

### Required GitHub Actions secrets

| Secret | Value |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `ASANA_PAT` | Asana Personal Access Token |
| `ASANA_WORKSPACE_GID` | Asana workspace GID |

Set these at: **GitHub → repo Settings → Secrets and variables → Actions**

---

## Project structure

```
web/src/
├── App.tsx                   # Auth state, login ↔ dashboard routing
├── pages/
│   ├── LoginPage.tsx         # Google OAuth sign-in
│   └── DashboardPage.tsx     # Main page — orchestrates all data fetching
├── components/
│   ├── Header.tsx            # Avatar + sign-out
│   ├── CalendarView.tsx      # Weekly calendar with AMION badges + weather
│   └── AsanaTaskList.tsx     # Task panel (Overdue / Due Today / This Week)
├── lib/
│   ├── supabase.ts           # Supabase client
│   ├── asana.ts              # Asana REST API client
│   ├── calendar.ts           # Google Calendar API + AMION shift parsing
│   └── weather.ts            # Open-Meteo API + WMO icon mapping
└── types/index.ts            # AsanaTask, CalendarEvent, WeatherDay interfaces
```
