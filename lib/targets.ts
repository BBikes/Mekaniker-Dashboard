import "server-only";

import { addDays } from "@/lib/time";

const danishHolidayCache = new Map<number, Set<string>>();

export async function fetchDanishHolidaysForYear(year: number): Promise<Set<string>> {
  const cached = danishHolidayCache.get(year);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/DK`);
    if (!response.ok) {
      return new Set<string>();
    }

    const data = (await response.json()) as Array<{ date: string }>;
    const holidays = new Set(data.map((holiday) => holiday.date));
    danishHolidayCache.set(year, holidays);
    return holidays;
  } catch {
    return new Set<string>();
  }
}

export async function getDailyTargetHoursForDate(statDate: string): Promise<number> {
  const date = new Date(`${statDate}T12:00:00Z`);
  const dayOfWeek = date.getUTCDay();

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return 0;
  }

  const holidays = await fetchDanishHolidaysForYear(date.getUTCFullYear());
  if (holidays.has(statDate)) {
    return 0;
  }

  return dayOfWeek === 5 ? 7.0 : 7.5;
}

export async function getTargetHoursBetween(fromDate: string, toDate: string): Promise<number> {
  if (fromDate > toDate) {
    return 0;
  }

  let current = fromDate;
  let totalHours = 0;

  while (current <= toDate) {
    totalHours += await getDailyTargetHoursForDate(current);
    current = addDays(current, 1);
  }

  return totalHours;
}

export async function getTargetQuartersBetween(fromDate: string, toDate: string): Promise<number> {
  return (await getTargetHoursBetween(fromDate, toDate)) * 4;
}