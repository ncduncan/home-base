"""
Core data models for Home-Base.

BriefingData is the central object that flows through the entire pipeline:
  collectors → briefing (AI enrichment) → publishers

It is also serializable to JSON for future e-ink display support.
"""

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


class CalendarEvent(BaseModel):
    id: str
    title: str
    start: datetime
    end: datetime
    location: Optional[str] = None
    description: Optional[str] = None
    all_day: bool = False
    calendar_id: str
    calendar_name: str = ""
    # AMION shift scheduling events get special handling in the briefing.
    # See CLAUDE.md section "AMION Calendar Nuances" — interpretation pending.
    is_amion: bool = False


class AsanaTask(BaseModel):
    gid: str
    name: str
    due_on: Optional[date] = None
    project: Optional[str] = None
    url: str
    notes: Optional[str] = None


class WeatherDay(BaseModel):
    date: date
    high_f: float
    low_f: float
    description: str
    precipitation_chance: int  # 0–100
    icon: str  # OpenWeatherMap icon code, e.g. "10d"


class WorkAwarenessEvent(BaseModel):
    """
    A personal calendar event that Nat's colleagues at GE Aerospace
    should be aware of. These are created as Google Calendar events
    with an invite to Nathaniel.duncan@geaerospace.com, which lands
    directly in his M365/Outlook inbox.
    """

    title: str  # e.g. "OOO: Vet appt (Gus) 2-3pm"
    start: datetime
    end: datetime
    note: str  # Why colleagues should know


class BriefingData(BaseModel):
    generated_at: datetime
    week_start: date
    week_end: date
    calendar_events: list[CalendarEvent]
    asana_tasks: list[AsanaTask]
    weather: list[WeatherDay]
    # Filled by agent/briefing.py after Claude AI call
    narrative: str = ""
    work_awareness_events: list[WorkAwarenessEvent] = []

    def to_json(self) -> str:
        """Serialize to JSON — used by e-ink display publisher."""
        return self.model_dump_json(indent=2)
