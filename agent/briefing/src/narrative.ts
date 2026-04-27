import type { BriefingData } from './briefing-data.ts'

export type Narrative = {
  /** Short friendly intro paragraph (1-3 sentences) */
  intro: string
  /** Action items — things to decide / heads-up this week */
  actionItems: string[]
}

const MODEL = 'gemini-2.0-flash'

/**
 * Send the BriefingData to Gemini and ask for a friendly intro paragraph
 * plus a short list of action items. Failures fall back to a deterministic
 * stub — the briefing should still send even if the API is down.
 */
export async function generateNarrative(
  apiKey: string,
  data: BriefingData,
): Promise<Narrative> {
  const prompt = buildPrompt(data)

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'object',
              properties: {
                intro: { type: 'string' },
                actionItems: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['intro', 'actionItems'],
            },
          },
        }),
      }
    )

    if (!resp.ok) {
      console.warn(`Gemini API ${resp.status} — using fallback narrative`)
      return fallbackNarrative(data)
    }

    const json = await resp.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      console.warn('Gemini returned no text — using fallback')
      return fallbackNarrative(data)
    }

    const parsed = JSON.parse(text) as Narrative
    if (typeof parsed.intro !== 'string' || !Array.isArray(parsed.actionItems)) {
      console.warn('Gemini returned malformed JSON — using fallback')
      return fallbackNarrative(data)
    }
    return parsed
  } catch (e) {
    console.warn('Gemini narrative pass failed:', (e as Error).message)
    return fallbackNarrative(data)
  }
}

function buildPrompt(data: BriefingData): string {
  // Pass JSON; let Gemini reason over the structured data. Keep it short.
  const summary = {
    weekStart: data.week.startDate,
    weekEnd: data.week.endDate,
    days: data.days.map(d => ({
      date: d.date,
      label: d.label,
      isWeekend: d.isWeekend,
      nat: d.natEvents.map(e => ({ text: e.text, time: e.time })),
      caitie: d.caitieEvents.map(e => ({ text: e.text, time: e.time })),
      gus: d.gus ? { pickup: d.gus.pickup, dropoff: d.gus.dropoff, reason: d.gus.reason } : null,
    })),
    todos: data.todos.map(t => ({
      title: t.title,
      due: t.dueOn,
      bucket: t.bucket,
      owner: t.owner,
    })),
    conflicts: data.conflicts,
  }

  return `You are writing the intro of a weekly briefing email for a couple — Nat and Caitie. Caitie is a medical resident; her shifts come from AMION. They share Gus (their dog) — pickup is 5pm, dropoff is 7am on weekdays. The current week is ${data.week.startDate} to ${data.week.endDate}.

Below is the structured data for the week. Write:
1. "intro": a friendly 1-3 sentence paragraph greeting the week — call out the shape of the week (busy/light, who has the bigger load, any standout days). Warm, plainspoken, no exclamation points unless something genuinely warrants it.
2. "actionItems": a short list (0-5) of things to actually decide or watch for this week — be specific and actionable. Examples: "Find a sitter for Gus pickup Wednesday — both have evening events", "Caitie's NC overnights Thu–Sat means Nat handles all 7am dropoffs". Skip items that are already obvious from the schedule.

Data:
${JSON.stringify(summary, null, 2)}`
}

function fallbackNarrative(data: BriefingData): Narrative {
  const totalEvents = data.days.reduce(
    (sum, d) => sum + d.natEvents.length + d.caitieEvents.length,
    0,
  )
  const intro = `Here's a look at the week of ${data.week.startDate}. ${totalEvents} events on the schedule.`
  const actionItems = data.conflicts.map(c => c.description)
  return { intro, actionItems }
}
