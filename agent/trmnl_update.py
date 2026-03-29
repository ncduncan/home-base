"""
TRMNL display updater.

Collects calendar events (today + next 2 days), tasks due soon, and Boston
weather, then pushes the data to the TRMNL Private Plugin webhook.

Usage:
    python -m agent.trmnl_update
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from agent.collectors.calendar import fetch_week_events
from agent.collectors.asana import fetch_workspace_tasks
from agent.collectors.weather import fetch_weather_slots
from agent.config import settings
from agent.publishers.trmnl import push_to_trmnl

EASTERN = ZoneInfo("America/New_York")


def main() -> None:
    now = datetime.now(tz=EASTERN)
    window_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    window_end = window_start + timedelta(days=6)  # 5 display days; timeMax is exclusive

    print(f"[trmnl_update] Window: {window_start.date()} → {window_end.date()}")

    events = fetch_week_events(window_start, window_end)
    tasks = fetch_workspace_tasks(window_end.date())
    weather_slots = fetch_weather_slots(days_ahead=3)

    push_to_trmnl(settings.trmnl_webhook_url, now, events, tasks, weather_slots)


if __name__ == "__main__":
    main()
