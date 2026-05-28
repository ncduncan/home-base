/**
 * Open-Meteo client (free, no key) — Boston forecast for the TRMNL display.
 * Returns just today's high/low + a coarse weather glyph keyword the Liquid
 * template can render as plain ASCII (the screen is 1-bit, no emoji).
 */

const LAT = 42.3601
const LON = -71.0589

export type WeatherGlyph = 'sun' | 'pcloud' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm'

export type WeatherToday = {
  glyph: WeatherGlyph
  high: number
  low: number
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

export async function fetchTodayWeather(today: string): Promise<WeatherToday | null> {
  const params = new URLSearchParams({
    latitude: String(LAT),
    longitude: String(LON),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    temperature_unit: 'fahrenheit',
    timezone: 'America/New_York',
    forecast_days: '2',
  })

  const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!resp.ok) return null

  const data = await resp.json() as {
    daily: {
      time: string[]
      weather_code: number[]
      temperature_2m_max: number[]
      temperature_2m_min: number[]
    }
  }

  const idx = data.daily.time.indexOf(today)
  if (idx < 0) return null

  return {
    glyph: wmoToGlyph(data.daily.weather_code[idx]),
    high: Math.round(data.daily.temperature_2m_max[idx]),
    low: Math.round(data.daily.temperature_2m_min[idx]),
  }
}
