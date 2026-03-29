"""
TRMNL e-ink display publisher.

Pushes a compact daily briefing to a TRMNL Private Plugin webhook.
Data window: today + next 2 days (3 days total), AM/PM weather slices.

──────────────────────────────────────────────────────────────────────────────
TRMNL Liquid Template
Paste this into your Private Plugin markup on usetrmnl.com:
──────────────────────────────────────────────────────────────────────────────

<div class="screen screen--og">
  <div class="view view--full" style="display:flex;flex-direction:column;font-family:sans-serif;">

    <div class="title_bar">
      <span class="title">Home Base</span>
      <span class="instance_label">{{ generated_at }}</span>
    </div>

    <!-- Weather: 6 AM/PM columns across top -->
    <div style="display:flex;border-bottom:2px solid #000;padding:3px 0;">
      {% for slot in weather_slots %}
      <div style="flex:1;text-align:center;padding:1px 2px;{% unless forloop.last %}border-right:1px solid #ccc;{% endunless %}">
        <div style="font-size:10px;font-weight:bold;line-height:1.3;letter-spacing:-.02em;">{{ slot.label }}</div>
        <div style="font-size:20px;line-height:1.1;">{{ slot.emoji }}</div>
        <div style="font-size:17px;font-weight:bold;line-height:1.1;">{{ slot.temp }}°</div>
        <div style="font-size:10px;line-height:1.2;color:#444;">{{ slot.desc }}</div>
      </div>
      {% endfor %}
    </div>

    <!-- Main: events (left 72%) + tasks (right 28%) -->
    <div style="display:flex;flex:1;padding:5px 4px 2px 4px;gap:6px;overflow:hidden;">

      <!-- Events -->
      <div style="flex:18;overflow:hidden;">
        <div style="font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;border-bottom:1.5px solid #000;margin-bottom:2px;padding-bottom:1px;">Upcoming</div>
        {% for group in event_groups %}
        <div style="font-size:11px;font-weight:bold;margin-top:5px;margin-bottom:1px;padding-bottom:1px;border-bottom:1px solid #ddd;">{{ group.date_label }}</div>
        {% for event in group.events %}
        <div style="display:flex;font-size:13px;line-height:1.45;padding-left:6px;">
          <span style="width:74px;flex-shrink:0;color:#444;font-size:12px;">{{ event.time }}</span>
          <span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">{{ event.title }}</span>
          <span style="flex-shrink:0;font-size:11px;color:#555;padding-left:4px;">— {{ event.owner }}</span>
        </div>
        {% endfor %}
        {% else %}
        <div style="font-size:13px;margin-top:4px;">No upcoming events</div>
        {% endfor %}
      </div>

      <!-- Tasks -->
      <div style="flex:7;border-left:1.5px solid #000;padding-left:6px;overflow:hidden;">
        <div style="font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;border-bottom:1.5px solid #000;margin-bottom:2px;padding-bottom:1px;">Tasks</div>
        {% for task in tasks %}
        <div style="margin-bottom:5px;overflow:hidden;">
          <div style="font-size:13px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{% if task.is_overdue %}<b>!</b> {% endif %}{{ task.name }}</div>
          <div style="font-size:11px;font-weight:bold;color:#555;">{{ task.due }}</div>
        </div>
        {% else %}
        <div style="font-size:13px;">No tasks due</div>
        {% endfor %}
      </div>

    </div>
  </div>
</div>

──────────────────────────────────────────────────────────────────────────────
"""

import re
from collections import defaultdict
from datetime import date, datetime
from zoneinfo import ZoneInfo

import httpx

from agent.models import AsanaTask, CalendarEvent

EASTERN = ZoneInfo("America/New_York")

MAX_EVENT_DAYS = 5
MAX_EVENTS_PER_DAY = 4
MAX_TASKS = 8

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

# OWM description → short display label
_DESC_SHORT: dict[str, str] = {
    "Clear Sky": "Clear",
    "Few Clouds": "Few Clds",
    "Scattered Clouds": "Scattered",
    "Broken Clouds": "Broken",
    "Overcast Clouds": "Overcast",
    "Light Rain": "Lt Rain",
    "Moderate Rain": "Rain",
    "Heavy Intensity Rain": "Hvy Rain",
    "Shower Rain": "Showers",
    "Light Snow": "Lt Snow",
    "Snow": "Snow",
    "Thunderstorm": "T-Storm",
    "Mist": "Mist",
    "Fog": "Fog",
    "Haze": "Haze",
}

# Filter AMION admin events like "Week 14 of 2026"
_WEEK_RE = re.compile(r"^week\s+\d+\s+of\s+\d+", re.IGNORECASE)

# Filter scheduling placeholder titles (from any calendar)
_SKIP_TITLES = {"Leave", "Vacation"}


def _weather_emoji(icon: str) -> str:
    return _ICON_EMOJI.get(icon[:2], "🌡️")


def _short_desc(description: str) -> str:
    return _DESC_SHORT.get(description, description[:10] if len(description) > 10 else description)


def _event_owner(event: CalendarEvent) -> str:
    if event.is_amion:
        return "Caitie"
    if "caitie" in event.calendar_name.lower():
        return "Caitie"
    return "Nat"


def _format_day_header(event_date: date, today: date) -> str:
    delta = (event_date - today).days
    if delta == 0:
        return "Today"
    if delta == 1:
        return "Tomorrow"
    # e.g. "Tue, Apr 1"  (avoids %-d which is Linux-only)
    return f"{event_date.strftime('%a')}, {event_date.strftime('%b')} {event_date.day}"


def _format_time(event: CalendarEvent) -> str:
    if event.all_day:
        return "All Day"
    t = event.start.astimezone(EASTERN)
    hour = t.hour % 12 or 12
    ampm = "AM" if t.hour < 12 else "PM"
    return f"{hour}:{t.strftime('%M')} {ampm}"


def _shape_event_groups(events: list[CalendarEvent], today: date) -> list[dict]:
    """Group events by day, filtering AMION week-marker events."""
    by_day: dict[date, list[dict]] = defaultdict(list)
    for event in events:
        if _WEEK_RE.match(event.title) or event.title in _SKIP_TITLES:
            continue
        event_date = event.start.astimezone(EASTERN).date()
        by_day[event_date].append({
            "time": _format_time(event),
            "title": event.title,
            "owner": _event_owner(event),
        })

    groups = []
    for d in sorted(by_day.keys())[:MAX_EVENT_DAYS]:
        groups.append({
            "date_label": _format_day_header(d, today),
            "events": by_day[d][:MAX_EVENTS_PER_DAY],
        })
    return groups


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
        shaped.append({
            "name": task.name,
            "due": due_label,
            "is_overdue": task.due_on < today,
        })
    return shaped[:MAX_TASKS]


def _shape_weather_slots(slots: list[dict]) -> list[dict]:
    return [
        {
            "label": s["label"],
            "temp": s["temp"] if s["temp"] is not None else "--",
            "emoji": _weather_emoji(s["icon"]),
            "desc": _short_desc(s.get("description", "")),
        }
        for s in slots
    ]


def push_to_trmnl(
    webhook_url: str,
    now: datetime,
    events: list[CalendarEvent],
    tasks: list[AsanaTask],
    weather_slots: list[dict],  # [{label, temp, icon, description}, ...] from fetch_weather_slots()
) -> None:
    """Format data and POST to the TRMNL Private Plugin webhook."""
    if not webhook_url:
        raise ValueError("TRMNL_WEBHOOK_URL is not configured")

    today = now.astimezone(EASTERN).date()
    t = now.astimezone(EASTERN)
    hour = t.hour % 12 or 12
    ampm = "AM" if t.hour < 12 else "PM"
    generated_at = f"{t.strftime('%b')} {t.day}, {hour}:{t.strftime('%M')} {ampm}"

    event_groups = _shape_event_groups(events, today)
    shaped_tasks = _shape_tasks(tasks, today)
    shaped_slots = _shape_weather_slots(weather_slots)

    payload = {
        "merge_variables": {
            "generated_at": generated_at,
            "weather_slots": shaped_slots,
            "event_groups": event_groups,
            "tasks": shaped_tasks,
        }
    }

    with httpx.Client(timeout=15.0) as client:
        resp = client.post(webhook_url, json=payload)
        resp.raise_for_status()

    total_events = sum(len(g["events"]) for g in event_groups)
    print(
        f"[trmnl] Pushed: {len(shaped_slots)} weather slots, "
        f"{total_events} events in {len(event_groups)} days, "
        f"{len(shaped_tasks)} tasks — {generated_at}"
    )
