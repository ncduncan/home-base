"""
TRMNL e-ink display publisher.

Pushes a daily briefing to the TRMNL Private Plugin webhook in a 3-column
layout that mirrors the home-base web dashboard: today + next 2 days, with
each day split into family banners, a Caitie section, and a Nat section.

──────────────────────────────────────────────────────────────────────────────
TRMNL Liquid Template
Paste this into your Private Plugin markup on usetrmnl.com:
──────────────────────────────────────────────────────────────────────────────

<div class="screen screen--og">
  <div class="view view--full" style="display:flex;flex-direction:column;font-family:sans-serif;height:100%;">

    <div class="title_bar">
      <span class="title">Home Base</span>
      <span class="instance_label">{{ generated_at }}</span>
    </div>

    <!-- 3 day columns -->
    <div style="display:flex;flex:1;gap:4px;padding:4px;overflow:hidden;">
      {% for day in day_columns %}
      <div style="flex:1;border:1.5px solid #000;border-radius:4px;display:flex;flex-direction:column;overflow:hidden;background:#fff;">

        <!-- Day header -->
        <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 6px;background:{% if day.is_today %}#000;color:#fff{% else %}#f4f4f4{% endif %};border-bottom:1px solid #000;">
          <div>
            <div style="font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;">{{ day.weekday }}</div>
            <div style="font-size:13px;font-weight:bold;line-height:1;">{{ day.date_label }}</div>
          </div>
          {% if day.weather %}
          <div style="text-align:right;line-height:1;">
            <div style="font-size:14px;">{{ day.weather.emoji }}</div>
            <div style="font-size:9px;font-weight:bold;">{{ day.weather.high }}°/{{ day.weather.low }}°</div>
          </div>
          {% endif %}
        </div>

        <!-- Banner row (multi-day all-day events) -->
        {% for banner in day.banners %}
        <div style="font-size:10px;padding:2px 6px;background:#eee;border-bottom:1px solid #ccc;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ banner }}</div>
        {% endfor %}

        <!-- Caitie section -->
        <div style="background:#fff8e0;border-bottom:1px solid #000;padding:1px 6px;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#7a5c00;">Caitie</div>
        <div style="padding:2px 6px;font-size:10px;line-height:1.3;">
          {% if day.caitie.gus_dropoff %}<div style="color:#444;">↓ Gus dropoff <span style="color:#888;">7am</span></div>{% endif %}
          {% if day.caitie.gus_pickup %}<div style="color:#444;">↑ Gus pickup <span style="color:#888;">5pm</span></div>{% endif %}
          {% for item in day.caitie.items %}
          <div>
            <span style="font-weight:bold;">{{ item.label }}</span>{% if item.time %} <span style="color:#888;font-size:9px;">{{ item.time }}</span>{% endif %}
          </div>
          {% endfor %}
          {% for task in day.caitie.tasks %}
          <div style="color:#333;">{% if task.is_overdue %}<b>!</b> {% endif %}☐ {{ task.name }}</div>
          {% endfor %}
        </div>

        <!-- Nat section -->
        <div style="background:#dde5ff;border-top:1px solid #000;border-bottom:1px solid #000;padding:1px 6px;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#1a2e7a;">Nat</div>
        <div style="padding:2px 6px;font-size:10px;line-height:1.3;flex:1;">
          {% if day.nat.gus_dropoff %}<div style="color:#444;">↓ Gus dropoff <span style="color:#888;">7am</span></div>{% endif %}
          {% if day.nat.gus_pickup %}<div style="color:#444;">↑ Gus pickup <span style="color:#888;">5pm</span></div>{% endif %}
          {% for item in day.nat.items %}
          <div>
            <span style="font-weight:bold;">{{ item.label }}</span>{% if item.time %} <span style="color:#888;font-size:9px;">{{ item.time }}</span>{% endif %}
          </div>
          {% endfor %}
          {% for task in day.nat.tasks %}
          <div style="color:#333;">{% if task.is_overdue %}<b>!</b> {% endif %}☐ {{ task.name }}</div>
          {% endfor %}
        </div>

      </div>
      {% endfor %}
    </div>
  </div>
</div>

──────────────────────────────────────────────────────────────────────────────
"""

import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from agent.amion import (
    AmionShift,
    compute_gus_care,
    event_owner,
    process_amion_events,
)
from agent.models import AsanaTask, CalendarEvent

EASTERN = ZoneInfo("America/New_York")

NUM_DAYS = 3  # today + next 2 days
MAX_TASKS_PER_OWNER = 4

_SHIFT_LABELS = {
    "training": "Training",
    "day": "Day Shift",
    "night": "Night Shift",
    "24hr": "24Hr",
    "backup": "Backup",
}

_ICON_EMOJI = {
    "01": "☀",
    "02": "🌤",
    "03": "⛅",
    "04": "☁",
    "09": "🌧",
    "10": "🌦",
    "11": "⛈",
    "13": "❄",
    "50": "🌫",
}

# Filter AMION admin events like "Week 14 of 2026"
_WEEK_RE = re.compile(r"^week\s+\d+\s+of\s+\d+", re.IGNORECASE)
_SKIP_TITLES = {"Leave", "Vacation"}


def _weather_emoji(icon: str) -> str:
    return _ICON_EMOJI.get((icon or "")[:2], "🌡")


def _format_hour(dt: datetime) -> str:
    h = dt.hour % 12 or 12
    suffix = "a" if dt.hour < 12 else "p"
    return f"{h}{suffix}"


def _format_shift_time(shift: AmionShift) -> str:
    if shift.kind == "backup":
        return "all day"
    if shift.start.date() != shift.end.date():
        return f"{_format_hour(shift.start)}–{_format_hour(shift.end)} +1"
    return f"{_format_hour(shift.start)}–{_format_hour(shift.end)}"


def _format_event_time(event: CalendarEvent) -> str:
    if event.all_day:
        return ""
    start = event.start.astimezone(EASTERN)
    return _format_hour(start)


def _is_banner(event: CalendarEvent) -> bool:
    """Multi-day all-day non-AMION events display as family banners."""
    if not event.all_day or event.is_amion:
        return False
    span = (event.end.date() - event.start.date()).days
    return span >= 2  # spans more than one calendar day


def _event_covers_date(event: CalendarEvent, d: date) -> bool:
    """For all-day events, end is exclusive; for timed, match start day."""
    if event.all_day:
        return event.start.date() <= d < event.end.date()
    return event.start.astimezone(EASTERN).date() == d


def _build_weather_by_date(weather_days) -> dict[date, dict]:
    out: dict[date, dict] = {}
    for w in weather_days or []:
        out[w.date] = {
            "emoji": _weather_emoji(w.icon),
            "high": round(w.high_f),
            "low": round(w.low_f),
        }
    return out


def _shape_owner_section(
    items: list[dict],
    tasks: list[AsanaTask],
) -> dict:
    return {
        "items": items,
        "tasks": [
            {"name": t.name, "is_overdue": t.due_on is not None and t.due_on < date.today()}
            for t in tasks[:MAX_TASKS_PER_OWNER]
        ],
    }


def _build_day_columns(
    today: date,
    events: list[CalendarEvent],
    tasks: list[AsanaTask],
    weather_days,
) -> list[dict]:
    """
    Produce 3 day_column dicts (today + next 2). Each column has banners +
    Caitie/Nat sections with shift labels, regular events, and tasks.
    """
    dates = [today + timedelta(days=i) for i in range(NUM_DAYS)]

    # Run AMION events through the same shift classifier the web app uses
    shifts = process_amion_events(events, EASTERN)
    shifts_by_date: dict[date, list[AmionShift]] = defaultdict(list)
    for s in shifts:
        shifts_by_date[s.date].append(s)

    # Compute Gus care responsibilities for the visible window
    gus_by_date = compute_gus_care(events, shifts, dates)

    weather_by_date = _build_weather_by_date(weather_days)

    columns: list[dict] = []
    for d in dates:
        # Banner events spanning multiple days
        banners = [
            ev.title
            for ev in events
            if _is_banner(ev) and _event_covers_date(ev, d)
        ]

        # Per-owner regular events (timed or single-day all-day, non-AMION)
        caitie_items: list[dict] = []
        nat_items: list[dict] = []

        # First: AMION shift labels for Caitie
        for shift in shifts_by_date.get(d, []):
            caitie_items.append(
                {
                    "label": _SHIFT_LABELS.get(shift.kind, shift.kind),
                    "time": _format_shift_time(shift),
                }
            )

        for ev in events:
            if ev.is_amion:
                continue
            if _is_banner(ev):
                continue
            if not _event_covers_date(ev, d):
                continue
            title = ev.title
            if _WEEK_RE.match(title) or title in _SKIP_TITLES:
                continue
            if title in ("Gus pickup", "Gus dropoff"):
                continue  # synthetic dropoff/pickup invites — shown as pills
            entry = {"label": title, "time": _format_event_time(ev)}
            if event_owner(ev) == "caitie":
                caitie_items.append(entry)
            else:
                nat_items.append(entry)

        # Per-owner tasks due on this day (overdue items roll into today)
        caitie_tasks: list[AsanaTask] = []
        nat_tasks: list[AsanaTask] = []
        for t in tasks:
            if t.due_on is None:
                continue
            include_today = (d == today and t.due_on <= today)
            include_due = (t.due_on == d)
            if not (include_today or include_due):
                continue
            is_caitie = (t.assignee_name or "").lower().startswith("cait")
            (caitie_tasks if is_caitie else nat_tasks).append(t)

        gus = gus_by_date.get(d)
        nat_dropoff = bool(gus and gus.dropoff == "nat")
        nat_pickup = bool(gus and gus.pickup == "nat")
        # Caitie pills only show on weekdays (gus_by_date skips weekends)
        caitie_dropoff = bool(gus and gus.dropoff == "caitie")
        caitie_pickup = bool(gus and gus.pickup == "caitie")

        columns.append(
            {
                "weekday": d.strftime("%a").upper(),
                "date_label": f"{d.strftime('%b')} {d.day}",
                "is_today": d == today,
                "weather": weather_by_date.get(d),
                "banners": banners,
                "caitie": {
                    "gus_dropoff": caitie_dropoff,
                    "gus_pickup": caitie_pickup,
                    **_shape_owner_section(caitie_items, caitie_tasks),
                },
                "nat": {
                    "gus_dropoff": nat_dropoff,
                    "gus_pickup": nat_pickup,
                    **_shape_owner_section(nat_items, nat_tasks),
                },
            }
        )

    return columns


def push_to_trmnl(
    webhook_url: str,
    now: datetime,
    events: list[CalendarEvent],
    tasks: list[AsanaTask],
    weather_days,  # list[WeatherDay] from fetch_boston_forecast()
) -> None:
    """Format data and POST to the TRMNL Private Plugin webhook."""
    if not webhook_url:
        raise ValueError("TRMNL_WEBHOOK_URL is not configured")

    today = now.astimezone(EASTERN).date()
    t = now.astimezone(EASTERN)
    hour = t.hour % 12 or 12
    ampm = "AM" if t.hour < 12 else "PM"
    generated_at = f"{t.strftime('%b')} {t.day}, {hour}:{t.strftime('%M')} {ampm}"

    day_columns = _build_day_columns(today, events, tasks, weather_days)

    payload = {
        "merge_variables": {
            "generated_at": generated_at,
            "day_columns": day_columns,
        }
    }

    with httpx.Client(timeout=15.0) as client:
        resp = client.post(webhook_url, json=payload)
        resp.raise_for_status()

    total_items = sum(
        len(col["caitie"]["items"]) + len(col["nat"]["items"]) for col in day_columns
    )
    print(
        f"[trmnl] Pushed: {len(day_columns)} day columns, "
        f"{total_items} items — {generated_at}"
    )
