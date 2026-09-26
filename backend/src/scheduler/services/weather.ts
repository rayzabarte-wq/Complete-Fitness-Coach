const ENV_LATITUDE = process.env.LOCATION_LAT;
const ENV_LONGITUDE = process.env.LOCATION_LON;

// WMO weather codes (used by Open-Meteo) collapsed down to the handful of
// conditions that actually matter for an indoor/outdoor decision.
const WEATHER_CODE_LABELS: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm",
  99: "Thunderstorm",
};

export interface DayForecast {
  date: string; // YYYY-MM-DD
  condition: string;
  tempMaxC: number;
  tempMinC: number;
  precipProbability: number; // %
  windMaxMph: number;
  // A simple, explainable heuristic — not a substitute for judgment, just
  // a quick signal: high rain chance or high wind pushes toward indoor.
  outdoorRecommended: boolean;
}

/** True if we have coordinates to work with — either passed in from the
 * device (preferred, since the app is multi-user and everyone's in a
 * different place) or a fallback configured via env vars. */
export function isWeatherConfigured(overrideLat?: string, overrideLon?: string): boolean {
  return Boolean((overrideLat && overrideLon) || (ENV_LATITUDE && ENV_LONGITUDE));
}

export async function getTenDayForecast(overrideLat?: string, overrideLon?: string): Promise<DayForecast[]> {
  const latitude = overrideLat ?? ENV_LATITUDE;
  const longitude = overrideLon ?? ENV_LONGITUDE;

  if (!latitude || !longitude) {
    throw new Error(
      "Weather isn't configured — allow location access in the app, or set LOCATION_LAT and LOCATION_LON in .env as a fallback"
    );
  }

  const params = new URLSearchParams({
    latitude,
    longitude,
    daily: "weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max",
    timezone: "auto",
    forecast_days: "10",
    temperature_unit: "celsius",
    windspeed_unit: "mph",
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Weather lookup failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    daily: {
      time: string[];
      weathercode: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: number[];
      windspeed_10m_max: number[];
    };
  };

  return data.daily.time.map((date, i) => {
    const precipProbability = data.daily.precipitation_probability_max[i];
    const windMaxMph = data.daily.windspeed_10m_max[i];
    return {
      date,
      condition: WEATHER_CODE_LABELS[data.daily.weathercode[i]] ?? "Unknown",
      tempMaxC: Math.round(data.daily.temperature_2m_max[i]),
      tempMinC: Math.round(data.daily.temperature_2m_min[i]),
      precipProbability,
      windMaxMph: Math.round(windMaxMph),
      outdoorRecommended: precipProbability < 30 && windMaxMph < 25,
    };
  });
}
