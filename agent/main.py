"""
Home-Base: Sunday Morning Briefing Agent

Entrypoint. Orchestrates the full pipeline:
  1. Collect  — calendar events, Asana tasks, Boston weather
  2. Brief    — Claude AI generates narrative + identifies work awareness events
  3. Publish  — Gmail email + Google Calendar invites to work email
  4. E-ink    — optional JSON output for future display support

Run locally:
  BRIEFING_DRY_RUN=true python -m agent.main   # no sends; prints to stdout
  python -m agent.main                          # real run

Trigger manually on GitHub Actions:
  Actions → "Home-Base Weekly Briefing" → Run workflow
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from agent.briefing import generate_briefing
from agent.collectors.asana import fetch_weekend_tasks
from agent.collectors.calendar import fetch_week_events
from agent.collectors.weather import fetch_boston_forecast
from agent.config import settings
from agent.models import BriefingData
from agent.publishers.calendar_invites import create_work_awareness_events
from agent.publishers.email import send_briefing_email

EASTERN = ZoneInfo("America/New_York")


def main() -> None:
    now = datetime.now(tz=EASTERN)

    # Briefing covers: today (Sunday) through end of next Saturday
    week_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_end = week_start + timedelta(days=7)

    print(
        f"[home-base] Briefing for {week_start.strftime('%B %-d')}–"
        f"{week_end.strftime('%B %-d, %Y')} | "
        f"{'DRY RUN' if settings.briefing_dry_run else 'LIVE'}"
    )

    # ── 1. Collect ────────────────────────────────────────────────────
    print("[home-base] Collecting data...")

    calendar_events = fetch_week_events(week_start, week_end)
    print(f"  calendar : {len(calendar_events)} events")

    asana_tasks = fetch_weekend_tasks()
    print(f"  asana    : {len(asana_tasks)} incomplete tasks")

    weather = fetch_boston_forecast()
    print(f"  weather  : {len(weather)} forecast days")

    # ── 2. Assemble BriefingData ─────────────────────────────────────
    data = BriefingData(
        generated_at=now,
        week_start=week_start.date(),
        week_end=week_end.date(),
        calendar_events=calendar_events,
        asana_tasks=asana_tasks,
        weather=weather,
    )

    # ── 3. Generate AI briefing ──────────────────────────────────────
    print("[home-base] Generating briefing with Claude...")
    data = generate_briefing(data)
    print(f"  narrative          : {len(data.narrative)} chars")
    print(f"  work-awareness     : {len(data.work_awareness_events)} events identified")

    # ── 4. Publish ────────────────────────────────────────────────────
    print("[home-base] Publishing...")
    send_briefing_email(data)
    create_work_awareness_events(data)

    # ── 5. E-ink output (optional) ────────────────────────────────────
    if settings.eink_enabled:
        print(f"[home-base] Writing e-ink JSON to {settings.eink_output_path}...")
        with open(settings.eink_output_path, "w") as f:
            f.write(data.to_json())
        print(f"  written to {settings.eink_output_path}")

    print("[home-base] Done.")


if __name__ == "__main__":
    main()
