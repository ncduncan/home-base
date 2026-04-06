# Home-Base: Agent Instruction File

This file is the persistent context for Claude Code sessions working on this project.
Read this before making any changes.

---

## Project Overview

**Home-Base** is a personal automation agent for Nathaniel Duncan (Nat).
It runs every Sunday morning via GitHub Actions and produces a smart weekly briefing.

**Owner:** Nat Duncan
**Personal Gmail:** ncduncan@gmail.com
**Work email:** Nathaniel.duncan@geaerospace.com (GE Aerospace, Microsoft 365/Outlook)

### What it does each Sunday ~7-8am ET:
1. Reads personal Google Calendar events for the upcoming week
2. Pulls incomplete Asana tasks that should be actioned before the weekend ends
3. Fetches Boston, MA 7-day weather from OpenWeatherMap
4. Sends all data to Gemini (`gemini-2.0-flash`) which writes a concise, friendly briefing narrative and identifies which personal appointments warrant work awareness
5. Sends an HTML briefing email to ncduncan@gmail.com via Gmail API
6. Creates Google Calendar events (with invites to Nathaniel.duncan@geaerospace.com) for personal appointments that affect work availability — these land directly in Nat's M365/Outlook inbox and calendar

---

## Architecture

> **Current state (2026-03-08):** The project has been migrated to a web dashboard.
> The `agent/` directory is dormant (not deleted). The Sunday cron is disabled.
> See `PLAN.md` for the full implementation plan.

```
home-base/
├── .github/workflows/
│   ├── weekly_briefing.yml   # DORMANT — cron disabled, workflow_dispatch retained
│   └── deploy.yml            # Builds web/ and deploys to GitHub Pages on push to main
├── web/                      # React + Vite SPA (the active app)
│   ├── src/
│   │   ├── App.tsx           # Session routing (login ↔ dashboard)
│   │   ├── lib/
│   │   │   ├── supabase.ts   # Supabase client singleton
│   │   │   └── calendar.ts   # Google Calendar API calls (direct from browser)
│   │   ├── components/
│   │   │   ├── Header.tsx    # User avatar + sign-out
│   │   │   ├── CalendarView.tsx  # Upcoming week events
│   │   │   └── TodoList.tsx  # Shared + private todo CRUD
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   └── DashboardPage.tsx
│   │   └── types/index.ts    # CalendarEvent, Todo interfaces
│   └── vite.config.ts        # base: '/home-base/', Tailwind v4 plugin
├── agent/                    # DORMANT — original Python briefing agent
│   ├── main.py               # Orchestrator (unused)
│   ├── briefing.py           # Gemini AI (unused)
│   ├── collectors/           # calendar.py, asana.py, weather.py (unused)
│   └── publishers/           # email.py, calendar_invites.py (unused)
└── scripts/generate_token.py # One-time local OAuth setup (for agent, if re-enabled)
```

### Web App Stack
- **Framework:** React 19 + Vite (static SPA)
- **Auth:** Supabase Auth — Google OAuth; only ncduncan@gmail.com and caitante@gmail.com allowed
- **Database:** Supabase Postgres — todos with shared/private visibility + Row Level Security
- **Calendar:** Google Calendar REST API called directly from browser using `session.provider_token`
- **Hosting:** GitHub Pages (deployed by `deploy.yml` on push to `main`)
- **No server code required** — Supabase handles the OAuth callback

### Web App Local Dev
```bash
cd web
cp .env.example .env.local   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev                  # http://localhost:5173
```

### Key Design Principles
- **Single Google OAuth credential** covers calendar read, event creation, and Gmail send
- **No M365 API needed** — work calendar awareness happens via email invites sent to Nathaniel.duncan@geaerospace.com which appear in Outlook automatically
- **`BriefingData` Pydantic model** is the central data structure, serializable to JSON for future e-ink display
- **`BRIEFING_DRY_RUN=true`** prints briefing to stdout without sending email or creating calendar events
- **`EINK_ENABLED=true`** (future) writes BriefingData JSON to `EINK_OUTPUT_PATH` for e-ink display processing

---

## AMION Calendar Interpretation

AMION (amion.com) is the physician scheduling system Caitie's residency uses. It syncs
to Google Calendar via iCal. Detection: any event whose `iCalUID` contains `@amion.com`.

The processing logic lives in `web/src/lib/calendar.ts` → `processAmionEvents()`.

### Title patterns

| Title pattern        | Meaning                                                  |
|----------------------|----------------------------------------------------------|
| `Week N of YYYY`     | Skip — calendar header noise                             |
| `Vacation` / `Leave` | Caitie is off — no shift emitted                         |
| `AM: <text>`         | Morning training, 8am–12pm → `training` shift            |
| `PM: <text>`         | Afternoon training, 1pm–5pm → `training` shift           |
| `NC-XXX` (alone)     | **Block marker only — Caitie is NOT working that day**   |
| `Call: NC-XXX`       | Actual night-call working shift (see Night Call rules)   |
| `Call: <other>`      | Standalone call → day shift (8am–6pm)                    |
| `<text>` (e.g. `CICU`, `BWH ICU`) | Regular rotation — weekday day shift, weekend off |
| Contains `SC`        | Backup on-call (passive) — `backup` shift, all-day       |

### Night Call (NC) rules — IMPORTANT

When Caitie is in a night-call block, you'll see `NC-11H` or `NC-BWH` etc. on every
day of the block. **These are markers, not shifts.** She is only actually working when
a `Call: NC-XXX` event also appears that day.

| Day type   | `Call: NC-X` shift hours    | `amion_kind` |
|------------|------------------------------|--------------|
| Weekday    | 4pm → 8am next day (16 hrs)  | `night`      |
| Weekend    | 8am → 8am next day (24 hrs)  | `24hr`       |

So a typical NC-11H block of 7+ days might only have 2–3 actual working shifts, on
the weekend(s) and any specifically-marked weekday `Call:` evenings.

### When updating
- The full processor is in `web/src/lib/calendar.ts` → `processAmionEvents()`
- Gus pickup/dropoff logic in `web/src/lib/gus-care.ts` reads the resulting shifts
- If the AMION feed adds new title patterns, add a case to `classifyAmionTitle()`

---

## Google OAuth Setup (one-time, done locally)

All three API scopes are on Nat's **personal Google account** (ncduncan@gmail.com):
```
https://www.googleapis.com/auth/calendar.readonly    # read personal calendar
https://www.googleapis.com/auth/calendar.events      # create awareness events + invites
https://www.googleapis.com/auth/gmail.send           # send briefing email
```

### Steps:
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create or select a project
2. Enable APIs: **Google Calendar API** and **Gmail API**
3. Create OAuth 2.0 credentials: **Application type = Desktop app**
4. Download JSON → save as `client_secret.json` in project root (⚠️ in .gitignore)
5. Run: `python scripts/generate_token.py`
   - Opens browser → log in as ncduncan@gmail.com → grant permissions
   - Writes `token.json` to project root
6. Encode for GitHub:
   ```bash
   # Linux:
   base64 -w 0 token.json         # → paste as GOOGLE_OAUTH_TOKEN secret
   base64 -w 0 client_secret.json # → not needed as secret; token.json is self-contained

   # macOS:
   base64 -i token.json
   ```
7. Store `GOOGLE_OAUTH_TOKEN` as a GitHub Actions repository secret
8. Delete local `token.json` and `client_secret.json` (or keep in .gitignore — never commit them)

### Token refresh
The `token.json` contains the refresh token which is long-lived. Each GitHub Actions run
auto-refreshes the short-lived access token. No manual rotation needed unless the refresh
token is revoked (which happens if the token goes unused for 6 months, or if Nat revokes
it in his Google account security settings).

---

## GitHub Actions Secrets Reference

| Secret | Value | Where to get it |
|---|---|---|
| `GOOGLE_OAUTH_TOKEN` | base64 of `token.json` | Run `scripts/generate_token.py` |
| `ASANA_PAT` | Asana Personal Access Token | https://app.asana.com/0/my-apps |
| `ASANA_WORKSPACE_GID` | Asana workspace numeric ID | From Asana URL or API |
| `OPENWEATHERMAP_API_KEY` | OWM API key | https://openweathermap.org/api |
| `GEMINI_API_KEY` | Gemini API key | https://aistudio.google.com/app/apikey |

**Hardcoded in workflow (not secrets, they're not sensitive):**
- `BRIEFING_EMAIL_TO=ncduncan@gmail.com`
- `WORK_EMAIL=Nathaniel.duncan@geaerospace.com`

### Getting Asana credentials
```bash
# Get workspace GID: visit https://app.asana.com/api/1.0/workspaces
# (authenticate with your PAT)
curl -H "Authorization: Bearer YOUR_PAT" https://app.asana.com/api/1.0/workspaces
```

---

## Running Locally

```bash
# Install
pip install -e ".[dev]"

# Copy env template and fill in values
cp .env.example .env
# Edit .env with your credentials

# Dry run (no email, no calendar events — just prints)
BRIEFING_DRY_RUN=true python -m agent.main

# Real run
python -m agent.main
```

---

## Testing Without Waiting for Sunday

1. **Dry run locally:** `BRIEFING_DRY_RUN=true python -m agent.main`
2. **Manual GitHub Actions trigger:** GitHub → Actions → "Home-Base Weekly Briefing" → "Run workflow"

---

## Adding E-Ink Display Support (Future)

The `BriefingData` model in `agent/models.py` is already serializable to JSON.
When Nat adds the e-ink display:

1. Set `EINK_ENABLED=true` and `EINK_OUTPUT_PATH=/path/to/briefing.json` in the workflow
2. `main.py` will write `data.to_json()` to that path after publishing
3. A separate process on the Pi/display device reads the JSON and renders it
4. Alternatively, add `agent/publishers/eink.py` that renders a PNG via Pillow

No changes needed to collectors, models, or the core briefing logic.

---

## Module Quick-Reference

| File | Purpose |
|---|---|
| `agent/main.py` | Entrypoint; orchestrates collect → brief → publish |
| `agent/config.py` | All env var definitions via `pydantic-settings` |
| `agent/models.py` | `BriefingData`, `CalendarEvent`, `AsanaTask`, `WeatherDay`, `WorkAwarenessEvent` |
| `agent/briefing.py` | Gemini API call; fills `narrative` and `work_awareness_events` |
| `agent/collectors/calendar.py` | Google Calendar API; includes AMION detection placeholder |
| `agent/collectors/asana.py` | Asana REST API via httpx; fetches incomplete tasks |
| `agent/collectors/weather.py` | OpenWeatherMap; 7-day Boston forecast; falls back to 5-day |
| `agent/publishers/email.py` | Renders Jinja2 template; sends via Gmail API |
| `agent/publishers/calendar_invites.py` | Creates Google Calendar events; invites work email |
| `agent/publishers/templates/briefing.html.j2` | HTML email template |
| `scripts/generate_token.py` | One-time OAuth token generation (run locally) |

---

## Change Log

| Date | Change |
|---|---|
| 2026-03-01 | Initial implementation |
| — | AMION interpretation pending Nat's clarification |
