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
    # AMION shift scheduling events get special handling. Detected via either
    # the calendar name OR an iCalUID containing '@amion.com' (more reliable).
    is_amion: bool = False
    i_cal_uid: Optional[str] = None
    organizer_email: Optional[str] = None


class AsanaTask(BaseModel):
    gid: str
    name: str
    due_on: Optional[date] = None
    project: Optional[str] = None
    url: str
    notes: Optional[str] = None
    assignee_name: Optional[str] = None


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


# ── Financial Market Dashboard ────────────────────────────────────────────────


class MonthlyDataPoint(BaseModel):
    """One month of historical data for the trend chart."""

    month: str  # "2024-04"
    cape: Optional[float] = None
    treasury_10yr: Optional[float] = None
    excess_yield: Optional[float] = None


class MarketSnapshot(BaseModel):
    """All financial metrics for a single TRMNL dashboard update."""

    timestamp: datetime
    sp500_ttm_return: float  # e.g. 0.12 for 12%
    cape_ratio: float  # e.g. 33.5
    treasury_10yr: float  # e.g. 4.25 (percent)
    excess_yield: float  # earnings yield minus treasury
    projected_10yr_return: float  # real, from CAPE regression
    # Nice-to-have secondary metrics
    cpi_yoy: Optional[float] = None  # e.g. 3.1 (percent)
    gdp_growth: Optional[float] = None  # e.g. 2.4 (percent)
    oil_price: Optional[float] = None  # e.g. 68.50 (USD)
    # 24-month history for the trend chart
    history: list[MonthlyDataPoint] = []
