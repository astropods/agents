const COMMON_PARAMS: Record<string, string> = {
  daily: "weather_code,temperature_2m_max,temperature_2m_min",
  timezone: "auto",
  wind_speed_unit: "mph",
  temperature_unit: "fahrenheit",
  precipitation_unit: "inch",
};

function buildWeatherUrl(
  base: string,
  latitude: number,
  longitude: number,
  start_date: string,
  end_date: string,
): string {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    ...COMMON_PARAMS,
    start_date,
    end_date,
  });
  return `${base}?${params}`;
}

export async function getWeatherForecast(
  latitude: number,
  longitude: number,
  start_date: string,
  end_date: string,
): Promise<unknown> {
  const url = buildWeatherUrl(
    "https://api.open-meteo.com/v1/forecast",
    latitude,
    longitude,
    start_date,
    end_date,
  );
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather forecast API error: ${res.status}`);
  return res.json();
}

export async function getHistoricalWeather(
  latitude: number,
  longitude: number,
  start_date: string,
  end_date: string,
): Promise<unknown> {
  const url = buildWeatherUrl(
    "https://archive-api.open-meteo.com/v1/archive",
    latitude,
    longitude,
    start_date,
    end_date,
  );
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Historical weather API error: ${res.status}`);
  return res.json();
}
