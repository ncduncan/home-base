"""
Weather collector.

Fetches the 7-day forecast for Boston, MA from OpenWeatherMap.
Attempts OneCall API 3.0 (requires paid subscription) and falls back
automatically to the free 5-day/3-hour forecast API if unavailable.

All temperatures are in Fahrenheit (imperial units).
"""

from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from agent.config import settings
from agent.models import WeatherDay

EASTERN = ZoneInfo("America/New_York")
OWM_BASE = "https://api.openweathermap.org"


def _geocode(client: httpx.Client) -> tuple[float, float]:
    """Resolve city name to lat/lon via OWM geocoding API."""
    resp = client.get(
        f"{OWM_BASE}/geo/1.0/direct",
        params={
            "q": settings.weather_city,
            "limit": 1,
            "appid": settings.openweathermap_api_key,
        },
    )
    resp.raise_for_status()
    data = resp.json()
    if not data:
        raise ValueError(f"No geocoding results for '{settings.weather_city}'")
    return data[0]["lat"], data[0]["lon"]


def _fetch_onecall(client: httpx.Client, lat: float, lon: float) -> list[WeatherDay] | None:
    """
    OneCall API 3.0 — 7-day daily forecast.
    Returns None if the API key doesn't have a OneCall subscription (HTTP 401).
    """
    resp = client.get(
        f"{OWM_BASE}/data/3.0/onecall",
        params={
            "lat": lat,
            "lon": lon,
            "exclude": "current,minutely,hourly,alerts",
            "units": "imperial",
            "appid": settings.openweathermap_api_key,
        },
    )
    if resp.status_code == 401:
        return None  # Fall back to free tier
    resp.raise_for_status()
    data = resp.json()

    days: list[WeatherDay] = []
    for day_data in data.get("daily", [])[:7]:
        dt = datetime.fromtimestamp(day_data["dt"], tz=EASTERN)
        weather = (day_data.get("weather") or [{}])[0]
        days.append(
            WeatherDay(
                date=dt.date(),
                high_f=round(day_data["temp"]["max"], 1),
                low_f=round(day_data["temp"]["min"], 1),
                description=weather.get("description", "").title(),
                precipitation_chance=int(day_data.get("pop", 0) * 100),
                icon=weather.get("icon", "01d"),
            )
        )
    return days


def _fetch_5day_fallback(client: httpx.Client, lat: float, lon: float) -> list[WeatherDay]:
    """
    Free 5-day / 3-hour forecast fallback.
    Groups 3-hour intervals by calendar day; uses max/min temps and
    the highest precipitation probability across intervals in that day.
    """
    resp = client.get(
        f"{OWM_BASE}/data/2.5/forecast",
        params={
            "lat": lat,
            "lon": lon,
            "units": "imperial",
            "appid": settings.openweathermap_api_key,
        },
    )
    resp.raise_for_status()
    data = resp.json()

    day_groups: dict[date, list[dict]] = defaultdict(list)
    for item in data["list"]:
        dt = datetime.fromtimestamp(item["dt"], tz=EASTERN)
        day_groups[dt.date()].append(item)

    days: list[WeatherDay] = []
    for day_date in sorted(day_groups.keys()):
        items = day_groups[day_date]
        temps = [i["main"]["temp"] for i in items]
        precips = [i.get("pop", 0) for i in items]
        midday = items[len(items) // 2]
        weather = (midday.get("weather") or [{}])[0]
        days.append(
            WeatherDay(
                date=day_date,
                high_f=round(max(temps), 1),
                low_f=round(min(temps), 1),
                description=weather.get("description", "").title(),
                precipitation_chance=int(max(precips) * 100),
                icon=weather.get("icon", "01d"),
            )
        )

    return days[:7]


def fetch_weather_slots(days_ahead: int = 3) -> list[dict]:
    """
    Return AM (≈9am) and PM (≈3pm) weather slots for the next days_ahead days.
    Each slot: {label: str, temp: int|None, icon: str}
    Always uses the free 5-day/3-hour forecast API.
    """
    with httpx.Client(timeout=15.0) as client:
        lat, lon = _geocode(client)
        resp = client.get(
            f"{OWM_BASE}/data/2.5/forecast",
            params={
                "lat": lat,
                "lon": lon,
                "units": "imperial",
                "appid": settings.openweathermap_api_key,
            },
        )
        resp.raise_for_status()
        items = resp.json()["list"]

    now = datetime.now(tz=EASTERN)
    today = now.date()

    # Group 3-hour forecast items by date
    by_day: dict[date, list[tuple[int, dict]]] = defaultdict(list)
    for item in items:
        dt = datetime.fromtimestamp(item["dt"], tz=EASTERN)
        d = dt.date()
        if today <= d < today + timedelta(days=days_ahead):
            by_day[d].append((dt.hour, item))

    slots: list[dict] = []
    for offset in range(days_ahead):
        d = today + timedelta(days=offset)
        day_items = by_day.get(d, [])

        if offset == 0:
            day_label = "Today"
        elif offset == 1:
            day_label = "Tmrw"
        else:
            day_label = d.strftime("%a")

        for period, target_hour in (("AM", 9), ("PM", 15)):
            if day_items:
                _, best = min(day_items, key=lambda x: abs(x[0] - target_hour))
                weather_info = (best.get("weather") or [{}])[0]
                slots.append({
                    "label": f"{day_label} {period}",
                    "temp": round(best["main"]["temp"]),
                    "icon": weather_info.get("icon", "01d"),
                })
            else:
                slots.append({"label": f"{day_label} {period}", "temp": None, "icon": "01d"})

    return slots


def fetch_boston_forecast() -> list[WeatherDay]:
    """
    Fetch the 7-day weather forecast for Boston, MA.
    Tries OneCall 3.0 first; falls back to the free 5-day API.
    """
    with httpx.Client(timeout=15.0) as client:
        lat, lon = _geocode(client)
        days = _fetch_onecall(client, lat, lon)
        if days is None:
            print("[weather] OneCall not available; using free 5-day forecast fallback.")
            days = _fetch_5day_fallback(client, lat, lon)
    return days
