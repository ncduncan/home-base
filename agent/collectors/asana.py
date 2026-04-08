"""
Asana collector.

Fetches incomplete tasks assigned to Nat that are due by end of weekend
(or have no due date — those are shown as "no deadline" reminders).

Uses the Asana REST API directly via httpx (avoids SDK version churn).
Auth: Personal Access Token stored as ASANA_PAT secret.
"""

from datetime import date
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")

import httpx

from agent.config import settings
from agent.models import AsanaTask

ASANA_BASE = "https://app.asana.com/api/1.0"


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.asana_pat}"}


def _fetch_tasks_for_assignee(
    client: httpx.Client,
    assignee: str,
    workspace_gid: str,
    week_end: date,
) -> list[AsanaTask]:
    """Fetch incomplete tasks for a given assignee GID (or 'me')."""
    params: dict[str, str] = {
        "assignee": assignee,
        "workspace": workspace_gid,
        "completed_since": "now",
        "opt_fields": "gid,name,due_on,notes,memberships.project.name,permalink_url,assignee.gid,assignee.name",
        "limit": "100",
    }
    url = f"{ASANA_BASE}/tasks"
    tasks: list[AsanaTask] = []

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
            assignee = item.get("assignee") or {}
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
                    assignee_name=assignee.get("name"),
                )
            )

        next_page = data.get("next_page")
        if next_page and next_page.get("offset"):
            params["offset"] = next_page["offset"]
        else:
            break

    return [t for t in tasks if t.due_on is not None and t.due_on <= week_end]


def fetch_week_tasks(week_end: date) -> list[AsanaTask]:
    """
    Fetch incomplete tasks assigned to me that are past due, due today, or due
    within the coming week (up to week_end). Tasks with no due date are excluded.

    'completed_since=now' returns only incomplete tasks (Asana API convention).
    """
    if settings.asana_project_gid:
        # Project-scoped path (no assignee filter)
        params: dict[str, str] = {
            "completed_since": "now",
            "opt_fields": "gid,name,due_on,notes,memberships.project.name,permalink_url,assignee.gid,assignee.name",
            "limit": "100",
        }
        url = f"{ASANA_BASE}/projects/{settings.asana_project_gid}/tasks"
        tasks: list[AsanaTask] = []
        with httpx.Client(timeout=20.0) as client:
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
                next_page = data.get("next_page")
                if next_page and next_page.get("offset"):
                    params["offset"] = next_page["offset"]
                else:
                    break
        tasks = [t for t in tasks if t.due_on is not None and t.due_on <= week_end]
    else:
        with httpx.Client(timeout=20.0) as client:
            tasks = _fetch_tasks_for_assignee(client, "me", settings.asana_workspace_gid, week_end)

    tasks.sort(key=lambda t: t.due_on)
    return tasks


def fetch_workspace_tasks(week_end: date) -> list[AsanaTask]:
    """
    Fetch incomplete tasks for ALL users in the workspace.
    Used by the TRMNL display to show both Nat's and Caitie's tasks.
    Deduplicates by task GID.
    """
    workspace_gid = settings.asana_workspace_gid

    with httpx.Client(timeout=20.0) as client:
        resp = client.get(
            f"{ASANA_BASE}/workspaces/{workspace_gid}/users",
            headers=_headers(),
            params={"opt_fields": "gid,name"},
        )
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            print(f"[asana] Could not list workspace users ({e.response.status_code}), falling back to 'me'")
            tasks = _fetch_tasks_for_assignee(client, "me", workspace_gid, week_end)
            tasks.sort(key=lambda t: t.due_on)
            return tasks

        users = resp.json().get("data", [])
        if not users:
            tasks = _fetch_tasks_for_assignee(client, "me", workspace_gid, week_end)
            tasks.sort(key=lambda t: t.due_on)
            return tasks

        seen: set[str] = set()
        all_tasks: list[AsanaTask] = []
        for user in users:
            print(f"[asana] Fetching tasks for user {user.get('name', user['gid'])}")
            for task in _fetch_tasks_for_assignee(client, user["gid"], workspace_gid, week_end):
                if task.gid not in seen:
                    seen.add(task.gid)
                    all_tasks.append(task)

    all_tasks.sort(key=lambda t: t.due_on)
    return all_tasks
