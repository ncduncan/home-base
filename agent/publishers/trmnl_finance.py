"""
TRMNL e-ink financial market dashboard publisher.

Transforms a MarketSnapshot into merge_variables and POSTs to the TRMNL
Private Plugin webhook. The chart uses a tiny inline SVG (percentage
viewBox) for connecting lines plus CSS-positioned marker shapes, all
within TRMNL's 2KB payload limit.

──────────────────────────────────────────────────────────────────────────────
TRMNL Liquid Template
Paste this into your Private Plugin markup on usetrmnl.com:
──────────────────────────────────────────────────────────────────────────────

<div class="screen screen--og">
  <div class="view view--full" style="display:flex;flex-direction:column;font-family:sans-serif;height:100%;">

    <div class="title_bar">
      <span class="title">Market Dashboard</span>
      <span class="instance_label">{{ generated_at }}</span>
    </div>

    <div style="display:flex;flex:1;padding:6px 8px;gap:8px;overflow:hidden;">

      <!-- LEFT PANEL: Metrics (full height) -->
      <div style="width:250px;display:flex;flex-direction:column;justify-content:space-between;gap:4px;">
        {% for m in metrics %}
        <div style="flex:1;border:1.5px solid #000;border-radius:4px;padding:6px 10px;display:flex;flex-direction:column;justify-content:center;">
          <div style="font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#666;">{{ m.label }}</div>
          <div style="display:flex;align-items:baseline;gap:6px;">
            <span style="font-size:24px;font-weight:bold;line-height:1.1;">{{ m.value }}</span>
            <span style="font-size:20px;">{{ m.signal }}</span>
          </div>
        </div>
        {% endfor %}
      </div>

      <!-- RIGHT PANEL: Chart -->
      <div style="flex:1;display:flex;flex-direction:column;gap:4px;">

        <div style="font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#666;padding-left:4px;">10-Year Trend</div>

        <!-- Chart area -->
        <div style="flex:1;border:1.5px solid #000;border-radius:4px;position:relative;overflow:hidden;">
          <!-- SVG lines (percentage viewBox overlaid on chart) -->
          {{ chart_svg }}
          <!-- Marker dots -->
          {% for p in chart %}
          <div style="position:absolute;left:{{ p.l }}%;bottom:{{ p.c }}%;width:6px;height:6px;background:#000;border-radius:50%;transform:translate(-50%,50%);"></div>
          <div style="position:absolute;left:{{ p.l }}%;bottom:{{ p.t }}%;width:6px;height:6px;border:1.5px solid #000;background:#fff;transform:translate(-50%,50%);"></div>
          <div style="position:absolute;left:{{ p.l }}%;bottom:{{ p.e }}%;width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:6px solid #000;transform:translate(-50%,50%);"></div>
          {% endfor %}
          <!-- Y-axis labels -->
          <div style="position:absolute;left:2px;top:2px;font-size:8px;color:#666;">{{ y_top }}</div>
          <div style="position:absolute;left:2px;bottom:2px;font-size:8px;color:#666;">{{ y_bot }}</div>
          <div style="position:absolute;right:2px;top:2px;font-size:8px;color:#666;">{{ c_top }}</div>
          <div style="position:absolute;right:2px;bottom:2px;font-size:8px;color:#666;">{{ c_bot }}</div>
        </div>

        <!-- X-axis + Legend -->
        <div style="display:flex;justify-content:space-between;font-size:9px;color:#666;padding:0 4px;">
          <span>{{ x_start }}</span><span>{{ x_end }}</span>
        </div>
        <div style="display:flex;gap:14px;font-size:10px;color:#333;padding-left:4px;">
          <span>● CAPE</span>
          <span>□ 10yr</span>
          <span>▲ Excess Yld</span>
        </div>

      </div>
    </div>
  </div>
</div>

──────────────────────────────────────────────────────────────────────────────
"""

from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from agent.models import MarketSnapshot, MonthlyDataPoint

EASTERN = ZoneInfo("America/New_York")

# ── Signal thresholds ────────────────────────────────────────────────────────

_SIGNALS = {
    "sp500_ttm": [("good", lambda v: v > 0.10), ("neutral", lambda v: v >= 0)],
    "cape": [("good", lambda v: v < 20), ("neutral", lambda v: v <= 30)],
    "treasury": [("good", lambda v: v < 3.5), ("neutral", lambda v: v <= 5.0)],
    "excess": [("good", lambda v: v > 2.0), ("neutral", lambda v: v >= 0)],
    "projected": [("good", lambda v: v > 0.07), ("neutral", lambda v: v >= 0.04)],
}

_SIGNAL_ICONS = {"good": "▲", "neutral": "─", "bad": "▼"}


def _classify_signal(key: str, value: float) -> str:
    for level, test in _SIGNALS[key]:
        if test(value):
            return level
    return "bad"


def _signal_icon(key: str, value: float) -> str:
    return _SIGNAL_ICONS[_classify_signal(key, value)]


# ── Metric formatting ────────────────────────────────────────────────────────


def _format_metrics(snap: MarketSnapshot) -> list[dict]:
    return [
        {
            "label": "S&P 500 (TTM)",
            "value": f"{snap.sp500_ttm_return:+.1%}",
            "signal": _signal_icon("sp500_ttm", snap.sp500_ttm_return),
        },
        {
            "label": "CAPE Ratio",
            "value": f"{snap.cape_ratio:.1f}",
            "signal": _signal_icon("cape", snap.cape_ratio),
        },
        {
            "label": "10yr Treasury",
            "value": f"{snap.treasury_10yr:.2f}%",
            "signal": _signal_icon("treasury", snap.treasury_10yr),
        },
        {
            "label": "Excess Yield",
            "value": f"{snap.excess_yield:+.2f}%",
            "signal": _signal_icon("excess", snap.excess_yield),
        },
        {
            "label": "Est. 10yr Return",
            "value": f"{snap.projected_10yr_return:.1%} real",
            "signal": _signal_icon("projected", snap.projected_10yr_return),
        },
    ]


# ── Chart data as percentage positions ───────────────────────────────────────


def _build_chart_data(
    history: list[MonthlyDataPoint],
) -> tuple[list[dict], str, dict]:
    """
    Convert history into:
      1. Array of {l, c, t, e} percentage positions for CSS dot markers
      2. Compact SVG string with 3 polylines connecting the dots
      3. Axis label strings

    Returns (chart_points, chart_svg, axis_labels).
    """
    if not history:
        return [], "", {}

    # Downsample to ~12 points for compact payload
    step = max(1, (len(history) - 1) // 12)
    if step > 1:
        sampled = [history[i] for i in range(0, len(history), step)]
        if sampled[-1] is not history[-1]:
            sampled.append(history[-1])
        history = sampled

    n = len(history)
    if n < 2:
        return [], "", {}

    # Gather values for scaling
    cape_vals = [p.cape for p in history if p.cape is not None]
    treas_vals = [p.treasury_10yr for p in history if p.treasury_10yr is not None]
    excess_vals = [p.excess_yield for p in history if p.excess_yield is not None]
    yield_vals = treas_vals + excess_vals

    if not cape_vals or not yield_vals:
        return [], "", {}

    def _range(vals, margin=0.1):
        lo, hi = min(vals), max(vals)
        span = hi - lo or 1.0
        return lo - span * margin, hi + span * margin

    cape_lo, cape_hi = _range(cape_vals)
    yield_lo, yield_hi = _range(yield_vals)

    def _pct(val, lo, hi):
        return round((val - lo) / (hi - lo) * 100)

    points = []
    cape_svg_pts = []
    treas_svg_pts = []
    excess_svg_pts = []

    for i, p in enumerate(history):
        l = round(i / (n - 1) * 100)
        c = _pct(p.cape, cape_lo, cape_hi) if p.cape is not None else 50
        t = _pct(p.treasury_10yr, yield_lo, yield_hi) if p.treasury_10yr is not None else 50
        e = _pct(p.excess_yield, yield_lo, yield_hi) if p.excess_yield is not None else 50

        points.append({"l": l, "c": c, "t": t, "e": e})

        # SVG Y is inverted (top=0), so y = 100 - bottom%
        if p.cape is not None:
            cape_svg_pts.append(f"{l},{100 - c}")
        if p.treasury_10yr is not None:
            treas_svg_pts.append(f"{l},{100 - t}")
        if p.excess_yield is not None:
            excess_svg_pts.append(f"{l},{100 - e}")

    # Build minimal SVG — just 3 polylines, percentage viewBox
    svg_parts = [
        '<svg viewBox="0 0 100 100" preserveAspectRatio="none" '
        'style="position:absolute;inset:0;width:100%;height:100%">'
    ]
    ve = ' vector-effect="non-scaling-stroke"'
    if cape_svg_pts:
        svg_parts.append(
            f'<polyline points="{" ".join(cape_svg_pts)}" '
            f'fill="none" stroke="#000" stroke-width="2"{ve}/>'
        )
    if treas_svg_pts:
        svg_parts.append(
            f'<polyline points="{" ".join(treas_svg_pts)}" '
            f'fill="none" stroke="#000" stroke-width="1.5" stroke-dasharray="6,3"{ve}/>'
        )
    if excess_svg_pts:
        svg_parts.append(
            f'<polyline points="{" ".join(excess_svg_pts)}" '
            f'fill="none" stroke="#000" stroke-width="1.5" stroke-dasharray="3,2,1,2"{ve}/>'
        )
    svg_parts.append("</svg>")
    chart_svg = "".join(svg_parts)

    _mnames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    def _label(month_str):
        p = month_str.split("-")
        return f"{_mnames[int(p[1])]} '{p[0][2:]}"

    axis = {
        "y_top": f"{yield_hi:.1f}%",
        "y_bot": f"{yield_lo:.1f}%",
        "c_top": f"{cape_hi:.0f}",
        "c_bot": f"{cape_lo:.0f}",
        "x_start": _label(history[0].month),
        "x_end": _label(history[-1].month),
    }

    return points, chart_svg, axis


# ── Push to TRMNL ────────────────────────────────────────────────────────────


def push_finance_to_trmnl(webhook_url: str, snapshot: MarketSnapshot) -> None:
    """
    Format MarketSnapshot and POST to the TRMNL Private Plugin webhook.
    Single payload kept under TRMNL's 2KB limit.
    """
    if not webhook_url:
        raise ValueError("TRMNL_WEBHOOK_URL is not configured")

    now_et = datetime.now(tz=EASTERN)
    hour = now_et.hour % 12 or 12
    ampm = "AM" if now_et.hour < 12 else "PM"
    generated_at = f"{now_et.strftime('%b')} {now_et.day}, {hour}:{now_et.strftime('%M')} {ampm}"

    metrics = _format_metrics(snapshot)
    chart, chart_svg, axis = _build_chart_data(snapshot.history)

    payload = {
        "merge_variables": {
            "generated_at": generated_at,
            "metrics": metrics,
            "chart": chart,
            "chart_svg": chart_svg,
            **axis,
        }
    }

    # Dry-run mode
    if webhook_url == "dry":
        import json

        dumped = json.dumps(payload)
        print(f"[trmnl_finance] DRY RUN — payload size: {len(dumped)} bytes")
        print(json.dumps(payload, indent=2))
        return

    with httpx.Client(timeout=15.0) as client:
        resp = client.post(webhook_url, json=payload)
        resp.raise_for_status()

    print(
        f"[trmnl_finance] Pushed: CAPE={snapshot.cape_ratio:.1f} "
        f"10yr={snapshot.treasury_10yr:.2f}% "
        f"Excess={snapshot.excess_yield:+.2f}% — {generated_at}"
    )
