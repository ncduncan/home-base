"""
AI briefing generator.

Sends all collected data to Gemini and receives:
  1. A warm, concise Sunday morning narrative for Nate
  2. A list of personal calendar events that warrant work awareness at GE Aerospace

The work awareness events are then created as Google Calendar invites sent to
Nathaniel.duncan@geaerospace.com, appearing directly in his M365/Outlook inbox.
"""

import json
import re
import time
from datetime import datetime

import httpx

from agent.config import settings
from agent.models import BriefingData, WorkAwarenessEvent

SYSTEM_PROMPT = """\
You are Home-Base, a personal assistant for Nathaniel Duncan (Nate).

Your job each Sunday morning is to write a clear, friendly weekly briefing and
identify which of Nate's personal calendar events his colleagues at GE Aerospace
should be aware of.

About Nate:
- Lives in Boston, MA
- Works at GE Aerospace; work email: Nathaniel.duncan@geaerospace.com
- Personal Gmail: ncduncan@gmail.com
- "Gus" is his dog

Tone: warm, direct, helpful — like a well-organized friend giving a heads-up over
coffee. No filler phrases ("Certainly!", "Great news!"). Short paragraphs.
Use plain prose — no bullet points in the narrative section.

AMION SCHEDULING NOTE:
Nate's calendar includes AMION shift events (medical/shift scheduling system).
⚠️  AMION interpretation is PENDING clarification from Nate.
For now, include AMION events in the briefing as-is, noting the shift code.
Flag any AMION events in your narrative so Nate can verify they're correct.
"""

BRIEFING_PROMPT = """\
Today is Sunday, {today}. Here is Nate's data for the week of {week_start} through {week_end}.

== CALENDAR EVENTS (upcoming week) ==
{events}

== ASANA TASKS (incomplete — should be actioned before the weekend ends) ==
{tasks}

== BOSTON WEATHER (7-day forecast) ==
{weather}

Please produce a JSON response with exactly these two keys:

1. "narrative" — A friendly Sunday morning briefing in 2–4 short paragraphs.
   Cover: what the week looks like at a glance, anything urgent to finish today,
   weather highlights (especially rain, cold snaps, or any day worth calling out),
   and any scheduling notes Nate should be aware of (conflicts, tight days, etc.).
   If there are AMION shift events, mention them and note that the codes are
   pending interpretation. Keep it tight — Nate is reading this over coffee.

2. "work_awareness_events" — A JSON array of personal calendar events from the
   list above that Nate's GE Aerospace colleagues should be aware of because they
   affect his work-hours availability (e.g., doctor appointments, vet visits,
   picking up Gus, school events, medical procedures, personal obligations during
   9am–6pm weekdays).

   Only include weekday events between 8am–7pm that a reasonable manager or
   colleague would want a heads-up about. Exclude purely work events, evening
   events, and weekend-only events that don't affect work hours.

   Each object in the array:
   {{
     "title": "OOO: [brief, professional description]",
     "start": "<ISO8601 datetime with timezone offset>",
     "end": "<ISO8601 datetime with timezone offset>",
     "note": "<one sentence: why colleagues should know>"
   }}

   Return [] if no events qualify.

Respond with valid JSON only — no markdown, no code fences, no extra text.
"""


def _fmt_events(data: BriefingData) -> str:
    if not data.calendar_events:
        return "  No events this week."
    lines = []
    for e in data.calendar_events:
        amion = " [AMION SHIFT — code pending interpretation]" if e.is_amion else ""
        if e.all_day:
            time_str = f"{e.start.strftime('%a %b %-d')} (all day)"
        else:
            time_str = (
                f"{e.start.strftime('%a %b %-d')} "
                f"{e.start.strftime('%-I:%M%p')}–{e.end.strftime('%-I:%M%p')}"
            )
        loc = f" @ {e.location}" if e.location else ""
        lines.append(f"  • {time_str}: {e.title}{loc}{amion}")
    return "\n".join(lines)


def _fmt_tasks(data: BriefingData) -> str:
    if not data.asana_tasks:
        return "  No incomplete tasks."
    lines = []
    for t in data.asana_tasks:
        due = t.due_on.strftime("%b %-d") if t.due_on else "no due date"
        proj = f" [{t.project}]" if t.project else ""
        lines.append(f"  • [{due}]{proj} {t.name}")
    return "\n".join(lines)


def _fmt_weather(data: BriefingData) -> str:
    if not data.weather:
        return "  No weather data."
    lines = []
    for w in data.weather:
        precip = f", {w.precipitation_chance}% chance of precip" if w.precipitation_chance > 10 else ""
        lines.append(
            f"  • {w.date.strftime('%a %b %-d')}: {w.description}, "
            f"High {w.high_f:.0f}°F / Low {w.low_f:.0f}°F{precip}"
        )
    return "\n".join(lines)


def _parse_response(text: str) -> dict:
    """Parse Claude's JSON response, handling accidental markdown fences."""
    text = text.strip()
    # Strip ```json ... ``` or ``` ... ``` wrappers if present
    fence_match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if fence_match:
        text = fence_match.group(1)
    return json.loads(text)


def generate_briefing(data: BriefingData) -> BriefingData:
    """
    Call Claude to generate the narrative and identify work awareness events.
    Mutates and returns the BriefingData object with narrative and
    work_awareness_events populated.
    """
    prompt = BRIEFING_PROMPT.format(
        today=data.generated_at.strftime("%A, %B %-d, %Y"),
        week_start=data.week_start.strftime("%B %-d"),
        week_end=data.week_end.strftime("%B %-d, %Y"),
        events=_fmt_events(data),
        tasks=_fmt_tasks(data),
        weather=_fmt_weather(data),
    )

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models"
        f"/{settings.gemini_model}:generateContent"
    )
    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 2048},
    }
    with httpx.Client(timeout=60.0) as client:
        for attempt, delay in enumerate([0, 30, 60, 120]):
            if delay:
                print(f"  [gemini] rate-limited; retrying in {delay}s (attempt {attempt + 1}/4)...")
                time.sleep(delay)
            resp = client.post(url, json=payload, params={"key": settings.gemini_api_key})
            if resp.status_code != 429:
                break
        resp.raise_for_status()

    text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
    result = _parse_response(text)
    data.narrative = result.get("narrative", "")

    work_events_raw = result.get("work_awareness_events") or []
    data.work_awareness_events = [
        WorkAwarenessEvent(
            title=e["title"],
            start=datetime.fromisoformat(e["start"]),
            end=datetime.fromisoformat(e["end"]),
            note=e.get("note", ""),
        )
        for e in work_events_raw
    ]

    return data
