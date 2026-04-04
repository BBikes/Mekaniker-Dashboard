const TIME_ZONE = "Europe/Copenhagen";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const longDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("da-DK", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

export function getCopenhagenDateString(date = new Date()): string {
  return dateFormatter.format(date);
}

export function formatCopenhagenDate(date: string | Date): string {
  const value = typeof date === "string" ? new Date(`${date}T12:00:00Z`) : date;
  return longDateFormatter.format(value);
}

export function formatCopenhagenTime(date: string | Date | null | undefined): string {
  if (!date) {
    return "N/A";
  }

  return timeFormatter.format(typeof date === "string" ? new Date(date) : date);
}

export function formatHours(hours: number): string {
  return `${hours.toFixed(2)} h`;
}

export function getWeekKey(dateString: string): string {
  const date = new Date(`${dateString}T12:00:00Z`);
  const dayNumber = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstThursdayDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNumber + 3);
  const weekNumber = 1 + Math.round((date.getTime() - firstThursday.getTime()) / 604800000);
  return `${date.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

export function getMonthKey(dateString: string): string {
  return dateString.slice(0, 7);
}

export function toIsoTimestamp(date = new Date()): string {
  return date.toISOString();
}
