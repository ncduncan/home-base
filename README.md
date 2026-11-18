# Home-Base

Personal dashboard and weekly briefing agent.

---

## What it is

Two things in one repo:

### 1. Web Dashboard (active)
A React SPA hosted on Vercel (Hobby), built from this private repo. Shows:
- **Google Calendar** — current week's events with AMION shift badges
- **Asana Tasks** — everything past due, due today, or due this week; create / edit / complete / delete / reassign between users
- **Weather** — 7-day forecast inline with each calendar day

Access restricted to a configurable allowlist of Google accounts (set via `ALLOWED_EMAILS` secret).

### 2. Sunday Briefing Agent
A Python agent that runs via GitHub Actions cron. Reads Google Calendar, Asana tasks, and local weather → feeds it to Gemini → sends an HTML email briefing and fires Google Calendar invites to a work email for personal events affecting work availability.

---

## Repository structure

```
home-base/
├── web/                        # React + Vite SPA (active)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/              # LoginPage, DashboardPage
│   │   ├── components/         # CalendarView, AsanaTaskList, Header
│   │   ├── lib/                # asana.ts, calendar.ts, weather.ts, supabase.ts
│   │   └── types/index.ts
│   └── vite.config.ts
├── agent/                      # Python briefing agent (dormant)
│   ├── main.py
│   ├── collectors/             # calendar.py, asana.py, weather.py
│   └── publishers/             # email.py, calendar_invites.py
├── .github/workflows/
│   └── weekly_briefing.yml     # DORMANT — Sunday cron (workflow_dispatch retained)
└── scripts/
    └── generate_token.py       # One-time Google OAuth setup (for agent)
```

---

## Web Dashboard — Setup

### Local dev

```bash
cd web
cp .env.example .env.local   # fill in values
npm install
npm run dev                  # http://localhost:5173
```

### Environment variables

| Variable | Where to get it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `VITE_ASANA_PAT` | https://app.asana.com/0/my-apps |
| `VITE_ASANA_WORKSPACE_GID` | Your Asana workspace GID |

### Hosting (Vercel)

The Vercel project is connected to this repo through Vercel's Git integration:
every push to `main` deploys production, every PR gets a preview URL. Build
settings live in `web/vercel.json` (root directory `web`; install runs from the
repo root so the `@home-base/shared` workspace resolves; SPA rewrite to
`index.html`). The app is served at the domain root (`base: '/'`).

Vercel project env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_ALLOWED_EMAILS`. The Supabase `ALLOWED_ORIGINS` function secret must list
the Vercel production origin; with it unset, the Edge Functions only allow
`http://localhost:5173`. Preview URLs are deliberately not allowlisted, so
calendar and task calls fail CORS on previews.

The built bundle is publicly fetchable from the production URL (no edge gate);
data stays behind Supabase auth, the `ALLOWED_EMAILS` check and RLS.

---

## Briefing Agent — Setup (if re-enabling)

### GitHub Actions secrets

| Secret | Where to get it |
|---|---|
| `GOOGLE_OAUTH_TOKEN` | Run `python scripts/generate_token.py`, then store the **raw** `token.json` contents (NOT base64 — consumers `JSON.parse` it directly) |
| `ASANA_PAT` | https://app.asana.com/0/my-apps |
| `ASANA_WORKSPACE_GID` | `curl -H "Authorization: Bearer YOUR_PAT" https://app.asana.com/api/1.0/workspaces` |
| `OPENWEATHERMAP_API_KEY` | https://openweathermap.org/api (free tier) |
| `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey |

### Run locally

```bash
pip install -e ".[dev]"
cp .env.example .env        # fill in credentials
BRIEFING_DRY_RUN=true python -m agent.main   # prints briefing, skips email/calendar
python -m agent.main                          # real run
```

Re-enable the cron by restoring the `schedule:` trigger in `.github/workflows/weekly_briefing.yml`.
