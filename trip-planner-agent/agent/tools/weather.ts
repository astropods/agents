const COMMON_PARAMS =
  "daily=weather_code,temperature_2m_max,temperature_2m_min" +
  "&timezone=America%2FNew_York" +
  "&wind_speed_unit=mph" +
  "&temperature_unit=fahrenheit" +
  "&precipitation_unit=inch";

export async function getWeatherForecast(
  latitude: number,
  longitude: number,
  start_date: string,
  end_date: string,
): Promise<unknown> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&${COMMON_PARAMS}` +
    `&start_date=${start_date}&end_date=${end_date}`;
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
  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&${COMMON_PARAMS}` +
    `&start_date=${start_date}&end_date=${end_date}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Historical weather API error: ${res.status}`);
  return res.json();
}
