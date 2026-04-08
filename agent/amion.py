"""
AMION shift classifier — Python port of web/src/lib/calendar.ts.

Takes raw AMION calendar events (already filtered by iCalUID @amion.com or
calendar name "Caitie Work") and emits a list of "shift" events with a
shift type (training / day / night / 24hr / backup) keyed to a specific date.

Mirrors the web app's processAmionEvents() so the TRMNL display shows the
same labels and timing as the dashboard. Keep this file in sync with
web/src/lib/calendar.ts → processAmionEvents() if the rules change.
"""

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

from agent.models import CalendarEvent

ShiftKind = Literal["training", "day", "night", "24hr", "backup"]
AmionType = Literal[
    "skip", "vacation", "am", "pm", "backup", "nc-pool", "nc-call", "call", "rotation"
]

_WEEK_RE = re.compile(r"^Week\s+\d", re.IGNORECASE)
_VACATION_RE = re.compile(r"^(vacation|leave)$", re.IGNORECASE)
_NC_CALL_RE = re.compile(r"^Call:\s*NC-", re.IGNORECASE)
_NC_POOL_RE = re.compile(r"^NC-", re.IGNORECASE)


@dataclass
class AmionShift:
    """A processed AMION shift, ready for display."""

    date: date
    kind: ShiftKind
    start: datetime  # Local Eastern time
    end: datetime  # Local Eastern time


def classify_amion_title(title: str) -> AmionType:
    """Mirror of classifyAmionTitle() in web/src/lib/calendar.ts."""
    if _WEEK_RE.match(title):
        return "skip"
    if _VACATION_RE.match(title):
        return "vacation"
    if title.startswith("AM:"):
        return "am"
    if title.startswith("PM:"):
        return "pm"
    # Order matters: NC checks before generic SC, because some NC-call titles contain "SC"
    if _NC_CALL_RE.match(title):
        return "nc-call"
    if _NC_POOL_RE.match(title):
        return "nc-pool"
    if "SC" in title:
        return "backup"
    if title.startswith("Call:"):
        return "call"
    return "rotation"


def _is_weekend(d: date) -> bool:
    # Mon=0 .. Sun=6 in Python; weekend = Sat (5) or Sun (6)
    return d.weekday() >= 5


def _covered_dates(event: CalendarEvent) -> list[date]:
    """
    For multi-day all-day events (e.g. an SC1 backup block spanning a week),
    return every covered day. For everything else, return [start_date].

    Mirrors getCoveredDates() in web/src/lib/calendar.ts.
    """
    if event.all_day:
        # All-day events use exclusive end (Mon → next Mon = 7 days Mon-Sun)
        start_d = event.start.date()
        end_d = event.end.date()
        if end_d > start_d:
            return [start_d + timedelta(days=i) for i in range((end_d - start_d).days)]
    return [event.start.date()]


def _local_dt(d: date, hour: int, tz) -> datetime:
    return datetime(d.year, d.month, d.day, hour, 0, 0, tzinfo=tz)


def process_amion_events(
    raw_events: list[CalendarEvent],
    tz,
) -> list[AmionShift]:
    """
    Convert raw AMION events into a list of AmionShift entries.

    Mirrors processAmionEvents() in web/src/lib/calendar.ts. Returns one
    AmionShift per actual working shift; pool markers (e.g. bare "NC-11H")
    that don't represent real work do NOT produce a shift.
    """
    by_date: dict[date, list[tuple[AmionType, CalendarEvent]]] = defaultdict(list)

    for ev in raw_events:
        if not ev.is_amion:
            continue
        amion_type = classify_amion_title(ev.title)
        if amion_type == "skip":
            continue
        for d in _covered_dates(ev):
            by_date[d].append((amion_type, ev))

    shifts: list[AmionShift] = []

    for d, entries in by_date.items():
        types = [t for t, _ in entries]
        # NC-pool markers do not produce a shift on their own
        rotations = [e for t, e in entries if t == "rotation"]
        calls = [e for t, e in entries if t == "call"]
        backups = [e for t, e in entries if t == "backup"]
        ams = [e for t, e in entries if t == "am"]
        pms = [e for t, e in entries if t == "pm"]
        nc_calls = [e for t, e in entries if t == "nc-call"]
        is_vacation = "vacation" in types

        emitted_working = is_vacation
        next_d = d + timedelta(days=1)

        # 1. Night call (Call: NC-X) — the only "real" shift in an NC block
        if nc_calls:
            if _is_weekend(d):
                shifts.append(
                    AmionShift(
                        date=d,
                        kind="24hr",
                        start=_local_dt(d, 8, tz),
                        end=_local_dt(next_d, 8, tz),
                    )
                )
            else:
                shifts.append(
                    AmionShift(
                        date=d,
                        kind="night",
                        start=_local_dt(d, 16, tz),
                        end=_local_dt(next_d, 8, tz),
                    )
                )
            emitted_working = True

        # 2. AM: half-day morning → Training
        for _ in ams:
            shifts.append(
                AmionShift(
                    date=d,
                    kind="training",
                    start=_local_dt(d, 8, tz),
                    end=_local_dt(d, 12, tz),
                )
            )
            emitted_working = True

        # 3. PM: half-day afternoon → Training
        for _ in pms:
            shifts.append(
                AmionShift(
                    date=d,
                    kind="training",
                    start=_local_dt(d, 13, tz),
                    end=_local_dt(d, 17, tz),
                )
            )
            emitted_working = True

        # 4. Rotation blocks — only when nc-call didn't already handle this day
        if rotations and not nc_calls:
            if _is_weekend(d):
                if calls:
                    # Weekend rotation + call → 24Hr
                    shifts.append(
                        AmionShift(
                            date=d,
                            kind="24hr",
                            start=_local_dt(d, 8, tz),
                            end=_local_dt(next_d, 8, tz),
                        )
                    )
                    emitted_working = True
                # else: weekend rotation, no call → off, emit nothing
            else:
                # Weekday rotation → Day Shift
                shifts.append(
                    AmionShift(
                        date=d,
                        kind="day",
                        start=_local_dt(d, 8, tz),
                        end=_local_dt(d, 18, tz),
                    )
                )
                emitted_working = True

        # 5. Standalone regular call (no rotation on this day) → Day Shift
        if calls and not rotations and not emitted_working:
            shifts.append(
                AmionShift(
                    date=d,
                    kind="day",
                    start=_local_dt(d, 8, tz),
                    end=_local_dt(d, 18, tz),
                )
            )
            emitted_working = True

        # 6. Backup (SC) — only if nothing else was emitted
        if backups and not emitted_working:
            shifts.append(
                AmionShift(
                    date=d,
                    kind="backup",
                    start=_local_dt(d, 0, tz),
                    end=_local_dt(d, 0, tz),
                )
            )

    shifts.sort(key=lambda s: (s.date, s.start))
    return shifts


# ── Event ownership ──────────────────────────────────────────────────────────


def event_owner(event: CalendarEvent) -> Literal["nat", "caitie"]:
    """Mirror of eventOwner() in web/src/lib/calendar.ts."""
    if event.is_amion:
        return "caitie"
    if (event.organizer_email or "").lower() == "caitante@gmail.com":
        return "caitie"
    return "nat"


# ── Gus care ─────────────────────────────────────────────────────────────────

DROPOFF_HOUR = 7
PICKUP_HOUR = 17


@dataclass
class GusResponsibility:
    date: date
    pickup: Literal["nat", "caitie"]
    dropoff: Literal["nat", "caitie"]


def _shift_covers_pickup(shift: AmionShift) -> bool:
    if shift.kind == "backup":
        return False
    # Multi-day shift starting today: covers 5pm if it starts at/before 7pm
    if shift.end.date() != shift.date:
        return shift.start.hour <= PICKUP_HOUR + 2
    # Same-day: contains 5pm OR starts within 2 hours after 5pm
    if shift.start.hour <= PICKUP_HOUR and shift.end.hour > PICKUP_HOUR:
        return True
    if PICKUP_HOUR < shift.start.hour <= PICKUP_HOUR + 2:
        return True
    return False


def _shift_starts_by_morning(shift: AmionShift) -> bool:
    if shift.kind == "backup":
        return False
    return shift.start.hour <= 9 and shift.start.date() == shift.date


def _shift_runs_past_today_morning(shift: AmionShift, today: date) -> bool:
    if shift.kind == "backup":
        return False
    if shift.end.date() != today:
        return False
    return shift.end.hour > DROPOFF_HOUR


def _event_covers_pickup(ev: CalendarEvent) -> bool:
    if ev.all_day:
        return True
    start_d = ev.start.date()
    end_d = ev.end.date()
    if end_d != start_d:
        return ev.start.hour <= PICKUP_HOUR + 2
    if ev.start.hour <= PICKUP_HOUR and ev.end.hour > PICKUP_HOUR:
        return True
    if PICKUP_HOUR < ev.start.hour <= PICKUP_HOUR + 2:
        return True
    return False


def _event_starts_by_morning(ev: CalendarEvent, d: date) -> bool:
    if ev.start.date() != d:
        return False
    if ev.all_day:
        return True
    return ev.start.hour <= 9


def _event_runs_past_today_morning(ev: CalendarEvent, today: date) -> bool:
    if ev.end.date() != today:
        return False
    if ev.all_day:
        return False
    return ev.end.hour > DROPOFF_HOUR


def compute_gus_care(
    events: list[CalendarEvent],
    shifts: list[AmionShift],
    dates: list[date],
) -> dict[date, GusResponsibility]:
    """
    For each weekday in `dates`, decide whether Nat or Caitie handles
    Gus pickup (5pm) and dropoff (7am). Caitie defaults unless she has
    a shift or other event that conflicts with that hour.

    Mirrors computeGusCare() in web/src/lib/gus-care.ts.
    """
    # Index Caitie's regular events by start date
    caitie_events_by_date: dict[date, list[CalendarEvent]] = defaultdict(list)
    for ev in events:
        if event_owner(ev) != "caitie":
            continue
        if ev.is_amion:
            continue  # AMION events are represented via shifts
        caitie_events_by_date[ev.start.date()].append(ev)

    shifts_by_date: dict[date, list[AmionShift]] = defaultdict(list)
    for s in shifts:
        shifts_by_date[s.date].append(s)

    results: dict[date, GusResponsibility] = {}
    for d in dates:
        if _is_weekend(d):
            continue
        prev = d - timedelta(days=1)
        today_shifts = shifts_by_date.get(d, [])
        prev_shifts = shifts_by_date.get(prev, [])
        today_events = caitie_events_by_date.get(d, [])
        prev_events = caitie_events_by_date.get(prev, [])

        nat_pickup = (
            any(_shift_covers_pickup(s) for s in today_shifts)
            or any(_event_covers_pickup(e) for e in today_events)
        )
        nat_dropoff = (
            any(_shift_starts_by_morning(s) for s in today_shifts)
            or any(_shift_runs_past_today_morning(s, d) for s in prev_shifts)
            or any(_event_starts_by_morning(e, d) for e in today_events)
            or any(_event_runs_past_today_morning(e, d) for e in prev_events)
        )

        results[d] = GusResponsibility(
            date=d,
            pickup="nat" if nat_pickup else "caitie",
            dropoff="nat" if nat_dropoff else "caitie",
        )

    return results
