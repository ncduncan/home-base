# Home-Base

Personal Sunday morning briefing agent for Nat Duncan.

Runs every Sunday at ~7–8am ET via GitHub Actions. Reads your Google Calendar,
Asana tasks, and Boston weather, then uses Claude AI to write a friendly briefing
email — and fires Google Calendar invites to your work Outlook inbox for any
personal appointments your GE Aerospace colleagues should know about.

---

## What You Get Each Sunday

1. **HTML email** → `ncduncan@gmail.com`
   - AI-written narrative: week at a glance, urgent tasks, weather highlights
   - Full calendar table (Mon–Sun)
   - Asana tasks due before the weekend ends (color-coded by urgency)
   - Boston 7-day weather forecast

2. **Outlook calendar invites** → `Nathaniel.duncan@geaerospace.com`
   - Claude identifies personal events that affect work availability
   - Events appear directly in M365/Outlook — no M365 API needed

---

## One-Time Setup

### 1. Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/)
2. Create a project (e.g., `home-base`)
3. Enable these APIs:
   - **Google Calendar API**
   - **Gmail API**
4. Go to **Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Desktop app**
5. Download the JSON → save as `client_secret.json` in the project root

### 2. Generate the OAuth Token (run once on your laptop)

```bash
pip install -e .
python scripts/generate_token.py
```

A browser tab opens → log in as **ncduncan@gmail.com** → grant permissions.
This writes `token.json` to the project root.

### 3. Encode and Store as GitHub Secret

```bash
# Linux:
base64 -w 0 token.json

# macOS:
base64 -i token.json
```

Copy the output. In your GitHub repo:
**Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `GOOGLE_OAUTH_TOKEN` | base64 of `token.json` |
| `ASANA_PAT` | Your [Asana Personal Access Token](https://app.asana.com/0/my-apps) |
| `ASANA_WORKSPACE_GID` | Your Asana workspace ID (see below) |
| `OPENWEATHERMAP_API_KEY` | [OpenWeatherMap API key](https://openweathermap.org/api) (free tier works) |
| `ANTHROPIC_API_KEY` | Your [Claude API key](https://console.anthropic.com/) |

**Finding your Asana workspace GID:**
```bash
curl -H "Authorization: Bearer YOUR_ASANA_PAT" \
     https://app.asana.com/api/1.0/workspaces
```

### 4. Test It

Trigger a manual run without waiting for Sunday:

**GitHub → Actions → "Home-Base Weekly Briefing" → Run workflow**

---

## Running Locally

```bash
# Install
pip install -e ".[dev]"

# Create .env from template
cp .env.example .env
# Edit .env — fill in ASANA_PAT, OPENWEATHERMAP_API_KEY, ANTHROPIC_API_KEY
# Set GOOGLE_TOKEN_PATH=token.json (if you ran generate_token.py)
# Keep BRIEFING_DRY_RUN=true while testing

# Dry run (prints briefing, skips email + calendar invites)
BRIEFING_DRY_RUN=true python -m agent.main

# Real run
python -m agent.main
```

---

## Architecture

```
agent/
├── main.py                    # Orchestrator
├── config.py                  # All env vars (pydantic-settings)
├── models.py                  # BriefingData + supporting models
├── briefing.py                # Claude AI: narrative + work event detection
├── collectors/
│   ├── calendar.py            # Google Calendar reader
│   ├── asana.py               # Asana REST API (httpx)
│   └── weather.py             # OpenWeatherMap (OneCall + 5-day fallback)
└── publishers/
    ├── email.py               # Gmail API sender
    ├── calendar_invites.py    # Google Calendar invite creator
    └── templates/
        └── briefing.html.j2   # Jinja2 HTML email template

scripts/
└── generate_token.py          # One-time local OAuth setup

.github/workflows/
└── weekly_briefing.yml        # Cron: Sunday 12:00 UTC
```

---

## AMION Calendar (Pending Clarification)

Nat's calendar includes AMION shift scheduling events. These are currently
detected by a placeholder heuristic and flagged with `[AMION]` in the briefing.

**TODO:** Nat needs to explain the AMION event format. See `CLAUDE.md` →
"AMION Calendar Nuances" for the full list of questions.

Once clarified, update:
- `agent/collectors/calendar.py` → `_is_amion_event()`
- `agent/briefing.py` → `SYSTEM_PROMPT`

---

## Future: E-Ink Display

The `BriefingData` model is JSON-serializable. To add e-ink display support:

1. Set `EINK_ENABLED=true` and `EINK_OUTPUT_PATH=/path/to/briefing.json` in the workflow
2. The agent writes the full structured briefing to that path after publishing
3. Add `agent/publishers/eink.py` to render a PNG or custom format for your display

No changes needed to collectors, models, or the core briefing logic.
