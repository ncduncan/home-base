import Anthropic from '@anthropic-ai/sdk'
import type { BriefingData } from './briefing-data.ts'

export type Narrative = {
  /** Directional summary paragraph (2-4 sentences) — sets expectations for the week */
  intro: string
  /** Action items — things to decide / heads-up this week */
  actionItems: string[]
}

const MODEL = 'claude-sonnet-4-6'

// No prompt caching: this agent runs once per week, the cache TTL is 1 hour
// max, and the prompt is well below the 4096-token cache minimum on Opus 4.7.
// Adding cache_control would charge the 1.25x write premium with zero reads.

const SYSTEM_PROMPT = `You are writing the intro of a weekly briefing email for a couple — Nat and Caitie. Caitie is a medical resident; her shifts come from AMION. They share Gus (their dog) — pickup is 5pm, dropoff is 7am on weekdays.

Given the structured data for the upcoming week, produce JSON with two fields:

1. "intro": a 2-4 sentence summary that gives a directional sense of the week — what to expect at a glance, not a recap of every event. The grid below the summary already lists the details, so DON'T enumerate individual events, times, or todos. Instead convey the shape of the week: is it busy or light, who's carrying the heavier load, where the pressure points are (e.g. Caitie's overnight stretches, days both are stretched thin, Gus-pickup crunches), and how it trends from start to finish. Warm and plainspoken. No exclamation points unless something genuinely warrants it. If the week is genuinely quiet, say so plainly rather than inventing drama.

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
      // The body is Anthropic's error response (no user content), safe to log.
      console.warn(`Anthropic API error ${e.status}: ${e.message} — using fallback`)
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

/**
 * Deterministic, directional fallback used when the Claude pass is unavailable.
 * Reads the same signals the model would key on — overall load, who's busier,
 * Caitie's overnight stretches, and Gus-pickup crunches — and stitches them
 * into 2-4 plain sentences. No LLM, so it always sends.
 */
function fallbackNarrative(data: BriefingData): Narrative {
  const sentences: string[] = []

  const natCount = data.days.reduce((s, d) => s + d.natEvents.length, 0)
  const caitieCount = data.days.reduce((s, d) => s + d.caitieEvents.length, 0)
  const totalEvents = natCount + caitieCount

  // Caitie's overnight stretches (night / 24hr AMION shifts).
  const overnightDays = data.days.filter(d =>
    d.caitieEvents.some(e => e.amionKind === 'night' || e.amionKind === '24hr'),
  )

  // Days both are stretched (a detected conflict — typ. both have evening events).
  const conflictDays = data.conflicts.length

  // ── Opening: overall shape + who's carrying more ──────────────────────────
  if (totalEvents === 0) {
    sentences.push(`A quiet week ahead — nothing on the calendar for either of you yet.`)
  } else {
    const weight =
      totalEvents >= 24 ? 'a busy week' : totalEvents >= 12 ? 'a moderate week' : 'a light week'
    let lean = ''
    if (caitieCount > natCount * 1.5) lean = ', with Caitie carrying most of the load'
    else if (natCount > caitieCount * 1.5) lean = ', with Nat carrying most of the load'
    else lean = ', fairly balanced between the two of you'
    sentences.push(`Looks like ${weight} (${totalEvents} events on the schedule)${lean}.`)
  }

  // ── Caitie's overnights ───────────────────────────────────────────────────
  if (overnightDays.length === 1) {
    sentences.push(`Caitie has an overnight on ${overnightDays[0].label}, so Nat covers Gus around it.`)
  } else if (overnightDays.length > 1) {
    const first = overnightDays[0].label
    const last = overnightDays[overnightDays.length - 1].label
    sentences.push(
      `Caitie is on overnights across ${overnightDays.length} days (${first} through ${last}), so the Gus mornings fall to Nat.`,
    )
  }

  // ── Pressure points ───────────────────────────────────────────────────────
  if (conflictDays === 1) {
    sentences.push(`One day this week has both of you committed in the evening — keep an eye on Gus pickup.`)
  } else if (conflictDays > 1) {
    sentences.push(`There are ${conflictDays} days where you're both committed in the evening, so Gus pickup may need a hand.`)
  }

  // Keep it to at most 4 sentences.
  const intro = sentences.slice(0, 4).join(' ')
  const actionItems = data.conflicts.map(c => c.description)
  return { intro, actionItems }
}
