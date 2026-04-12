"""
TRMNL e-ink financial market dashboard publisher.

Transforms a MarketSnapshot into merge_variables with an inline SVG trend
chart, then POSTs to the TRMNL Private Plugin webhook.

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

      <!-- LEFT PANEL: Metrics -->
      <div style="width:260px;display:flex;flex-direction:column;justify-content:center;gap:6px;">

        {% for m in metrics %}
        <div style="border:1.5px solid #000;border-radius:4px;padding:5px 10px;">
          <div style="font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#666;">{{ m.label }}</div>
          <div style="display:flex;align-items:baseline;gap:6px;">
            <span style="font-size:22px;font-weight:bold;line-height:1.2;">{{ m.value }}</span>
            <span style="font-size:18px;">{{ m.signal }}</span>
          </div>
        </div>
        {% endfor %}

      </div>

      <!-- RIGHT PANEL: Trend Chart + Secondary -->
      <div style="flex:1;display:flex;flex-direction:column;gap:6px;">

        <div style="font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#666;padding-left:4px;">10-Year Trend</div>
        <div style="flex:1;border:1.5px solid #000;border-radius:4px;padding:4px;overflow:hidden;">
          {{ trend_chart_svg }}
        </div>

        <!-- Secondary metrics bar -->
        {% if secondary %}
        <div style="display:flex;gap:12px;justify-content:center;font-size:11px;font-weight:bold;color:#333;">
          {% for s in secondary %}
          <span>{{ s.label }} {{ s.value }}</span>
          {% endfor %}
        </div>
        {% endif %}

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
# Each tuple: (good_test, neutral_test) — if neither passes, it's bad.
# good_test and neutral_test are (operator, threshold) pairs.

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


def _format_secondary(snap: MarketSnapshot) -> list[dict]:
    items = []
    if snap.cpi_yoy is not None:
        items.append({"label": "CPI", "value": f"{snap.cpi_yoy:.1f}%"})
    if snap.gdp_growth is not None:
        items.append({"label": "GDP", "value": f"{snap.gdp_growth:.1f}%"})
    if snap.oil_price is not None:
        items.append({"label": "OIL", "value": f"${snap.oil_price:.0f}"})
    return items


# ── SVG trend chart ──────────────────────────────────────────────────────────


def _render_trend_svg(history: list[MonthlyDataPoint], width: int = 490, height: int = 260) -> str:
    """
    Generate an inline SVG showing 3 overlaid trend lines:
      - CAPE (solid line, right Y-axis)
      - 10yr Treasury (dashed, left Y-axis)
      - Excess Yield (dot-dash, left Y-axis)
    """
    if not history:
        return '<svg width="{}" height="{}"></svg>'.format(width, height)

    pad_l, pad_r, pad_t, pad_b = 38, 38, 16, 40
    chart_w = width - pad_l - pad_r
    chart_h = height - pad_t - pad_b

    n = len(history)
    if n < 2:
        return '<svg width="{}" height="{}"></svg>'.format(width, height)

    # Extract series, filtering None
    cape_pts = [(i, p.cape) for i, p in enumerate(history) if p.cape is not None]
    treas_pts = [(i, p.treasury_10yr) for i, p in enumerate(history) if p.treasury_10yr is not None]
    excess_pts = [(i, p.excess_yield) for i, p in enumerate(history) if p.excess_yield is not None]

    def _scale(pts: list[tuple[int, float]], margin: float = 0.1):
        """Return (min_val, max_val) with some padding."""
        vals = [v for _, v in pts]
        lo, hi = min(vals), max(vals)
        span = hi - lo or 1.0
        return lo - span * margin, hi + span * margin

    def _to_xy(pts: list[tuple[int, float]], lo: float, hi: float) -> list[tuple[float, float]]:
        """Convert data points to SVG coordinates."""
        coords = []
        for idx, val in pts:
            x = pad_l + (idx / (n - 1)) * chart_w
            y = pad_t + chart_h - ((val - lo) / (hi - lo)) * chart_h
            coords.append((x, y))
        return coords

    def _polyline(coords: list[tuple[float, float]], dash: str = "", stroke_w: float = 2.0) -> str:
        points = " ".join(f"{x:.1f},{y:.1f}" for x, y in coords)
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        return (
            f'<polyline points="{points}" fill="none" stroke="#000" '
            f'stroke-width="{stroke_w}"{dash_attr} stroke-linejoin="round" />'
        )

    # Marker spacing: place a marker every N points to keep the chart readable
    marker_every = max(1, len(history) // 8)

    def _markers(coords: list[tuple[float, float]], shape: str) -> str:
        """Generate SVG markers at regular intervals along a line.
        shape: 'circle', 'square', or 'triangle'
        """
        parts: list[str] = []
        for i, (x, y) in enumerate(coords):
            if i % marker_every != 0 and i != len(coords) - 1:
                continue
            if shape == "circle":
                parts.append(
                    f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" '
                    f'fill="#000" stroke="#000" stroke-width="1" />'
                )
            elif shape == "square":
                parts.append(
                    f'<rect x="{x - 3:.1f}" y="{y - 3:.1f}" width="6" height="6" '
                    f'fill="#fff" stroke="#000" stroke-width="1.5" />'
                )
            elif shape == "triangle":
                # Upward-pointing triangle
                parts.append(
                    f'<polygon points="{x:.1f},{y - 4:.1f} {x - 3.5:.1f},{y + 3:.1f} '
                    f'{x + 3.5:.1f},{y + 3:.1f}" fill="#000" stroke="#000" stroke-width="1" />'
                )
        return "\n".join(parts)

    # Scale each series independently
    cape_lo, cape_hi = _scale(cape_pts) if cape_pts else (0, 1)
    # Treasury and excess share the left axis (both are percentages)
    yield_vals = [v for _, v in treas_pts] + [v for _, v in excess_pts]
    if yield_vals:
        yield_lo = min(yield_vals)
        yield_hi = max(yield_vals)
        span = yield_hi - yield_lo or 1.0
        yield_lo -= span * 0.1
        yield_hi += span * 0.1
    else:
        yield_lo, yield_hi = 0, 1

    cape_xy = _to_xy(cape_pts, cape_lo, cape_hi)
    treas_xy = _to_xy(treas_pts, yield_lo, yield_hi)
    excess_xy = _to_xy(excess_pts, yield_lo, yield_hi)

    # Build SVG
    lines: list[str] = []
    lines.append(f'<svg width="{width}" height="{height}" xmlns="http://www.w3.org/2000/svg">')

    # Background
    lines.append(f'<rect x="{pad_l}" y="{pad_t}" width="{chart_w}" height="{chart_h}" '
                 f'fill="none" stroke="#ccc" stroke-width="0.5" />')

    # Horizontal grid lines (4 lines)
    for i in range(1, 4):
        gy = pad_t + (chart_h * i / 4)
        lines.append(f'<line x1="{pad_l}" y1="{gy:.1f}" x2="{pad_l + chart_w}" y2="{gy:.1f}" '
                     f'stroke="#ddd" stroke-width="0.5" />')

    # Zero line for excess yield if it crosses zero
    if yield_lo < 0 < yield_hi:
        zy = pad_t + chart_h - ((0 - yield_lo) / (yield_hi - yield_lo)) * chart_h
        lines.append(f'<line x1="{pad_l}" y1="{zy:.1f}" x2="{pad_l + chart_w}" y2="{zy:.1f}" '
                     f'stroke="#999" stroke-width="1" stroke-dasharray="3,3" />')

    # Data lines + markers (circle=CAPE, square=10yr, triangle=Excess)
    if cape_xy:
        lines.append(_polyline(cape_xy))  # solid
        lines.append(_markers(cape_xy, "circle"))
    if treas_xy:
        lines.append(_polyline(treas_xy, dash="8,4"))  # dashed
        lines.append(_markers(treas_xy, "square"))
    if excess_xy:
        lines.append(_polyline(excess_xy, dash="4,4,1,4"))  # dot-dash
        lines.append(_markers(excess_xy, "triangle"))

    # Left Y-axis labels (yield %)
    for frac, anchor in [(0, "start"), (1, "start")]:
        val = yield_hi - frac * (yield_hi - yield_lo)
        y = pad_t + frac * chart_h
        lines.append(f'<text x="{pad_l - 4}" y="{y + 3:.1f}" font-size="9" '
                     f'text-anchor="end" fill="#333">{val:.1f}%</text>')

    # Right Y-axis labels (CAPE)
    for frac, anchor in [(0, "end"), (1, "end")]:
        val = cape_hi - frac * (cape_hi - cape_lo)
        y = pad_t + frac * chart_h
        lines.append(f'<text x="{pad_l + chart_w + 4}" y="{y + 3:.1f}" font-size="9" '
                     f'text-anchor="start" fill="#333">{val:.0f}</text>')

    # X-axis labels (every 24 months for 10yr chart, every 6 for shorter)
    x_step = 24 if n > 60 else 6
    for i in range(0, n, x_step):
        x = pad_l + (i / (n - 1)) * chart_w
        month_str = history[i].month  # "2024-04"
        parts = month_str.split("-")
        month_names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        label = f"{month_names[int(parts[1])]}'{parts[0][2:]}"
        lines.append(f'<text x="{x:.1f}" y="{pad_t + chart_h + 14}" font-size="9" '
                     f'text-anchor="middle" fill="#666">{label}</text>')
    # Always label the last point
    if n > 1 and (n - 1) % x_step != 0:
        x = pad_l + chart_w
        month_str = history[-1].month
        parts = month_str.split("-")
        month_names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        label = f"{month_names[int(parts[1])]}'{parts[0][2:]}"
        lines.append(f'<text x="{x:.1f}" y="{pad_t + chart_h + 14}" font-size="9" '
                     f'text-anchor="middle" fill="#666">{label}</text>')

    # Legend (line sample + marker + label)
    legend_y = height - 6
    legend_items = [
        ("CAPE", "", "circle", pad_l + 10),
        ("10yr", "8,4", "square", pad_l + 110),
        ("Excess Yld", "4,4,1,4", "triangle", pad_l + 210),
    ]
    for label, dash, marker, lx in legend_items:
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        lines.append(f'<line x1="{lx}" y1="{legend_y}" x2="{lx + 20}" y2="{legend_y}" '
                     f'stroke="#000" stroke-width="2"{dash_attr} />')
        # Marker at midpoint of legend line
        mx = lx + 10
        if marker == "circle":
            lines.append(f'<circle cx="{mx}" cy="{legend_y}" r="3" fill="#000" />')
        elif marker == "square":
            lines.append(f'<rect x="{mx - 3}" y="{legend_y - 3}" width="6" height="6" '
                         f'fill="#fff" stroke="#000" stroke-width="1.5" />')
        elif marker == "triangle":
            lines.append(f'<polygon points="{mx},{legend_y - 4} {mx - 3.5},{legend_y + 3} '
                         f'{mx + 3.5},{legend_y + 3}" fill="#000" />')
        lines.append(f'<text x="{lx + 24}" y="{legend_y + 3}" font-size="9" fill="#333">'
                     f'{label}</text>')

    lines.append("</svg>")
    return "\n".join(lines)


# ── Push to TRMNL ────────────────────────────────────────────────────────────


def push_finance_to_trmnl(webhook_url: str, snapshot: MarketSnapshot) -> None:
    """Format MarketSnapshot and POST to the TRMNL Private Plugin webhook."""
    if not webhook_url:
        raise ValueError("TRMNL_WEBHOOK_URL is not configured")

    t = snapshot.timestamp.replace(tzinfo=None)  # already UTC-ish
    # Format as Eastern
    from datetime import timezone

    now_et = datetime.now(tz=EASTERN)
    hour = now_et.hour % 12 or 12
    ampm = "AM" if now_et.hour < 12 else "PM"
    generated_at = f"{now_et.strftime('%b')} {now_et.day}, {hour}:{now_et.strftime('%M')} {ampm}"

    metrics = _format_metrics(snapshot)
    secondary = _format_secondary(snapshot)
    trend_svg = _render_trend_svg(snapshot.history)

    payload = {
        "merge_variables": {
            "generated_at": generated_at,
            "metrics": metrics,
            "secondary": secondary,
            "trend_chart_svg": trend_svg,
        }
    }

    # Dry-run mode: print payload instead of POSTing
    if webhook_url == "dry":
        import json

        print("[trmnl_finance] DRY RUN — merge_variables:")
        mv = payload["merge_variables"].copy()
        # Truncate SVG for readability
        mv["trend_chart_svg"] = mv["trend_chart_svg"][:200] + "..."
        print(json.dumps(mv, indent=2))
        # Also write full SVG to temp file for preview
        svg_path = "/tmp/trmnl_finance_chart.svg"
        with open(svg_path, "w") as f:
            f.write(trend_svg)
        print(f"[trmnl_finance] SVG chart written to {svg_path}")
        return

    with httpx.Client(timeout=15.0) as client:
        resp = client.post(webhook_url, json=payload)
        resp.raise_for_status()

    print(
        f"[trmnl_finance] Pushed: CAPE={snapshot.cape_ratio:.1f} "
        f"10yr={snapshot.treasury_10yr:.2f}% "
        f"Excess={snapshot.excess_yield:+.2f}% — {generated_at}"
    )
