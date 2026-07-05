import type { Locale } from '../i18n';

/** Study dates and note timestamps are shown in Korea Standard Time. */
export const DISPLAY_TIMEZONE = 'Asia/Seoul';

const localeTag: Record<Locale, string> = { en: 'en-US', ko: 'ko-KR' };

export function formatDisplayDate(
  date: Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
): string {
  return date.toLocaleDateString(localeTag[locale], {
    ...options,
    timeZone: DISPLAY_TIMEZONE,
  });
}

export function toDateKey(date: Date, timeZone = DISPLAY_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Parse YYYY-MM-DD as a stable calendar date for formatting in DISPLAY_TIMEZONE. */
export function dateFromCalendarKey(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}
