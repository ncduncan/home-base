import type { WeatherDay } from '../types'

// Boston, MA
const LAT = 42.3601
const LON = -71.0589

export function wmoToIcon(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 2) return '🌤️'
  if (code === 3) return '☁️'
  if (code <= 48) return '🌫️'
  if (code <= 67) return '🌧️'
  if (code <= 77) return '❄️'
  if (code <= 82) return '🌦️'
  return '⛈️'
}

export async function fetchWeatherForecast(): Promise<WeatherDay[]> {
  const params = new URLSearchParams({
    latitude: String(LAT),
    longitude: String(LON),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    temperature_unit: 'fahrenheit',
    timezone: 'America/New_York',
    forecast_days: '14',
  })

  const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!resp.ok) return []

  const data = await resp.json() as {
    daily: {
      time: string[]
      weather_code: number[]
      temperature_2m_max: number[]
      temperature_2m_min: number[]
    }
  }

  return data.daily.time.map((date, i) => ({
    date,
    weatherCode: data.daily.weather_code[i],
    tempMin: Math.round(data.daily.temperature_2m_min[i]),
    tempMax: Math.round(data.daily.temperature_2m_max[i]),
  }))
}
