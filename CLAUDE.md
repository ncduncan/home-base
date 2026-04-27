# Home-Base: Agent Instruction File

This file is the persistent context for Claude Code sessions working on this project.
Read this before making any changes.

---

## Project Overview

**Home-Base** is a household coordination project for Nathaniel Duncan (Nat) and his wife Caitie.
Two surfaces share a single source-of-truth rules library: a web dashboard they both look at,
and a Sunday-morning briefing agent that emails them a weekly summary.

**Owner:** Nat Duncan
**Personal Gmail:** ncduncan@gmail.com
**Caitie Gmail:** caitante@gmail.com
**Work email:** Nathaniel.duncan@geaerospace.com (GE Aerospace, Microsoft 365/Outlook)

### What the Sunday agent does (every Sunday 7am ET via GitHub Actions):
1. Fetches the upcoming-week Google Calendar events (incl. AMION shifts)
2. Pulls homebase events + overrides from Supabase
3. Pulls due/overdue Asana tasks for both users
4. Runs the same shared rules the dashboard uses (AMION processor, gus-care, overrides)
5. Reconciles Gus pickup/dropoff calendar invites idempotently
6. Asks Claude (`claude-opus-4-7` via `@anthropic-ai/sdk`) for a friendly intro paragraph + action items
7. Renders an HTML email and sends it via Gmail API to both Nat and Caitie

The web dashboard (web/) is the day-to-day surface. Both consume `shared/`.

---

## Architecture

```
home-base/
├── shared/                       # @home-base/shared — pure rules + IO factories (TS)
│   └── src/
│       ├── types.ts              # CalendarEvent, AsanaTask, GusResponsibility, etc.
│       ├── calendar/
│       │   ├── process.ts        # AMION processor, eventOwner, parseCalendarSources
│       │   └── io.ts             # fetchCalendarEvents, syncGusCareInvites, createOwnedEvent
│       ├── gus-care.ts           # computeGusCare()
│       ├── overrides.ts          # applyOverrides() + Supabase IO
│       ├── homebase-events.ts    # Supabase IO + homebaseToCalendarEvent
│       └── asana.ts              # createAsanaClient({ pat, workspaceGid })
├── web/                          # React 19 + Vite SPA — dashboard
│   ├── src/
│   │   ├── lib/
│   │   │   ├── supabase.ts       # Browser singleton (env from import.meta.env)
│   │   │   ├── calendar.ts       # Web wrapper — token cache + binds shared/
│   │   │   ├── asana.ts          # Web wrapper — instantiates shared client with VITE_* env
│   │   │   ├── overrides.ts      # Web wrapper — binds supabase singleton
│   │   │   ├── homebase-events.ts # Web wrapper
│   │   │   ├── gus-care.ts       # Re-exports from shared
│   │   │   └── weather.ts        # Browser-only (calls Supabase fn)
│   │   ├── components/, pages/   # Unchanged by the Phase 1 refactor
│   │   └── types/index.ts        # Re-exports from @home-base/shared/types
│   └── vite.config.ts
├── agent/
│   ├── briefing/                 # NEW — Node/TS Sunday briefing agent
│   │   └── src/
│   │       ├── index.ts          # Orchestrator
│   │       ├── config.ts         # Env load + dry-run guard (refuses dry-run in CI)
│   │       ├── google-token.ts   # Refresh GOOGLE_OAUTH_TOKEN → access token
│   │       ├── week-window.ts    # Sun→Sat date computation
│   │       ├── data-fetch.ts     # Parallel fetch via shared/ + service-role Supabase
│   │       ├── briefing-data.ts  # Week grid + todos + conflict detection
│   │       ├── narrative.ts      # Claude Opus 4.7 with output_config JSON schema + fallback
│   │       ├── email-template.ts # Inline-styled HTML render
│   │       └── gmail-send.ts     # RFC 2822 multipart, gmail.send API
│   ├── trmnl_update.py           # ACTIVE — daily TRMNL display update (Python)
│   ├── trmnl_finance_update.py   # ACTIVE — TRMNL finance dashboard (Python)
│   ├── amion.py, models.py, etc. # Used by trmnl_update.py
│   └── (legacy: main.py, briefing.py, publishers/email.py, etc. are dormant — slated for deletion once new agent is verified)
├── supabase/                     # Edge functions (google-token-refresh, trmnl)
└── .github/workflows/
    ├── weekly_briefing.yml       # Node — Sunday 7am ET briefing email
    ├── deploy.yml                # Builds web/ and deploys to GitHub Pages
    ├── trmnl_update.yml          # Daily TRMNL display update (Python — separate)
    └── trmnl_finance_update.yml  # TRMNL finance dashboard (Python — separate)
```

### Workspace setup
npm workspaces at the repo root: `shared`, `web`, `agent/briefing`. Run `npm install` at root.

### Key Design Principles
- **Single source of truth for rules.** AMION processing, gus-care assignment, overrides, etc. live in `shared/`. Both web and agent import from there. NEVER reimplement these in either consumer — fix once in `shared/` and both surfaces update together.
- **Web wrappers stay thin.** `web/src/lib/*` files only bind browser singletons (supabase client, `import.meta.env`) and re-export shared functionality. Anything more complex belongs in `shared/`.
- **Agent uses service-role Supabase + refreshed Google OAuth token.** It runs autonomously without depending on a logged-in user session. Same Google credentials it uses for calendar reads also send the email (gmail.send scope).
- **Idempotent calendar reconciliation.** Both web and agent call `syncGusCareInvites` against the same Google Calendar. The dedup key (event title + date) is the contract; both writers stay safe.
- **Public-repo logging policy.** GH Action logs are world-readable. Agent logs counts and step transitions only — never event titles, todo content, or rendered email bodies. The agent enforces this in code (`config.ts` refuses `BRIEFING_DRY_RUN=true` when `GITHUB_ACTIONS=true`).

---

## AMION Calendar Interpretation

AMION (amion.com) is the physician scheduling system Caitie's residency uses. It syncs
to Google Calendar via iCal. Detection: any event whose `iCalUID` contains `@amion.com`,
OR whose source calendar is named "Caitie Work" / matches the AMION feed.

**The processor lives in `shared/src/calendar/process.ts` → `processAmionEvents()`.**

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

When Caitie is in a night-call block, you'll see `NC-11H` or `NC-BWH` on every
day of the block. **These are markers, not shifts.** She is only actually working when
a `Call: NC-XXX` event also appears that day.

| Day type   | `Call: NC-X` shift hours    | `amion_kind` |
|------------|------------------------------|--------------|
| Weekday    | 4pm → 8am next day (16 hrs)  | `night`      |
| Weekend    | 8am → 8am next day (24 hrs)  | `24hr`       |

A typical NC-11H block of 7+ days might only have 2–3 actual working shifts, on
the weekend(s) and any specifically-marked weekday `Call:` evenings.

### When updating AMION rules
- Change `shared/src/calendar/process.ts` → `classifyAmionTitle()` and/or `processAmionEvents()`
- Both the dashboard and the Sunday agent automatically pick up the change
- Gus pickup/dropoff logic in `shared/src/gus-care.ts` reads the resulting shifts; usually no edit needed there

---

## Local Development

### Web dashboard
```bash
cd web
cp .env.example .env.local   # paste values from GH secrets
npm install                   # at repo root, picks up workspaces
npm run dev                   # http://localhost:5173
```

### Briefing agent (dry-run, no email/calendar mutations)
```bash
cd agent/briefing
# Export the secrets — same names as the GH workflow
export GOOGLE_OAUTH_TOKEN="$(cat ~/path/to/token.json)"
export VITE_SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
export ANTHROPIC_API_KEY=...
export ASANA_PAT=...
export ASANA_WORKSPACE_GID=...
export ALLOWED_EMAILS=ncduncan@gmail.com,caitante@gmail.com
export BRIEFING_DRY_RUN=true
export BRIEFING_DRY_RUN_OUT=/tmp/briefing.html
npm start
open /tmp/briefing.html
```

Dry-run skips both Gmail send AND `syncGusCareInvites`, so it's safe to run repeatedly.
The dry-run flag is automatically refused when running inside GitHub Actions.

---

## Google OAuth Setup (one-time, done locally)

All scopes are on Nat's **personal Google account** (ncduncan@gmail.com):
```
https://www.googleapis.com/auth/calendar.readonly    # read personal calendar
https://www.googleapis.com/auth/calendar.events      # create Gus invites + awareness events
https://www.googleapis.com/auth/gmail.send           # send briefing email
```

### Steps:
1. Google Cloud Console → create or select a project
2. Enable APIs: **Google Calendar API** and **Gmail API**
3. Create OAuth 2.0 credentials: **Application type = Desktop app**
4. Download JSON → save as `client_secret.json` in project root (gitignored)
5. Run `python scripts/generate_token.py` (still works for token gen)
   - Opens browser → log in as ncduncan@gmail.com → grant permissions
   - Writes `token.json` to project root
6. Paste the raw JSON contents (NOT base64) of `token.json` as the `GOOGLE_OAUTH_TOKEN` GH secret
7. Delete local `token.json` and `client_secret.json`

### Token refresh
`token.json` contains the long-lived refresh_token + client_id + client_secret. The agent
exchanges it for a short-lived access_token at run time (see `agent/briefing/src/google-token.ts`).
No manual rotation needed unless the refresh token is revoked (~6 months unused, or manually
revoked in Google account security).

---

## GitHub Actions Secrets Reference

| Secret | Used by | Notes |
|---|---|---|
| `GOOGLE_OAUTH_TOKEN` | weekly_briefing.yml, trmnl_update.yml | Raw token.json contents |
| `VITE_SUPABASE_URL` | deploy.yml, weekly_briefing.yml | Same URL used by web + agent |
| `VITE_SUPABASE_ANON_KEY` | deploy.yml | Browser-bundled (intentional) |
| `SUPABASE_SERVICE_ROLE_KEY` | weekly_briefing.yml | NEW — agent's RLS-bypass key |
| `ALLOWED_EMAILS` | deploy.yml (browser-bundled), weekly_briefing.yml | Comma-separated recipient list |
| `ANTHROPIC_API_KEY` | weekly_briefing.yml | Claude Opus 4.7 narrative pass |
| `ASANA_PAT` | deploy.yml (browser-bundled ⚠), trmnl_update.yml, weekly_briefing.yml | See security note below |
| `ASANA_WORKSPACE_GID` | deploy.yml, trmnl_update.yml, weekly_briefing.yml | |
| `OPENWEATHERMAP_API_KEY` | trmnl_update.yml | Not used by the briefing agent |
| `FRED_API_KEY` | trmnl_finance_update.yml | |
| `TRMNL_WEBHOOK_URL` | trmnl_update.yml, trmnl_finance_update.yml | |

### Security note: Asana PAT in browser bundle
`deploy.yml` embeds `VITE_ASANA_PAT` and `VITE_ASANA_WORKSPACE_GID` into the GH Pages bundle.
Since the site is public, those values are readable via devtools. The Asana PAT is effectively
public. Long-term fix: move Asana fetches to a Supabase Edge Function. Tracked as a follow-up.

---

## TRMNL Display (separate, untouched by recent refactor)

The TRMNL e-ink display has its own daily Python pipeline (`agent/trmnl_update.py` and
`agent/trmnl_finance_update.py`) that runs on its own GH workflows. It currently has its
own AMION/event-processing logic in `agent/amion.py` etc. **Future migration:** port these
to Node and consume `shared/` like the web app and briefing agent do. Out of scope for now.

---

## Module Quick-Reference

| File | Purpose |
|---|---|
| `shared/src/types.ts` | All cross-surface TS types |
| `shared/src/calendar/process.ts` | AMION processor, eventOwner, parseCalendarSources |
| `shared/src/calendar/io.ts` | fetchCalendarEvents, syncGusCareInvites (take getAccessToken) |
| `shared/src/gus-care.ts` | computeGusCare(events, weekDates) |
| `shared/src/overrides.ts` | applyOverrides + Supabase fetch/upsert/delete |
| `shared/src/homebase-events.ts` | Supabase IO + homebaseToCalendarEvent |
| `shared/src/asana.ts` | createAsanaClient({ pat, workspaceGid }) |
| `web/src/lib/calendar.ts` | Web wrapper: provider_token cache + binds shared IO |
| `web/src/lib/asana.ts` | Web wrapper: shared client bound to VITE_ASANA_PAT |
| `agent/briefing/src/index.ts` | Sunday agent orchestrator |
| `agent/briefing/src/google-token.ts` | Refresh-token → access-token flow |
| `.github/workflows/weekly_briefing.yml` | Cron `0 11 * * 0` (7am EST / 8am EDT) |

---

## Change Log

| Date | Change |
|---|---|
| 2026-03-01 | Initial implementation (Python briefing agent) |
| 2026-03-08 | Migrated to web dashboard (web/), Sunday cron disabled |
| 2026-04-27 | Extracted shared/ rules package, rebuilt Sunday agent in Node, re-enabled cron |
| 2026-04-27 | Removed dormant Python briefing files (commit 5fb8bf2); TRMNL Python pipelines unchanged |
| 2026-04-27 | Swapped narrative pass from Gemini to Claude Opus 4.7 via @anthropic-ai/sdk |
