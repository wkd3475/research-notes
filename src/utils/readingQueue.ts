import type { CollectionEntry } from 'astro:content';
import { type Locale, parseNoteId } from '../i18n';

export type ReadingQueueEntry = CollectionEntry<'readingQueue'>;

export function filterReadingQueueByLocale(
  items: ReadingQueueEntry[],
  locale: Locale,
): ReadingQueueEntry[] {
  return items.filter((item) => parseNoteId(item.id).locale === locale);
}

export function parseQueueId(id: string): { locale: Locale; slug: string } {
  const { locale, translationId } = parseNoteId(id);
  return { locale, slug: translationId };
}
