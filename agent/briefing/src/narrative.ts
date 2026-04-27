import Anthropic from '@anthropic-ai/sdk'
import type { BriefingData } from './briefing-data.ts'

export type Narrative = {
  /** Short friendly intro paragraph (1-3 sentences) */
  intro: string
  /** Action items — things to decide / heads-up this week */
  actionItems: string[]
}

const MODEL = 'claude-opus-4-7'

// No prompt caching: this agent runs once per week, the cache TTL is 1 hour
// max, and the prompt is well below the 4096-token cache minimum on Opus 4.7.
// Adding cache_control would charge the 1.25x write premium with zero reads.

const SYSTEM_PROMPT = `You are writing the intro of a weekly briefing email for a couple — Nat and Caitie. Caitie is a medical resident; her shifts come from AMION. They share Gus (their dog) — pickup is 5pm, dropoff is 7am on weekdays.

Given the structured data for the upcoming week, produce JSON with two fields:

1. "intro": a friendly 1-3 sentence paragraph greeting the week. Call out the shape of the week (busy/light, who has the bigger load, any standout days). Warm, plainspoken, no exclamation points unless something genuinely warrants it.

2. "actionItems": a short list (0-5) of things to actually decide or watch for this week. Be specific and actionable. Good examples:
   - "Find a sitter for Gus pickup Wednesday — both have evening events"
   - "Caitie's NC overnights Thu–Sat mean Nat handles all 7am dropoffs"
   Skip items that are already obvious from the schedule.`

/**
 * Send the BriefingData to Claude and ask for a friendly intro paragraph
 * plus a short list of action items. Failures fall back to a deterministic
 * stub — the briefing should still send even if the API is down.
 */
export async function generateNarrative(
  apiKey: string,
  data: BriefingData,
): Promise<Narrative> {
  const userPrompt = buildUserPrompt(data)

  try {
    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      output_config: {
        effort: 'medium',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              intro: { type: 'string' },
              actionItems: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['intro', 'actionItems'],
            additionalProperties: false,
          },
        },
      },
    })

    if (response.stop_reason === 'refusal') {
      console.warn('Claude refused — using fallback narrative')
      return fallbackNarrative(data)
    }

    const text = response.content.find(b => b.type === 'text')?.text
    if (!text) {
      console.warn('Claude returned no text — using fallback')
      return fallbackNarrative(data)
    }

    const parsed = JSON.parse(text) as Narrative
    if (typeof parsed.intro !== 'string' || !Array.isArray(parsed.actionItems)) {
      console.warn('Claude returned malformed JSON — using fallback')
      return fallbackNarrative(data)
    }
    return parsed
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      console.warn(`Anthropic API error ${e.status} — using fallback`)
    } else {
      console.warn(`Narrative pass failed: ${(e as Error).name}`)
    }
    return fallbackNarrative(data)
  }
}

function buildUserPrompt(data: BriefingData): string {
  // Pass the structured data as JSON; Claude is good at reasoning over it.
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

  return `Here is the structured data for the week of ${data.week.startDate} to ${data.week.endDate}:\n\n${JSON.stringify(summary, null, 2)}`
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
