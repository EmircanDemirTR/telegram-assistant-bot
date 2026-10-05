interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = FORMATTER_CACHE.get(timezone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  FORMATTER_CACHE.set(timezone, formatter);
  return formatter;
}

export function getZonedParts(date: Date, timezone: string): ZonedParts {
  const parts = getFormatter(timezone).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((item) => item.type === type)?.value;
    if (!part) {
      throw new Error(`Missing timezone part: ${type}`);
    }
    return Number.parseInt(part, 10);
  };

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second")
  };
}

export function zonedTimeToUtc(parts: ZonedParts, timezone: string): Date {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let result = new Date(utcGuess - getTimezoneOffsetMs(new Date(utcGuess), timezone));
  result = new Date(utcGuess - getTimezoneOffsetMs(result, timezone));
  return result;
}

export function nextDailyOccurrence(
  now: Date,
  timezone: string,
  hour: number,
  minute: number,
  dayOffset = 0
): Date {
  const current = getZonedParts(now, timezone);
  let candidate = zonedTimeToUtc(
    {
      year: current.year,
      month: current.month,
      day: current.day + dayOffset,
      hour,
      minute,
      second: 0
    },
    timezone
  );

  if (candidate.getTime() <= now.getTime()) {
    candidate = zonedTimeToUtc(
      {
        year: current.year,
        month: current.month,
        day: current.day + dayOffset + 1,
        hour,
        minute,
        second: 0
      },
      timezone
    );
  }

  return candidate;
}

export function toDateKey(date: Date, timezone: string): string {
  const parts = getZonedParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function formatDateTime(date: Date | string, timezone: string): string {
  const resolved = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short"
  }).format(resolved);
}

export function formatTimeOnly(date: Date | string, timezone: string): string {
  const resolved = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit"
  }).format(resolved);
}

export function formatDateOnly(date: Date | string, timezone: string): string {
  const resolved = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: timezone,
    dateStyle: "full"
  }).format(resolved);
}

export function localDayRange(date: Date, timezone: string, offsetDays = 0): { start: Date; end: Date } {
  const parts = getZonedParts(date, timezone);
  const start = zonedTimeToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day + offsetDays,
      hour: 0,
      minute: 0,
      second: 0
    },
    timezone
  );
  const end = zonedTimeToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day + offsetDays + 1,
      hour: 0,
      minute: 0,
      second: 0
    },
    timezone
  );
  return { start, end };
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const parts = getZonedParts(date, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}
