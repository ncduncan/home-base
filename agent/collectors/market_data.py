"""
Financial market data collector.

Scrapes multpl.com for CAPE, S&P 500 prices, 10yr Treasury, and CPI.
Optionally fetches GDP and oil prices from FRED.
Computes derived metrics: TTM S&P return, excess yield, projected 10yr return.
"""

from datetime import date, datetime
from html.parser import HTMLParser

import httpx

from agent.models import MarketSnapshot, MonthlyDataPoint

MULTPL_BASE = "https://www.multpl.com"
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

# Shiller regression coefficients: expected_10yr_real_return = A + B * (1/CAPE)
# Derived from 1881–present data on CAPE vs subsequent 10-year annualized real returns.
_REGRESSION_A = -0.0118
_REGRESSION_B = 1.098


# ── multpl.com table scraper ─────────────────────────────────────────────────


class _MultplTableParser(HTMLParser):
    """Extract (date_str, value_str) pairs from a multpl.com table page."""

    def __init__(self):
        super().__init__()
        self._in_td = False
        self._cells: list[str] = []
        self.rows: list[tuple[str, str]] = []

    def handle_starttag(self, tag, attrs):
        if tag == "td":
            self._in_td = True
            self._current = ""

    def handle_endtag(self, tag):
        if tag == "td" and self._in_td:
            self._in_td = False
            self._cells.append(self._current.strip())
            if len(self._cells) == 2:
                self.rows.append((self._cells[0], self._cells[1]))
                self._cells = []

    def handle_data(self, data):
        if self._in_td:
            self._current += data


def _parse_multpl_value(raw: str) -> float:
    """Parse a multpl.com value like '4.31%' or '6,848.39' into a float."""
    cleaned = raw.replace("%", "").replace(",", "").replace("$", "").strip()
    return float(cleaned)


def _parse_multpl_date(raw: str) -> date:
    """Parse a multpl.com date like 'Apr 10, 2026' or 'Mar 1, 2026'."""
    return datetime.strptime(raw.strip(), "%b %d, %Y").date()


def _scrape_multpl_table(
    client: httpx.Client,
    path: str,
    months: int = 25,
) -> list[tuple[date, float]]:
    """
    Fetch a multpl.com table page and return up to `months` rows as
    (date, value) pairs, most recent first.
    """
    resp = client.get(f"{MULTPL_BASE}{path}")
    resp.raise_for_status()

    parser = _MultplTableParser()
    parser.feed(resp.text)

    results: list[tuple[date, float]] = []
    for date_str, val_str in parser.rows[:months]:
        try:
            d = _parse_multpl_date(date_str)
            v = _parse_multpl_value(val_str)
            results.append((d, v))
        except (ValueError, IndexError):
            continue
    return results


# ── Individual metric fetchers ───────────────────────────────────────────────


HISTORY_MONTHS = 121  # 10 years + current month


def _fetch_cape_history(client: httpx.Client) -> list[tuple[date, float]]:
    return _scrape_multpl_table(client, "/shiller-pe/table/by-month", months=HISTORY_MONTHS)


def _fetch_sp500_history(client: httpx.Client) -> list[tuple[date, float]]:
    return _scrape_multpl_table(client, "/s-p-500-historical-prices/table/by-month", months=HISTORY_MONTHS)


def _fetch_treasury_history(client: httpx.Client) -> list[tuple[date, float]]:
    return _scrape_multpl_table(client, "/10-year-treasury-rate/table/by-month", months=HISTORY_MONTHS)


def _fetch_cpi(client: httpx.Client) -> float | None:
    """Fetch the most recent YoY CPI from multpl.com."""
    rows = _scrape_multpl_table(client, "/inflation/table/by-month", months=1)
    return rows[0][1] if rows else None


# ── FRED API fetchers (secondary metrics) ────────────────────────────────────


def _fetch_fred_latest(
    client: httpx.Client,
    api_key: str,
    series_id: str,
) -> float | None:
    """Fetch the most recent observation from a FRED series."""
    if not api_key:
        return None
    try:
        resp = client.get(
            FRED_BASE,
            params={
                "series_id": series_id,
                "api_key": api_key,
                "file_type": "json",
                "sort_order": "desc",
                "limit": 1,
            },
        )
        resp.raise_for_status()
        obs = resp.json().get("observations", [])
        if obs and obs[0]["value"] != ".":
            return float(obs[0]["value"])
    except (httpx.HTTPError, KeyError, ValueError, IndexError):
        pass
    return None


# ── Derived metric computations ──────────────────────────────────────────────


def _compute_ttm_return(sp500_history: list[tuple[date, float]]) -> float:
    """
    Trailing 12-month S&P 500 return.
    Uses the most recent price and the price closest to 12 months ago.
    """
    if len(sp500_history) < 13:
        # Need at least 13 months (current + 12 ago)
        raise ValueError(f"Need 13+ months of S&P data, got {len(sp500_history)}")
    current = sp500_history[0][1]
    year_ago = sp500_history[12][1]
    return (current / year_ago) - 1


def _compute_excess_yield(cape: float, treasury_10yr: float) -> float:
    """Earnings yield (1/CAPE) minus 10yr Treasury yield."""
    earnings_yield = (1.0 / cape) * 100
    return earnings_yield - treasury_10yr


def _compute_projected_return(cape: float) -> float:
    """
    Projected 10-year annualized real return based on CAPE regression.
    Uses Shiller's historical regression: E[return] = A + B * (1/CAPE)
    """
    return _REGRESSION_A + _REGRESSION_B * (1.0 / cape)


# ── Build history for the trend chart ────────────────────────────────────────


def _build_history(
    cape_hist: list[tuple[date, float]],
    treasury_hist: list[tuple[date, float]],
) -> list[MonthlyDataPoint]:
    """
    Merge CAPE and Treasury histories into MonthlyDataPoint list.
    Aligns by year-month. Returns oldest-first for charting.
    """
    cape_by_month: dict[str, float] = {}
    for d, v in cape_hist:
        key = d.strftime("%Y-%m")
        cape_by_month.setdefault(key, v)

    treasury_by_month: dict[str, float] = {}
    for d, v in treasury_hist:
        key = d.strftime("%Y-%m")
        treasury_by_month.setdefault(key, v)

    all_months = sorted(set(cape_by_month) | set(treasury_by_month))

    points: list[MonthlyDataPoint] = []
    for month in all_months:
        cape = cape_by_month.get(month)
        treas = treasury_by_month.get(month)
        excess = None
        if cape is not None and treas is not None:
            excess = round(_compute_excess_yield(cape, treas), 2)
        points.append(
            MonthlyDataPoint(
                month=month,
                cape=cape,
                treasury_10yr=treas,
                excess_yield=excess,
            )
        )

    return points  # oldest first


# ── Public API ───────────────────────────────────────────────────────────────


def fetch_market_snapshot(fred_api_key: str = "") -> MarketSnapshot:
    """
    Collect all financial metrics and return a MarketSnapshot.
    Scrapes multpl.com for primary data; optionally hits FRED for GDP/oil.
    """
    with httpx.Client(timeout=20.0, follow_redirects=True) as client:
        # Primary metrics from multpl.com
        cape_hist = _fetch_cape_history(client)
        sp500_hist = _fetch_sp500_history(client)
        treasury_hist = _fetch_treasury_history(client)
        cpi = _fetch_cpi(client)

        # Current values (most recent row)
        cape = cape_hist[0][1]
        treasury = treasury_hist[0][1]
        ttm_return = _compute_ttm_return(sp500_hist)
        excess = _compute_excess_yield(cape, treasury)
        projected = _compute_projected_return(cape)

        # Secondary metrics from FRED (best-effort)
        gdp = _fetch_fred_latest(client, fred_api_key, "A191RL1Q225SBEA")
        oil = _fetch_fred_latest(client, fred_api_key, "DCOILWTICO")

        # Build 24-month history for trend chart
        history = _build_history(cape_hist, treasury_hist)

    print(f"[market_data] CAPE={cape:.1f}  10yr={treasury:.2f}%  "
          f"TTM={ttm_return:+.1%}  Excess={excess:+.2f}%  "
          f"Proj10yr={projected:.1%}")

    return MarketSnapshot(
        timestamp=datetime.utcnow(),
        sp500_ttm_return=round(ttm_return, 4),
        cape_ratio=cape,
        treasury_10yr=treasury,
        excess_yield=round(excess, 2),
        projected_10yr_return=round(projected, 4),
        cpi_yoy=cpi,
        gdp_growth=gdp,
        oil_price=oil,
        history=history,
    )
