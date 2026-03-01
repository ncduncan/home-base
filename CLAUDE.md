# Home-Base: Agent Instruction File

This file is the persistent context for Claude Code sessions working on this project.
Read this before making any changes.

---

## Project Overview

**Home-Base** is a personal automation agent for Nathaniel Duncan (Nate).
It runs every Sunday morning via GitHub Actions and produces a smart weekly briefing.

**Owner:** Nate Duncan
**Personal Gmail:** ncduncan@gmail.com
**Work email:** Nathaniel.duncan@geaerospace.com (GE Aerospace, Microsoft 365/Outlook)

### What it does each Sunday ~7-8am ET:
1. Reads personal Google Calendar events for the upcoming week
2. Pulls incomplete Asana tasks that should be actioned before the weekend ends
3. Fetches Boston, MA 7-day weather from OpenWeatherMap
4. Sends all data to Claude (`claude-sonnet-4-6`) which writes a concise, friendly briefing narrative and identifies which personal appointments warrant work awareness
5. Sends an HTML briefing email to ncduncan@gmail.com via Gmail API
6. Creates Google Calendar events (with invites to Nathaniel.duncan@geaerospace.com) for personal appointments that affect work availability — these land directly in Nate's M365/Outlook inbox and calendar

---

## Architecture

```
home-base/
├── .github/workflows/weekly_briefing.yml   # Cron: every Sunday 12:00 UTC
├── agent/
│   ├── main.py                             # Orchestrator: collect → brief → publish
│   ├── config.py                           # pydantic-settings; reads all env vars
│   ├── models.py                           # BriefingData and all Pydantic models
│   ├── briefing.py                         # Claude AI: narrative + work event detection
│   ├── collectors/
│   │   ├── calendar.py                     # Google Calendar reader
│   │   ├── asana.py                        # Asana tasks (httpx, no SDK)
│   │   └── weather.py                      # OpenWeatherMap 7-day forecast
│   └── publishers/
│       ├── email.py                        # Gmail API: send HTML briefing
│       ├── calendar_invites.py             # Google Calendar: create work awareness events
│       └── templates/briefing.html.j2      # Jinja2 HTML email template
└── scripts/generate_token.py              # One-time local OAuth setup
```

### Key Design Principles
- **Single Google OAuth credential** covers calendar read, event creation, and Gmail send
- **No M365 API needed** — work calendar awareness happens via email invites sent to Nathaniel.duncan@geaerospace.com which appear in Outlook automatically
- **`BriefingData` Pydantic model** is the central data structure, serializable to JSON for future e-ink display
- **`BRIEFING_DRY_RUN=true`** prints briefing to stdout without sending email or creating calendar events
- **`EINK_ENABLED=true`** (future) writes BriefingData JSON to `EINK_OUTPUT_PATH` for e-ink display processing

---

## AMION Calendar Nuances — NEEDS CLARIFICATION FROM NATE

⚠️ **This section is a placeholder. Nate needs to explain AMION event interpretation.**

AMION (amion.com) is a physician/shift scheduling system. It syncs to Google Calendar
via an iCal subscription feed. AMION events in Google Calendar often have:
- Cryptic shift codes as event titles (e.g., "J", "DAY", "CALL", "NIGHT", "ONC")
- All-day event format for shift days
- A specific organizer/creator email domain (often something like `@amion.com` or `@shiftadmin.com`)

**Questions for Nate to answer:**
1. What is the AMION calendar called in your Google Calendar? (What's the subscription name?)
2. What do the shift codes mean? (e.g., "J" = junior resident call, "DAY" = day shift?)
3. Should AMION shifts appear in the briefing as regular events, or with special formatting?
4. Should AMION call/on-call shifts trigger work awareness events to GE Aerospace?
5. Are there AMION codes that mean "Nate is unavailable all day" vs "partial day"?

**Current behavior:** AMION events are detected by checking if `amion` appears in the
creator/organizer email or event title. They are flagged with `is_amion=True` and shown
with an "AMION" badge in the email. The Claude prompt is also told about the pending
clarification.

**Where to update after Nate explains:**
- `agent/collectors/calendar.py` → `_is_amion_event()` function
- `agent/briefing.py` → `SYSTEM_PROMPT` constant (add AMION interpretation rules)
- `agent/templates/briefing.html.j2` → AMION badge styling/text if needed

---

## Google OAuth Setup (one-time, done locally)

All three API scopes are on Nate's **personal Google account** (ncduncan@gmail.com):
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
token is revoked (which happens if the token goes unused for 6 months, or if Nate revokes
it in his Google account security settings).

---

## GitHub Actions Secrets Reference

| Secret | Value | Where to get it |
|---|---|---|
| `GOOGLE_OAUTH_TOKEN` | base64 of `token.json` | Run `scripts/generate_token.py` |
| `ASANA_PAT` | Asana Personal Access Token | https://app.asana.com/0/my-apps |
| `ASANA_WORKSPACE_GID` | Asana workspace numeric ID | From Asana URL or API |
| `OPENWEATHERMAP_API_KEY` | OWM API key | https://openweathermap.org/api |
| `ANTHROPIC_API_KEY` | Claude API key | https://console.anthropic.com/ |

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
When Nate adds the e-ink display:

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
| `agent/briefing.py` | Claude API call; fills `narrative` and `work_awareness_events` |
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
| — | AMION interpretation pending Nate's clarification |
