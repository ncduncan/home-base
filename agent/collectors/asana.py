"""
Asana collector.

Fetches incomplete tasks assigned to Nat that are due by end of weekend
(or have no due date — those are shown as "no deadline" reminders).

Uses the Asana REST API directly via httpx (avoids SDK version churn).
Auth: Personal Access Token stored as ASANA_PAT secret.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")

import httpx

from agent.config import settings
from agent.models import AsanaTask

ASANA_BASE = "https://app.asana.com/api/1.0"


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.asana_pat}"}


def fetch_week_tasks(week_end: date) -> list[AsanaTask]:
    """
    Fetch incomplete tasks assigned to me that are past due, due today, or due
    within the coming week (up to week_end). Tasks with no due date are excluded.

    'completed_since=now' returns only incomplete tasks (Asana API convention).
    """
    today = datetime.now(tz=EASTERN).date()
    params: dict[str, str] = {
        "assignee": "me",
        "workspace": settings.asana_workspace_gid,
        "completed_since": "now",
        "opt_fields": "gid,name,due_on,notes,memberships.project.name,permalink_url",
        "limit": "100",
    }

    if settings.asana_project_gid:
        # Scope to a specific project if configured
        url = f"{ASANA_BASE}/projects/{settings.asana_project_gid}/tasks"
        params.pop("workspace", None)
        params.pop("assignee", None)
    else:
        url = f"{ASANA_BASE}/tasks"

    tasks: list[AsanaTask] = []

    with httpx.Client(timeout=20.0) as client:
        # Handle Asana pagination
        while True:
            resp = client.get(url, headers=_headers(), params=params)
            try:
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                print(f"[asana] HTTP error {e.response.status_code}: {e.response.text}")
                break

            data = resp.json()

            for item in data.get("data", []):
                due_on = item.get("due_on")
                due_date = date.fromisoformat(due_on) if due_on else None

                memberships = item.get("memberships") or []
                project_name: str | None = None
                if memberships:
                    project = memberships[0].get("project") or {}
                    project_name = project.get("name")

                raw_notes = item.get("notes") or ""
                tasks.append(
                    AsanaTask(
                        gid=item["gid"],
                        name=item["name"],
                        due_on=due_date,
                        project=project_name,
                        url=item.get(
                            "permalink_url",
                            f"https://app.asana.com/0/0/{item['gid']}",
                        ),
                        notes=raw_notes[:200] if raw_notes else None,
                    )
                )

            # Follow next_page cursor if present
            next_page = data.get("next_page")
            if next_page and next_page.get("offset"):
                params["offset"] = next_page["offset"]
            else:
                break

    # Keep only tasks that are past due, due today, or due within the week window
    tasks = [t for t in tasks if t.due_on is not None and t.due_on <= week_end]

    # Sort: overdue/soonest first
    tasks.sort(key=lambda t: t.due_on)
    return tasks
