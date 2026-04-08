"""
TRMNL display updater.

Collects calendar events, tasks, and Boston weather for today + the next 2
days, then pushes them to the TRMNL Private Plugin webhook in a 3-column
layout that mirrors the home-base web dashboard.

Usage:
    python -m agent.trmnl_update
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from agent.collectors.asana import fetch_workspace_tasks
from agent.collectors.calendar import fetch_week_events
from agent.collectors.weather import fetch_boston_forecast
from agent.config import settings
from agent.publishers.trmnl import push_to_trmnl

EASTERN = ZoneInfo("America/New_York")

# How many days to display on the TRMNL screen (today + N-1)
NUM_DAYS = 3


def main() -> None:
    now = datetime.now(tz=EASTERN)
    window_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    # Pull one extra day on each side so multi-day banners and overnight
    # shifts that started yesterday still get attached to the right column.
    fetch_start = window_start - timedelta(days=1)
    fetch_end = window_start + timedelta(days=NUM_DAYS + 1)

    print(
        f"[trmnl_update] Display window: {window_start.date()} → "
        f"{(window_start + timedelta(days=NUM_DAYS - 1)).date()} "
        f"(fetch {fetch_start.date()} → {fetch_end.date()})"
    )

    events = fetch_week_events(fetch_start, fetch_end)
    tasks = fetch_workspace_tasks((window_start + timedelta(days=NUM_DAYS - 1)).date())
    weather = fetch_boston_forecast()

    push_to_trmnl(settings.trmnl_webhook_url, now, events, tasks, weather)


if __name__ == "__main__":
    main()
