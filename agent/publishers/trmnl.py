"""
TRMNL e-ink display publisher.

Pushes a compact daily briefing to a TRMNL Private Plugin webhook.
Data window: today + next 2 days (3 days total).

──────────────────────────────────────────────────────────────────────────────
TRMNL Liquid Template
Paste this into your Private Plugin markup on usetrmnl.com:
──────────────────────────────────────────────────────────────────────────────

<div class="screen screen--og">
  <div class="view view--full">
    <div class="title_bar">
      <span class="title">Home Base</span>
      <span class="instance_label">{{ generated_at }}</span>
    </div>
    <div class="layout layout--col gap--medium p--2">

      <div class="flex flex--row gap--medium">
        <span class="value value--xlarge">{{ weather.emoji }}</span>
        <div class="flex flex--col">
          <span class="label">Boston Today</span>
          <span class="value">{{ weather.high }}° / {{ weather.low }}°F</span>
          <span class="description">{{ weather.description }}</span>
        </div>
      </div>

      <div class="flex flex--col gap--small">
        <span class="label label--underline">Upcoming</span>
        {% for event in events %}
          <div class="flex flex--row gap--small">
            <span class="description" style="width:60px">{{ event.day }}</span>
            <span class="description" style="width:70px">{{ event.time }}</span>
            <span class="description">{{ event.title }} — {{ event.owner }}</span>
          </div>
        {% else %}
          <span class="description">No upcoming events</span>
        {% endfor %}
      </div>

      <div class="flex flex--col gap--small">
        <span class="label label--underline">Tasks</span>
        {% for task in tasks %}
          <div class="flex flex--row gap--small">
            <span class="description">{% if task.is_overdue %}! {% endif %}{{ task.name }}</span>
            <span class="description">{{ task.due }}</span>
          </div>
        {% else %}
          <span class="description">No tasks due soon</span>
        {% endfor %}
      </div>

    </div>
  </div>
</div>

──────────────────────────────────────────────────────────────────────────────
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

import httpx

from agent.models import AsanaTask, CalendarEvent, WeatherDay

EASTERN = ZoneInfo("America/New_York")

MAX_EVENTS = 6
MAX_TASKS = 5

# OWM icon code prefix (first 2 chars, e.g. "01" from "01d") → display emoji
_ICON_EMOJI: dict[str, str] = {
    "01": "☀️",
    "02": "🌤️",
    "03": "⛅",
    "04": "☁️",
    "09": "🌧️",
    "10": "🌦️",
    "11": "⛈️",
    "13": "❄️",
    "50": "🌫️",
}


def _weather_emoji(icon: str) -> str:
    return _ICON_EMOJI.get(icon[:2], "🌡️")


def _event_owner(event: CalendarEvent) -> str:
    if event.is_amion:
        return "Caitie"
    if "caitie" in event.calendar_name.lower():
        return "Caitie"
    return "Nat"


def _format_day(event_date: date, today: date) -> str:
    delta = (event_date - today).days
    if delta == 0:
        return "Today"
    if delta == 1:
        return "Tomorrow"
    return event_date.strftime("%a")  # e.g. "Mon"


def _format_time(event: CalendarEvent) -> str:
    if event.all_day:
        return "All Day"
    t = event.start.astimezone(EASTERN)
    hour = t.hour % 12 or 12
    ampm = "AM" if t.hour < 12 else "PM"
    return f"{hour}:{t.strftime('%M')} {ampm}"


def _shape_events(events: list[CalendarEvent], today: date) -> list[dict]:
    shaped = []
    for event in events:
        event_date = event.start.astimezone(EASTERN).date()
        shaped.append(
            {
                "day": _format_day(event_date, today),
                "time": _format_time(event),
                "title": event.title,
                "owner": _event_owner(event),
            }
        )
    return shaped[:MAX_EVENTS]


def _shape_tasks(tasks: list[AsanaTask], today: date) -> list[dict]:
    tomorrow = date.fromordinal(today.toordinal() + 1)
    shaped = []
    for task in tasks:
        if task.due_on is None or task.due_on > tomorrow:
            continue
        if task.due_on < today:
            due_label = "Overdue"
        elif task.due_on == today:
            due_label = "Today"
        else:
            due_label = "Tomorrow"
        shaped.append(
            {
                "name": task.name,
                "due": due_label,
                "is_overdue": task.due_on < today,
            }
        )
    return shaped[:MAX_TASKS]


def _shape_weather(weather: list[WeatherDay], today: date) -> dict:
    for day in weather:
        if day.date == today:
            return {
                "emoji": _weather_emoji(day.icon),
                "high": round(day.high_f),
                "low": round(day.low_f),
                "description": day.description,
            }
    # Fallback to first available day if today isn't in forecast
    if weather:
        day = weather[0]
        return {
            "emoji": _weather_emoji(day.icon),
            "high": round(day.high_f),
            "low": round(day.low_f),
            "description": day.description,
        }
    return {"emoji": "🌡️", "high": "--", "low": "--", "description": "Unavailable"}


def push_to_trmnl(
    webhook_url: str,
    now: datetime,
    events: list[CalendarEvent],
    tasks: list[AsanaTask],
    weather: list[WeatherDay],
) -> None:
    """Format data and POST to the TRMNL Private Plugin webhook."""
    if not webhook_url:
        raise ValueError("TRMNL_WEBHOOK_URL is not configured")

    today = now.astimezone(EASTERN).date()
    t = now.astimezone(EASTERN)
    hour = t.hour % 12 or 12
    ampm = "AM" if t.hour < 12 else "PM"
    generated_at = f"{t.strftime('%b')} {t.day}, {hour}:{t.strftime('%M')} {ampm}"

    shaped_events = _shape_events(events, today)
    shaped_tasks = _shape_tasks(tasks, today)

    payload = {
        "merge_variables": {
            "generated_at": generated_at,
            "weather": _shape_weather(weather, today),
            "events": shaped_events,
            "tasks": shaped_tasks,
        }
    }

    with httpx.Client(timeout=15.0) as client:
        resp = client.post(webhook_url, json=payload)
        resp.raise_for_status()

    print(
        f"[trmnl] Pushed: {len(shaped_events)} events, "
        f"{len(shaped_tasks)} tasks, updated at {generated_at}"
    )
