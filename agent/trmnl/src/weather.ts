/**
 * Open-Meteo client (free, no key) — Boston forecast for the TRMNL header.
 * Returns three time-of-day forecasts (morning / midday / evening) instead of
 * a daily hi/lo, so the header matches the rhythm of the user's day.
 */

const LAT = 42.3601
const LON = -71.0589
const SLOT_HOURS = [7, 12, 17] as const  // 7a, 12p, 5p

export type WeatherGlyph = 'sun' | 'pcloud' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm'

export type WeatherSlot = {
  /** Compact display label, e.g. "7A", "12P", "5P". */
  label: string
  glyph: WeatherGlyph
  /** Temperature in °F (rounded). */
  temp: number
}

export type WeatherToday = {
  slots: WeatherSlot[]
}

function wmoToGlyph(code: number): WeatherGlyph {
  if (code === 0) return 'sun'
  if (code <= 2) return 'pcloud'
  if (code === 3) return 'cloud'
  if (code <= 48) return 'fog'
  if (code <= 67) return 'rain'
  if (code <= 77) return 'snow'
  if (code <= 82) return 'rain'
  return 'storm'
}

function slotLabel(hour: number): string {
  if (hour === 12) return '12P'
  if (hour === 0) return '12A'
  const h = hour % 12
  return `${h}${hour < 12 ? 'A' : 'P'}`
}

export async function fetchTodayWeather(today: string): Promise<WeatherToday | null> {
  const params = new URLSearchParams({
    latitude: String(LAT),
    longitude: String(LON),
    hourly: 'temperature_2m,weather_code',
    temperature_unit: 'fahrenheit',
    timezone: 'America/New_York',
    start_date: today,
    end_date: today,
  })

  const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!resp.ok) return null

  const data = await resp.json() as {
    hourly: {
      time: string[]
      temperature_2m: number[]
      weather_code: number[]
    }
  }

  const slots: WeatherSlot[] = []
  for (const hour of SLOT_HOURS) {
    const stamp = `${today}T${hour < 10 ? '0' : ''}${hour}:00`
    const idx = data.hourly.time.indexOf(stamp)
    if (idx < 0) continue
    slots.push({
      label: slotLabel(hour),
      glyph: wmoToGlyph(data.hourly.weather_code[idx]),
      temp: Math.round(data.hourly.temperature_2m[idx]),
    })
  }

  if (slots.length === 0) return null
  return { slots }
}
