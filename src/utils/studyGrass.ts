import type { CollectionEntry } from 'astro:content';
import type { Locale } from '../i18n';

export interface DayNote {
  id: string;
  title: string;
}

export interface GrassDay {
  date: string;
  count: number;
  notes: DayNote[];
  level: 0 | 1 | 2 | 3 | 4;
  isFuture: boolean;
  isToday: boolean;
}

export function formatDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getTodayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

const localeTag: Record<Locale, string> = { en: 'en-US', ko: 'ko-KR' };
const dayLabels: Record<Locale, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ko: ['일', '월', '화', '수', '목', '금', '토'],
};

export function getDayLabels(locale: Locale): string[] {
  return dayLabels[locale];
}

export function formatDateLabel(key: string, locale: Locale = 'en'): string {
  const date = parseDateKey(key);
  return date.toLocaleDateString(localeTag[locale], {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function groupNotesByDate(notes: CollectionEntry<'notes'>[]): Map<string, DayNote[]> {
  const map = new Map<string, DayNote[]>();

  for (const note of notes) {
    const key = formatDateKey(note.data.pubDate);
    const existing = map.get(key) ?? [];
    existing.push({ id: note.id, title: note.data.title });
    map.set(key, existing);
  }

  return map;
}

function getLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count === 3) return 3;
  return 4;
}

export function buildGrassWeeks(notesByDate: Map<string, DayNote[]>, weeks = 53): GrassDay[][] {
  const todayKey = getTodayKey();
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const today = new Date(ty, tm - 1, td);

  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));

  const start = new Date(end);
  start.setDate(start.getDate() - (weeks * 7 - 1));
  start.setDate(start.getDate() - start.getDay());

  const result: GrassDay[][] = [];
  const current = new Date(start);

  while (current <= end) {
    const week: GrassDay[] = [];

    for (let d = 0; d < 7; d++) {
      const y = current.getFullYear();
      const m = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${day}`;
      const dayNotes = notesByDate.get(key) ?? [];
      const isFuture = key > todayKey;

      week.push({
        date: key,
        count: dayNotes.length,
        notes: dayNotes,
        level: isFuture ? 0 : getLevel(dayNotes.length),
        isFuture,
        isToday: key === todayKey,
      });

      current.setDate(current.getDate() + 1);
    }

    result.push(week);
  }

  return result;
}

export function getMonthLabels(
  weeks: GrassDay[][],
  locale: Locale = 'en',
): { label: string; weekIndex: number }[] {
  const labels: { label: string; weekIndex: number }[] = [];
  let lastMonth = -1;

  weeks.forEach((week, weekIndex) => {
    const firstDay = week.find((day) => !day.isFuture) ?? week[0];
    const month = parseDateKey(firstDay.date).getUTCMonth();

    if (month !== lastMonth) {
      labels.push({
        label: parseDateKey(firstDay.date).toLocaleDateString(localeTag[locale], {
          month: 'short',
          timeZone: 'UTC',
        }),
        weekIndex,
      });
      lastMonth = month;
    }
  });

  return labels;
}

export function computeStats(notesByDate: Map<string, DayNote[]>) {
  const activeDays = notesByDate.size;
  const totalNotes = [...notesByDate.values()].reduce((sum, list) => sum + list.length, 0);

  const sortedDates = [...notesByDate.keys()].sort();
  let longestStreak = 0;
  let currentStreak = 0;
  let prev: string | null = null;

  for (const date of sortedDates) {
    if (prev) {
      const prevDate = parseDateKey(prev);
      const currDate = parseDateKey(date);
      const diff = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);

      currentStreak = diff === 1 ? currentStreak + 1 : 1;
    } else {
      currentStreak = 1;
    }

    longestStreak = Math.max(longestStreak, currentStreak);
    prev = date;
  }

  return { activeDays, totalNotes, longestStreak };
}

const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

export function isYearMonth(value: string): boolean {
  return YEAR_MONTH_RE.test(value);
}

export function toYearMonth(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function formatYearMonthLabel(yearMonth: string, locale: Locale = 'en'): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(localeTag[locale], {
    year: 'numeric',
    month: 'long',
  });
}

export function addMonths(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getCurrentYearMonth(): string {
  return getTodayKey().slice(0, 7);
}

export function getMonthsWithNotes(notes: CollectionEntry<'notes'>[]): string[] {
  const months = new Set(notes.map((note) => toYearMonth(formatDateKey(note.data.pubDate))));
  return [...months].sort();
}

export function findPreviousMonthWithNotes(
  yearMonth: string,
  monthsWithNotes: string[],
): string | null {
  const candidates = monthsWithNotes.filter((month) => month < yearMonth);
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
}

export function findNextMonthWithNotes(
  yearMonth: string,
  monthsWithNotes: string[],
  currentYearMonth = getCurrentYearMonth(),
): string | null {
  const candidates = monthsWithNotes.filter(
    (month) => month > yearMonth && month <= currentYearMonth,
  );
  return candidates.length > 0 ? candidates[0] : null;
}

export function getBrowsableMonths(notes: CollectionEntry<'notes'>[]): string[] {
  const current = getCurrentYearMonth();
  const monthsWithNotes = getMonthsWithNotes(notes);
  const monthSet = new Set(monthsWithNotes);

  monthSet.add(current);

  return [...monthSet].sort();
}

export function getEarliestMonthWithNotes(notes: CollectionEntry<'notes'>[]): string | null {
  const months = getMonthsWithNotes(notes);
  return months.length > 0 ? months[0] : null;
}

export function skippedMonthsBetween(earlier: string, later: string): string[] {
  if (earlier >= later) return [];

  const skipped: string[] = [];
  let cursor = addMonths(earlier, 1);

  while (cursor < later) {
    skipped.push(cursor);
    cursor = addMonths(cursor, 1);
  }

  return skipped;
}

export function dayAnchorId(dateKey: string): string {
  return `day-${dateKey}`;
}

export function formatDayHeading(dateKey: string, locale: Locale = 'en'): string {
  const date = parseDateKey(dateKey);
  return date.toLocaleDateString(localeTag[locale], {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'UTC',
  });
}
