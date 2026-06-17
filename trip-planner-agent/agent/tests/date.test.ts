import { describe, expect, test } from "bun:test";
import { getTodaysDate } from "../tools/date.js";

describe("getTodaysDate", () => {
  test("returns date in YYYY-MM-DD format", () => {
    const result = getTodaysDate();
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("returns a valid day of week", () => {
    const result = getTodaysDate();
    const validDays = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    expect(validDays).toContain(result.day_of_week);
  });

  test("date matches today in UTC when no timezone given", () => {
    const result = getTodaysDate();
    const expected = new Date().toLocaleDateString("sv", { timeZone: "UTC" });
    expect(result.date).toBe(expected);
  });

  test("uses the provided timezone for date calculation", () => {
    const tz = "America/New_York";
    const result = getTodaysDate(tz);
    const expected = new Date().toLocaleDateString("sv", { timeZone: tz });
    expect(result.date).toBe(expected);
  });

  test("different timezones can produce different dates near midnight", () => {
    // Verify toLocaleDateString with timezone is what drives the result
    // by checking that a UTC+14 and UTC-12 timezone produce dates ±1 day apart at most
    const early = getTodaysDate("Etc/GMT-14"); // UTC+14, furthest ahead
    const late = getTodaysDate("Etc/GMT+12"); // UTC-12, furthest behind
    const dayDiff =
      (new Date(early.date).getTime() - new Date(late.date).getTime()) /
      (1000 * 60 * 60 * 24);
    expect(dayDiff).toBeGreaterThanOrEqual(0);
    expect(dayDiff).toBeLessThanOrEqual(2);
  });

  test("day_of_week matches the date returned", () => {
    const result = getTodaysDate("Europe/Paris");
    const parsed = new Date(`${result.date}T12:00:00`);
    const expected = parsed.toLocaleDateString("en-US", { weekday: "long" });
    expect(result.day_of_week).toBe(expected);
  });
});
