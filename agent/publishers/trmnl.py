"""
TRMNL e-ink display publisher.

Pushes a compact daily briefing to a TRMNL Private Plugin webhook.
Data window: today + next 2 days (3 days total), AM/PM weather slices.

──────────────────────────────────────────────────────────────────────────────
TRMNL Liquid Template
Paste this into your Private Plugin markup on usetrmnl.com:
──────────────────────────────────────────────────────────────────────────────

<div class="screen screen--og">
  <div class="view view--full" style="display:flex;flex-direction:column;">

    <div class="title_bar">
      <span class="title">Home Base</span>
      <span class="instance_label">{{ generated_at }}</span>
    </div>

    <!-- Weather: 6 AM/PM columns -->
    <div style="display:flex;border-bottom:2px solid #000;padding:4px 0;">
      {% for slot in weather_slots %}
      <div style="flex:1;text-align:center;padding:2px 0;{% unless forloop.last %}border-right:1px solid #ccc;{% endunless %}">
        <div style="font-size:11px;font-weight:bold;line-height:1.3;">{{ slot.label }}</div>
        <div style="font-size:22px;line-height:1.1;">{{ slot.emoji }}</div>
        <div style="font-size:17px;font-weight:bold;line-height:1.2;">{{ slot.temp }}°</div>
      </div>
      {% endfor %}
    </div>

    <!-- Main: events (left 80%) + tasks (right 20%) -->
    <div style="display:flex;flex:1;padding:6px 4px 4px 4px;gap:6px;">

      <div style="flex:4;">
        <div style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #000;margin-bottom:3px;padding-bottom:1px;">Upcoming</div>
        {% for event in events %}
        <div style="display:flex;font-size:13px;line-height:1.5;">
          <span style="width:62px;flex-shrink:0;">{{ event.day }}</span>
          <span style="width:70px;flex-shrink:0;">{{ event.time }}</span>
          <span>{{ event.title }} — {{ event.owner }}</span>
        </div>
        {% else %}
        <div style="font-size:13px;">No upcoming events</div>
        {% endfor %}
      </div>

      <div style="flex:1;border-left:1px solid #ccc;padding-left:6px;">
        <div style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #000;margin-bottom:3px;padding-bottom:1px;">Tasks</div>
        {% for task in tasks %}
        <div style="font-size:12px;line-height:1.4;margin-bottom:3px;">{% if task.is_overdue %}<strong>!</strong> {% endif %}{{ task.name }}<div style="font-size:11px;">{{ task.due }}</div></div>
        {% else %}
        <div style="font-size:12px;">No tasks due</div>
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

from agent.models import AsanaTask, CalendarEvent

EASTERN = ZoneInfo("America/New_York")

MAX_EVENTS = 8
MAX_TASKS = 6

# OWM icon code prefix (first 2 chars) → display emoji
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
    return event_date.strftime("%a")


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


def _shape_weather_slots(slots: list[dict]) -> list[dict]:
    return [
        {
            "label": s["label"],
            "temp": s["temp"] if s["temp"] is not None else "--",
            "emoji": _weather_emoji(s["icon"]),
        }
        for s in slots
    ]


def push_to_trmnl(
    webhook_url: str,
    now: datetime,
    events: list[CalendarEvent],
    tasks: list[AsanaTask],
    weather_slots: list[dict],  # [{label, temp, icon}, ...] from fetch_weather_slots()
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
    shaped_slots = _shape_weather_slots(weather_slots)

    payload = {
        "merge_variables": {
            "generated_at": generated_at,
            "weather_slots": shaped_slots,
            "events": shaped_events,
            "tasks": shaped_tasks,
        }
    }

    with httpx.Client(timeout=15.0) as client:
        resp = client.post(webhook_url, json=payload)
        resp.raise_for_status()

    print(
        f"[trmnl] Pushed: {len(shaped_slots)} weather slots, "
        f"{len(shaped_events)} events, {len(shaped_tasks)} tasks — {generated_at}"
    )
