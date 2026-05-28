/**
 * Liquid template for the TRMNL Private Plugin.
 *
 * Paste this into the plugin's "Markup" editor on usetrmnl.com. TRMNL applies
 * it server-side to whatever merge_variables payload we last POSTed and
 * renders the result to a 1-bit PNG for the device.
 *
 * Display constraints (do not "fix" these in style edits):
 *   • 800×480 monochrome — no color is ever rendered; all hex codes are
 *     either #000 or #fff. Anything else dithers to a noisy gray.
 *   • Inline CSS only — TRMNL's renderer strips <style>/<script>/external assets.
 *   • Font weights below 600 dither poorly at small sizes — stick to bold.
 *   • Strokes thinner than 1.5px disappear on the e-ink refresh.
 *
 * Column distinction (no color available):
 *   • CAITIE = inverted header strip (black bg, white text) + 4px left edge bar.
 *   • NAT    = white header strip with a double-rule underline + 4px right edge bar.
 *
 * Run `npm --workspace agent/trmnl run print-template` to dump this string to
 * stdout for copy-paste.
 */

export const LIQUID_TEMPLATE = `<div class="screen screen--og" style="background:#fff;color:#000;font-family:sans-serif;width:800px;height:480px;box-sizing:border-box;display:flex;flex-direction:column;">

  <!-- Header strip: app title (left), date (center), weather (right). 2px solid top+bottom. -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-top:2px solid #000;border-bottom:2px solid #000;height:44px;box-sizing:border-box;">
    <div style="font-size:22px;font-weight:800;letter-spacing:.04em;">{{ app_title }}</div>
    <div style="font-size:22px;font-weight:800;letter-spacing:.05em;">{{ date_label }}</div>
    <div style="font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;">
      {% if weather %}{{ weather.glyph }} {{ weather.high }}/{{ weather.low }} F{% endif %}
    </div>
  </div>

  <!-- Family banner list. Plain disc prefix + bold title + chevron when the event spans past today. -->
  {% if banners.size > 0 %}
  <div style="padding:4px 12px;border-bottom:1.5px solid #000;">
    {% for b in banners %}
    <div style="display:flex;align-items:center;font-size:16px;font-weight:700;height:26px;line-height:26px;">
      <span style="display:inline-block;width:6px;height:6px;background:#000;border-radius:50%;margin-right:8px;flex-shrink:0;"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ b.title }}</span>
      {% if b.continues %}<span style="margin-left:8px;font-size:18px;font-weight:800;">&gt;</span>{% endif %}
    </div>
    {% endfor %}
  </div>
  {% endif %}

  <!-- Owner split. 50/50 with an 8px center gutter; each side gets a 4px edge bar. -->
  <div style="display:flex;flex:1;padding:0;overflow:hidden;">

    <!-- ── CAITIE (left) — inverted header + 4px left edge bar ─────────── -->
    <div style="flex:1;border-left:4px solid #000;display:flex;flex-direction:column;overflow:hidden;">

      <div style="background:#000;color:#fff;padding:5px 10px;font-size:18px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;height:30px;box-sizing:border-box;">CAITIE</div>

      {% if caitie.gus_dropoff or caitie.gus_pickup %}
      <div style="padding:6px 10px 0;display:flex;gap:6px;height:30px;box-sizing:border-box;">
        {% if caitie.gus_dropoff %}<span style="display:inline-block;background:#000;color:#fff;border-radius:4px;padding:3px 8px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;">v DROP 7a</span>{% endif %}
        {% if caitie.gus_pickup %}<span style="display:inline-block;background:#000;color:#fff;border-radius:4px;padding:3px 8px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;">^ PICK 5p</span>{% endif %}
      </div>
      {% endif %}

      <div style="padding:4px 10px;">
        {% for item in caitie.items %}
        <div style="display:flex;align-items:center;height:28px;font-size:16px;font-weight:700;">
          {% if item.glyph %}<span style="display:inline-block;border:1.5px solid #000;padding:0 4px;font-size:12px;font-weight:800;line-height:18px;min-width:14px;text-align:center;margin-right:8px;flex-shrink:0;">{{ item.glyph }}</span>{% endif %}
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ item.title }}</span>
          <span style="font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;margin-left:8px;flex-shrink:0;">{{ item.time }}</span>
        </div>
        {% endfor %}
      </div>

      {% if caitie.tasks.size > 0 %}
      <div style="margin:4px 10px 0;border-top:1.5px solid #000;padding-top:4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">TASKS</div>
      <div style="padding:2px 10px;">
        {% for task in caitie.tasks %}
        {% if task.is_overdue %}
        <div style="display:flex;align-items:center;height:26px;background:#000;color:#fff;font-size:15px;font-weight:700;padding:0 6px;margin-bottom:2px;">
          <span style="display:inline-block;border:1.5px solid #fff;padding:0 4px;font-size:11px;font-weight:800;line-height:14px;margin-right:6px;flex-shrink:0;">!</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ task.name }}</span>
        </div>
        {% else %}
        <div style="display:flex;align-items:center;height:26px;font-size:15px;font-weight:700;">
          <span style="display:inline-block;border:1.5px solid #000;width:10px;height:10px;margin-right:8px;flex-shrink:0;"></span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ task.name }}</span>
        </div>
        {% endif %}
        {% endfor %}
      </div>
      {% endif %}

    </div>

    <!-- 8px gutter -->
    <div style="width:8px;"></div>

    <!-- ── NAT (right) — double-rule header + 4px right edge bar ────────── -->
    <div style="flex:1;border-right:4px solid #000;display:flex;flex-direction:column;overflow:hidden;">

      <div style="background:#fff;color:#000;padding:5px 10px;font-size:18px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;border-bottom:1.5px solid #000;box-shadow:inset 0 -5px 0 #fff, inset 0 -6.5px 0 #000;height:30px;box-sizing:border-box;">NAT</div>

      {% if nat.gus_dropoff or nat.gus_pickup %}
      <div style="padding:6px 10px 0;display:flex;gap:6px;height:30px;box-sizing:border-box;">
        {% if nat.gus_dropoff %}<span style="display:inline-block;background:#000;color:#fff;border-radius:4px;padding:3px 8px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;">v DROP 7a</span>{% endif %}
        {% if nat.gus_pickup %}<span style="display:inline-block;background:#000;color:#fff;border-radius:4px;padding:3px 8px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;">^ PICK 5p</span>{% endif %}
      </div>
      {% endif %}

      <div style="padding:4px 10px;">
        {% for item in nat.items %}
        <div style="display:flex;align-items:center;height:28px;font-size:16px;font-weight:700;">
          {% if item.glyph %}<span style="display:inline-block;border:1.5px solid #000;padding:0 4px;font-size:12px;font-weight:800;line-height:18px;min-width:14px;text-align:center;margin-right:8px;flex-shrink:0;">{{ item.glyph }}</span>{% endif %}
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ item.title }}</span>
          <span style="font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;margin-left:8px;flex-shrink:0;">{{ item.time }}</span>
        </div>
        {% endfor %}
      </div>

      {% if nat.tasks.size > 0 %}
      <div style="margin:4px 10px 0;border-top:1.5px solid #000;padding-top:4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">TASKS</div>
      <div style="padding:2px 10px;">
        {% for task in nat.tasks %}
        {% if task.is_overdue %}
        <div style="display:flex;align-items:center;height:26px;background:#000;color:#fff;font-size:15px;font-weight:700;padding:0 6px;margin-bottom:2px;">
          <span style="display:inline-block;border:1.5px solid #fff;padding:0 4px;font-size:11px;font-weight:800;line-height:14px;margin-right:6px;flex-shrink:0;">!</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ task.name }}</span>
        </div>
        {% else %}
        <div style="display:flex;align-items:center;height:26px;font-size:15px;font-weight:700;">
          <span style="display:inline-block;border:1.5px solid #000;width:10px;height:10px;margin-right:8px;flex-shrink:0;"></span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ task.name }}</span>
        </div>
        {% endif %}
        {% endfor %}
      </div>
      {% endif %}

    </div>

  </div>

  <!-- Footer: thin solid top rule + "updated <time>" -->
  <div style="border-top:2px solid #000;padding:3px 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">updated {{ generated_at }}</div>

</div>`
