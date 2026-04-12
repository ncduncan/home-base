"""
TRMNL financial market dashboard updater.

Collects financial metrics from multpl.com (and optionally FRED), then
pushes them to the TRMNL Private Plugin webhook as a market dashboard
with an inline SVG trend chart.

Usage:
    python -m agent.trmnl_finance_update

Dry run (prints payload, writes SVG to /tmp):
    TRMNL_WEBHOOK_URL=dry python -m agent.trmnl_finance_update
"""

from agent.collectors.market_data import fetch_market_snapshot
from agent.config import settings
from agent.publishers.trmnl_finance import push_finance_to_trmnl


def main() -> None:
    snapshot = fetch_market_snapshot(fred_api_key=settings.fred_api_key)
    push_finance_to_trmnl(settings.trmnl_webhook_url, snapshot)


if __name__ == "__main__":
    main()
