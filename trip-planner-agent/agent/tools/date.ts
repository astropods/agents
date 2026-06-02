export function getTodaysDate(): { date: string; day_of_week: string } {
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const day_of_week = days[now.getDay()];
  return { date, day_of_week };
}
