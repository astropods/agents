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

  test("date matches today", () => {
    const result = getTodaysDate();
    const expected = new Date().toISOString().split("T")[0];
    expect(result.date).toBe(expected);
  });
});
