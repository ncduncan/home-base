"""
Email publisher.

Renders the Jinja2 HTML briefing template and sends it to ncduncan@gmail.com
via the Gmail API (same OAuth credential used for calendar access).

In dry-run mode, prints the narrative to stdout instead.
"""

import base64
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from googleapiclient.discovery import build
from jinja2 import Environment, FileSystemLoader, select_autoescape

from agent.collectors.calendar import load_credentials
from agent.config import settings
from agent.models import BriefingData

TEMPLATE_DIR = Path(__file__).parent / "templates"


def _render_html(data: BriefingData) -> str:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=select_autoescape(["html", "j2"]),
    )
    template = env.get_template("briefing.html.j2")
    from datetime import date

    return template.render(data=data, today=date.today())


def send_briefing_email(data: BriefingData) -> None:
    if settings.briefing_dry_run:
        print("[email] DRY RUN — skipping send. Briefing narrative:")
        print("-" * 60)
        print(data.narrative)
        print("-" * 60)
        return

    html_body = _render_html(data)
    subject = f"Home-Base: Week of {data.week_start.strftime('%B %-d, %Y')}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.briefing_email_to
    msg["To"] = settings.briefing_email_to
    msg.attach(MIMEText(html_body, "html"))

    raw_bytes = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    creds = load_credentials()
    service = build("gmail", "v1", credentials=creds)
    service.users().messages().send(
        userId="me",
        body={"raw": raw_bytes},
    ).execute()

    print(f"[email] Briefing sent to {settings.briefing_email_to}")
