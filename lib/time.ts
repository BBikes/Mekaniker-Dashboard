const TIME_ZONE = "Europe/Copenhagen";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const longDateFormatter = new Intl.DateTimeFormat("da-DK", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const shortDateFormatter = new Intl.DateTimeFormat("da-DK", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

const hoursFormatter = new Intl.NumberFormat("da-DK", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

const integerFormatter = new Intl.NumberFormat("da-DK", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const decimalFormatter = new Intl.NumberFormat("da-DK", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const timeFormatter = new Intl.DateTimeFormat("da-DK", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("da-DK", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
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

export function formatShortCopenhagenDate(date: string | Date): string {
  const value = typeof date === "string" ? new Date(`${date}T12:00:00Z`) : date;
  return shortDateFormatter.format(value);
}

export function formatCopenhagenTime(date: string | Date | null | undefined): string {
  if (!date) {
    return "ikke tilgængelig";
  }

  return timeFormatter.format(typeof date === "string" ? new Date(date) : date);
}

export function formatCopenhagenDateTime(date: string | Date | null | undefined): string {
  if (!date) {
    return "ikke tilgængelig";
  }

  return dateTimeFormatter.format(typeof date === "string" ? new Date(date) : date);
}

export function formatHours(hours: number): string {
  return `${hoursFormatter.format(hours)} t`;
}

export function formatDecimal(value: number): string {
  return decimalFormatter.format(value);
}

export function formatInteger(value: number): string {
  return integerFormatter.format(value);
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
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

export function getMonthKey(dateString: string) {
  return dateString.slice(0, 7);
}

export function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateFormatter.format(date);
}

export function getStartOfWeek(dateString: string): string {
  const date = new Date(`${dateString}T12:00:00Z`);
  const dayNumber = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNumber);
  return dateFormatter.format(date);
}

export function getStartOfMonth(dateString: string): string {
  return `${dateString.slice(0, 7)}-01`;
}

export function countWeekdaysBetween(fromDate: string, toDate: string): number {
  if (fromDate > toDate) {
    return 0;
  }

  let count = 0;
  let current = fromDate;

  while (current <= toDate) {
    const date = new Date(`${current}T12:00:00Z`);
    const day = date.getUTCDay();

    if (day >= 1 && day <= 5) {
      count += 1;
    }

    current = addDays(current, 1);
  }

  return count;
}

export function formatShortDateRange(fromDate: string, toDate: string): string {
  if (fromDate === toDate) {
    return formatShortCopenhagenDate(fromDate);
  }

  return `${formatShortCopenhagenDate(fromDate)} - ${formatShortCopenhagenDate(toDate)}`;
}

export function toIsoTimestamp(date = new Date()) {
  return date.toISOString();
}
