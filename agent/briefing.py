"""
AI briefing generator.

Sends collected data to Gemini and receives a concise Sunday morning narrative
for Nat. AMION shift interpretation is the primary AI task; everything else
(calendar filtering, Asana filtering, work awareness events) is handled
deterministically in Python before this step.
"""

import time

import httpx

from agent.config import settings
from agent.models import BriefingData

SYSTEM_PROMPT = """\
You are Home-Base, a personal assistant for Nathaniel Duncan (Nat).

Your job each Sunday morning is to write a clear, friendly weekly briefing.

About Nat:
- Lives in Boston, MA
- Works at GE Aerospace (work email: Nathaniel.duncan@geaerospace.com)
- Personal Gmail: ncduncan@gmail.com
- "Gus" is his dog

Tone: warm, direct — like a well-organized friend giving a heads-up over coffee.
No filler phrases ("Certainly!", "Great news!"). 2–4 short paragraphs, plain prose.

AMION SHIFTS (from the "Caitie Work" calendar):
These are medical shift scheduling events. Common codes:
- Events starting with "Call" = on-call shift (likely all or most of the day)
- Other short codes (e.g. "DAY", "NIGHT", "ONC") = scheduled shift
- Interpret these for Nat clearly: what kind of shift and when.
Vacation and Leave events are already filtered out — ignore references to them.
"""

BRIEFING_PROMPT = """\
Today is Sunday, {today}. Here is Nat's data for the week of {week_start}–{week_end}.

CALENDAR EVENTS:
{events}

ASANA TASKS (past due or due this week):
{tasks}

BOSTON WEATHER:
{weather}

Write a friendly Sunday morning briefing in 2–4 short paragraphs. Cover:
- What the week looks like at a glance (busy vs light, any notable days)
- AMION shifts: interpret the shift codes clearly and call out any on-call days
- Any urgent Asana tasks to handle today
- Weather highlights (rain, cold snaps, or anything worth noting)

Plain prose only — no bullet points, no headers, no markdown.
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


def generate_briefing(data: BriefingData) -> BriefingData:
    """
    Call Gemini to generate the narrative. Returns BriefingData with narrative set.
    Work awareness events are generated deterministically in main.py.
    """
    prompt = BRIEFING_PROMPT.format(
        today=data.generated_at.strftime("%A, %B %-d, %Y"),
        week_start=data.week_start.strftime("%B %-d"),
        week_end=data.week_end.strftime("%B %-d, %Y"),
        events=_fmt_events(data),
        tasks=_fmt_tasks(data),
        weather=_fmt_weather(data),
    )

    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 600},
    }

    # Try primary model, then fall back to gemini-1.5-flash if still rate-limited.
    models_to_try = [settings.gemini_model]
    if settings.gemini_model != "gemini-1.5-flash":
        models_to_try.append("gemini-1.5-flash")

    resp = None
    with httpx.Client(timeout=60.0) as client:
        for model in models_to_try:
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models"
                f"/{model}:generateContent"
            )
            for attempt, default_delay in enumerate([0, 30, 60, 120]):
                if default_delay:
                    retry_after = int(resp.headers.get("Retry-After", default_delay))
                    print(
                        f"  [gemini/{model}] rate-limited; retrying in {retry_after}s"
                        f" (attempt {attempt + 1}/4)..."
                    )
                    time.sleep(retry_after)
                resp = client.post(url, json=payload, params={"key": settings.gemini_api_key})
                if resp.status_code != 429:
                    break
            if resp.status_code != 429:
                break
            print(f"  [gemini/{model}] exhausted retries; trying fallback model...")
    resp.raise_for_status()

    data.narrative = resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
    return data
