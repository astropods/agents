import { beforeEach, describe, expect, mock, test } from "bun:test";
import { getHistoricalWeather, getWeatherForecast } from "../tools/weather.js";

const mockWeatherData = {
  daily: {
    time: ["2025-06-01", "2025-06-02"],
    weather_code: [1, 3],
    temperature_2m_max: [75.2, 68.1],
    temperature_2m_min: [62.1, 55.4],
  },
};

beforeEach(() => {
  global.fetch = mock(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockWeatherData),
    } as Response),
  ) as unknown as typeof fetch;
});

describe("getWeatherForecast", () => {
  test("calls open-meteo forecast endpoint", async () => {
    await getWeatherForecast(40.7128, -74.006, "2025-06-01", "2025-06-02");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("api.open-meteo.com/v1/forecast"),
    );
  });

  test("includes required query params", async () => {
    await getWeatherForecast(40.7128, -74.006, "2025-06-01", "2025-06-02");
    const url = (global.fetch as unknown as ReturnType<typeof mock>).mock
      .calls[0][0] as string;
    expect(url).toContain("latitude=40.7128");
    expect(url).toContain("longitude=-74.006");
    expect(url).toContain("start_date=2025-06-01");
    expect(url).toContain("end_date=2025-06-02");
    expect(url).toContain("temperature_unit=fahrenheit");
  });

  test("returns parsed JSON response", async () => {
    const result = await getWeatherForecast(
      40.7128,
      -74.006,
      "2025-06-01",
      "2025-06-02",
    );
    expect(result).toEqual(mockWeatherData);
  });

  test("throws on non-ok response", async () => {
    global.fetch = mock(() =>
      Promise.resolve({ ok: false, status: 500 } as Response),
    ) as unknown as typeof fetch;
    await expect(
      getWeatherForecast(0, 0, "2025-06-01", "2025-06-02"),
    ).rejects.toThrow("Weather forecast API error: 500");
  });
});

describe("getHistoricalWeather", () => {
  test("calls open-meteo archive endpoint", async () => {
    await getHistoricalWeather(40.7128, -74.006, "2024-06-01", "2024-06-02");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("archive-api.open-meteo.com/v1/archive"),
    );
  });

  test("throws on non-ok response", async () => {
    global.fetch = mock(() =>
      Promise.resolve({ ok: false, status: 400 } as Response),
    ) as unknown as typeof fetch;
    await expect(
      getHistoricalWeather(0, 0, "2024-06-01", "2024-06-02"),
    ).rejects.toThrow("Historical weather API error: 400");
  });
});
