"""
Data models for the agent/ Python pipelines.

The household briefing/TRMNL surfaces have moved to Node/TypeScript and consume
`shared/` directly. Only the financial dashboard models remain here — they are
referenced by `agent/collectors/market_data.py` and `agent/publishers/trmnl_finance.py`.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


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
