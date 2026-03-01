"""
Calendar invites publisher.

For each WorkAwarenessEvent identified by Claude, creates a Google Calendar
event on Nate's personal calendar and adds his work email as an attendee.
The invite is delivered to Nathaniel.duncan@geaerospace.com and appears
directly in his M365/Outlook inbox and calendar — no M365 API needed.

Events are marked as "transparent" (free) on Nate's personal calendar
so they don't block personal availability there.
"""

from zoneinfo import ZoneInfo

from googleapiclient.discovery import build

from agent.collectors.calendar import load_credentials
from agent.config import settings
from agent.models import BriefingData, WorkAwarenessEvent

EASTERN = ZoneInfo("America/New_York")


def _build_event_body(event: WorkAwarenessEvent) -> dict:
    def iso(dt):
        return dt.astimezone(EASTERN).isoformat()

    return {
        "summary": event.title,
        "description": event.note,
        "start": {"dateTime": iso(event.start), "timeZone": "America/New_York"},
        "end": {"dateTime": iso(event.end), "timeZone": "America/New_York"},
        "attendees": [
            # Nate's work email — Outlook receives the invite
            {"email": settings.work_email, "responseStatus": "needsAction"},
        ],
        # Free on personal calendar so it doesn't block personal availability
        "transparency": "transparent",
        "reminders": {"useDefault": False, "overrides": []},
    }


def create_work_awareness_events(data: BriefingData) -> None:
    if settings.briefing_dry_run:
        if data.work_awareness_events:
            print(
                f"[calendar] DRY RUN — would create {len(data.work_awareness_events)} "
                "work awareness event(s):"
            )
            for e in data.work_awareness_events:
                print(f"  → {e.title}  ({e.start.strftime('%-I:%M%p')}–{e.end.strftime('%-I:%M%p %a %b %-d')})")
        else:
            print("[calendar] DRY RUN — no work awareness events identified.")
        return

    if not data.work_awareness_events:
        print("[calendar] No work awareness events to create.")
        return

    creds = load_credentials()
    service = build("calendar", "v3", credentials=creds)

    for event in data.work_awareness_events:
        body = _build_event_body(event)
        try:
            service.events().insert(
                calendarId="primary",
                body=body,
                sendUpdates="all",  # Sends email invite to attendees
            ).execute()
            print(f"[calendar] Invite sent: '{event.title}' → {settings.work_email}")
        except Exception as e:
            print(f"[calendar] Failed to create '{event.title}': {e}")
