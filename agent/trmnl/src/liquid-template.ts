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
 *   • Both columns use the same white header with a double-rule underline;
 *     the 4px outer edge bar (left for Caitie, right for Nat) and the label
 *     itself are how the reader tells them apart.
 *
 * Run `npm --workspace agent/trmnl run print-template` to dump this string to
 * stdout for copy-paste.
 */

export const LIQUID_TEMPLATE = `<div class="screen screen--og" style="background:#fff;color:#000;font-family:sans-serif;width:800px;height:480px;box-sizing:border-box;display:flex;flex-direction:column;">

  <!-- Header strip: date (left), three time-of-day forecasts (right). 2px solid top+bottom. -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-top:2px solid #000;border-bottom:2px solid #000;height:46px;box-sizing:border-box;">
    <div style="font-size:20px;font-weight:800;letter-spacing:.05em;">{{ date_label }}</div>
    {% if weather %}
    <div style="display:flex;gap:14px;align-items:center;">
      {% for slot in weather.slots %}
      <div style="text-align:center;line-height:1.05;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.06em;">{{ slot.label }}</div>
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;">{{ slot.glyph }}</div>
        <div style="font-size:13px;font-weight:800;font-variant-numeric:tabular-nums;">{{ slot.temp }}°</div>
      </div>
      {% endfor %}
    </div>
    {% endif %}
  </div>

  <!-- Family banner list. Plain disc prefix + bold title + chevron when the event spans past today. -->
  {% if banners.size > 0 %}
  <div style="padding:4px 12px;border-bottom:1.5px solid #000;">
    {% for b in banners %}
    <div style="display:flex;align-items:flex-start;font-size:15px;font-weight:700;line-height:1.25;padding:2px 0;">
      <span style="display:inline-block;width:6px;height:6px;background:#000;border-radius:50%;margin:5px 8px 0 0;flex-shrink:0;"></span>
      <span style="flex:1;word-wrap:break-word;overflow-wrap:break-word;">{{ b.title }}</span>
      {% if b.continues %}<span style="margin-left:8px;font-size:16px;font-weight:800;">&gt;</span>{% endif %}
    </div>
    {% endfor %}
  </div>
  {% endif %}

  <!-- Owner split. 50/50 with an 8px center gutter; each side gets a 4px edge bar. -->
  <div style="display:flex;flex:1;padding:0;overflow:hidden;">

    <!-- ── CAITIE (left) — double-rule header (no edge bar) ────────────── -->
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">

      <div style="background:#fff;color:#000;padding:5px 10px;font-size:16px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;box-shadow:inset 0 -5px 0 #fff, inset 0 -6.5px 0 #000;height:28px;box-sizing:border-box;">CAITIE</div>

      {% if caitie.gus_dropoff or caitie.gus_pickup %}
      <div style="padding:6px 10px 0;display:flex;gap:6px;flex-wrap:wrap;">
        {% if caitie.gus_dropoff %}<span style="display:inline-block;background:#000;color:#fff;border-radius:4px;padding:3px 8px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;">GUS DROP 7A</span>{% endif %}
        {% if caitie.gus_pickup %}<span style="display:inline-block;background:#000;color:#fff;border-radius:4px;padding:3px 8px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;">GUS PICK 5P</span>{% endif %}
      </div>
      {% endif %}

      <div style="padding:4px 10px;">
        {% for item in caitie.items %}
        <div style="display:flex;align-items:flex-start;padding:3px 0;font-size:14px;font-weight:700;line-height:1.25;">
          {% if item.glyph %}<span style="display:inline-block;border:1.5px solid #000;padding:0 4px;font-size:11px;font-weight:800;line-height:16px;min-width:14px;text-align:center;margin:1px 8px 0 0;flex-shrink:0;">{{ item.glyph }}</span>{% endif %}
          <span style="font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;margin:1px 8px 0 0;flex-shrink:0;min-width:54px;">{{ item.time }}</span>
          <span style="flex:1;word-wrap:break-word;overflow-wrap:break-word;">{{ item.title }}</span>
        </div>
        {% endfor %}
      </div>

      {% if caitie.tasks.size > 0 %}
      <div style="margin:4px 10px 0;border-top:1.5px solid #000;padding-top:4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">TASKS</div>
      <div style="padding:2px 10px;">
        {% for task in caitie.tasks %}
        <div style="display:flex;align-items:flex-start;padding:3px 0;font-size:14px;font-weight:700;line-height:1.25;">
          {% if task.is_overdue %}
          <span style="display:inline-block;border:1.5px solid #000;padding:0 4px;font-size:11px;font-weight:800;line-height:14px;min-width:10px;text-align:center;margin:1px 8px 0 0;flex-shrink:0;">!</span>
          {% else %}
          <span style="display:inline-block;border:1.5px solid #000;width:10px;height:10px;margin:3px 8px 0 0;flex-shrink:0;"></span>
          {% endif %}
          <span style="flex:1;word-wrap:break-word;overflow-wrap:break-word;">{{ task.name }}</span>
        </div>
        {% endfor %}
      </div>
      {% endif %}

    </div>

    <!-- 8px gutter -->
    <div style="width:8px;"></div>

    <!-- ── NAT (right) — double-rule header + 4px right edge bar ────────── -->
    <div style="flex:1;border-right:4px solid #000;display:flex;flex-direction:column;overflow:hidden;">

      <div style="background:#fff;color:#000;padding:5px 10px;font-size:16px;font-weight:800;text-transform:uppercase;letter-spacing:.14em;box-shadow:inset 0 -5px 0 #fff, inset 0 -6.5px 0 #000;height:28px;box-sizing:border-box;">NAT</div>

      {% if nat.gus_dropoff or nat.gus_pickup %}
      <div style="padding:6px 10px 0;display:flex;gap:6px;flex-wrap:wrap;">
        {% if nat.gus_dropoff %}<span style="display:inline-block;background:#000;color:#fff;border-radius:4px;padding:3px 8px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;">GUS DROP 7A</span>{% endif %}
        {% if nat.gus_pickup %}<span style="display:inline-block;background:#000;color:#fff;border-radius:4px;padding:3px 8px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;">GUS PICK 5P</span>{% endif %}
      </div>
      {% endif %}

      <div style="padding:4px 10px;">
        {% for item in nat.items %}
        <div style="display:flex;align-items:flex-start;padding:3px 0;font-size:14px;font-weight:700;line-height:1.25;">
          {% if item.glyph %}<span style="display:inline-block;border:1.5px solid #000;padding:0 4px;font-size:11px;font-weight:800;line-height:16px;min-width:14px;text-align:center;margin:1px 8px 0 0;flex-shrink:0;">{{ item.glyph }}</span>{% endif %}
          <span style="font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;margin:1px 8px 0 0;flex-shrink:0;min-width:54px;">{{ item.time }}</span>
          <span style="flex:1;word-wrap:break-word;overflow-wrap:break-word;">{{ item.title }}</span>
        </div>
        {% endfor %}
      </div>

      {% if nat.tasks.size > 0 %}
      <div style="margin:4px 10px 0;border-top:1.5px solid #000;padding-top:4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">TASKS</div>
      <div style="padding:2px 10px;">
        {% for task in nat.tasks %}
        <div style="display:flex;align-items:flex-start;padding:3px 0;font-size:14px;font-weight:700;line-height:1.25;">
          {% if task.is_overdue %}
          <span style="display:inline-block;border:1.5px solid #000;padding:0 4px;font-size:11px;font-weight:800;line-height:14px;min-width:10px;text-align:center;margin:1px 8px 0 0;flex-shrink:0;">!</span>
          {% else %}
          <span style="display:inline-block;border:1.5px solid #000;width:10px;height:10px;margin:3px 8px 0 0;flex-shrink:0;"></span>
          {% endif %}
          <span style="flex:1;word-wrap:break-word;overflow-wrap:break-word;">{{ task.name }}</span>
        </div>
        {% endfor %}
      </div>
      {% endif %}

    </div>

  </div>

  <!-- Footer: thin solid top rule + "updated <time>" -->
  <div style="border-top:2px solid #000;padding:3px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">updated {{ generated_at }}</div>

</div>`
