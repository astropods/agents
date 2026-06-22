export function getTodaysDate(timezone?: string): {
  date: string;
  day_of_week: string;
} {
  const now = new Date();
  const tz = timezone ?? "UTC";
  const date = now.toLocaleDateString("sv", { timeZone: tz }); // sv locale → YYYY-MM-DD
  const day_of_week = now.toLocaleDateString("en-US", {
    timeZone: tz,
    weekday: "long",
  });
  return { date, day_of_week };
}
