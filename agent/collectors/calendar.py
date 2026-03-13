"""
Google Calendar collector.

Reads all events from Nat's personal Google Calendar (ncduncan@gmail.com)
for the upcoming week. Also detects AMION shift events — see CLAUDE.md for
the pending AMION interpretation clarification.

Auth: single OAuth credential covering calendar.readonly, calendar.events,
and gmail.send. Credentials auto-refresh using the stored refresh token.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from dateutil import parser as dtparser
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from agent.config import settings
from agent.models import CalendarEvent

EASTERN = ZoneInfo("America/New_York")

SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.send",
]


def load_credentials() -> Credentials:
    """
    Load Google OAuth credentials from the token file and refresh if expired.
    The token.json file contains client_id, client_secret, and refresh_token,
    so it is self-contained for refreshing without the client_secret.json file.
    """
    creds = Credentials.from_authorized_user_file(settings.google_token_path, SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        # Persist the refreshed access token back to disk for the duration of this run
        with open(settings.google_token_path, "w") as f:
            f.write(creds.to_json())
    return creds


def get_service(service_name: str, version: str):
    return build(service_name, version, credentials=load_credentials())


AMION_CALENDAR_NAME = "Caitie Work"

# AMION event titles to always skip
_AMION_SKIP_TITLES = {"Vacation", "Leave"}


def _is_amion_event(cal_name: str) -> bool:
    """AMION shift events come from the 'Caitie Work' calendar subscription."""
    return cal_name == AMION_CALENDAR_NAME


def _should_skip_amion_event(raw: dict) -> bool:
    """
    Filter out AMION events that should not appear in the briefing:
    - Vacation / Leave events (not actionable shift info)
    - All-day recurring events (these duplicate the timed 'Call'-prefixed shift events)
    """
    title = raw.get("summary", "")
    if title in _AMION_SKIP_TITLES:
        return True
    start_raw = raw.get("start", {})
    all_day = "date" in start_raw and "dateTime" not in start_raw
    if all_day and raw.get("recurringEventId"):
        return True
    return False


def _parse_event(raw: dict, cal_id: str, cal_name: str) -> CalendarEvent | None:
    start_raw = raw.get("start", {})
    end_raw = raw.get("end", {})
    all_day = "date" in start_raw and "dateTime" not in start_raw

    if all_day:
        start_dt = datetime.fromisoformat(start_raw["date"]).replace(tzinfo=EASTERN)
        end_dt = datetime.fromisoformat(end_raw["date"]).replace(tzinfo=EASTERN)
    else:
        start_dt = dtparser.parse(start_raw["dateTime"])
        end_dt = dtparser.parse(end_raw["dateTime"])

    return CalendarEvent(
        id=raw["id"],
        title=raw.get("summary", "(No title)"),
        start=start_dt,
        end=end_dt,
        location=raw.get("location"),
        description=raw.get("description"),
        all_day=all_day,
        calendar_id=cal_id,
        calendar_name=cal_name,
        is_amion=_is_amion_event(cal_name),
    )


def fetch_week_events(week_start: datetime, week_end: datetime) -> list[CalendarEvent]:
    """
    Fetch all calendar events across all of Nat's Google calendars for the given window.
    Events are returned sorted by start time.
    """
    service = get_service("calendar", "v3")
    calendars = service.calendarList().list().execute().get("items", [])

    all_events: list[CalendarEvent] = []

    for cal in calendars:
        cal_id = cal["id"]
        cal_name = cal.get("summary", cal_id)

        # Skip calendars that are hidden/rejected by the user
        if cal.get("selected") is False:
            continue

        try:
            result = (
                service.events()
                .list(
                    calendarId=cal_id,
                    timeMin=week_start.isoformat(),
                    timeMax=week_end.isoformat(),
                    singleEvents=True,
                    orderBy="startTime",
                    maxResults=250,
                )
                .execute()
            )
            for raw in result.get("items", []):
                if raw.get("status") == "cancelled":
                    continue
                if _is_amion_event(cal_name) and _should_skip_amion_event(raw):
                    continue
                event = _parse_event(raw, cal_id, cal_name)
                if event:
                    all_events.append(event)
        except Exception as e:
            print(f"[calendar] Warning: skipped calendar '{cal_name}': {e}")

    all_events.sort(key=lambda e: e.start)
    return all_events
