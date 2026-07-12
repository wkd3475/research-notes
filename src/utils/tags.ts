import type { CollectionEntry } from 'astro:content';
import { href } from '../config';
import { type Locale, parseNoteId } from '../i18n';
import { filterNotesByLocale, sortNotesByWrittenOrder } from './notes';
import { filterReadingQueueByLocale } from './readingQueue';

export type NoteEntry = CollectionEntry<'notes'>;
export type QueueEntry = CollectionEntry<'readingQueue'>;

export function tagPath(tag: string): string {
  return `/notes/tags/${encodeURIComponent(tag)}/`;
}

export function tagHref(tag: string, locale: Locale): string {
  return href(tagPath(tag), locale);
}

export function decodeTagParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

export function collectTags(
  notes: NoteEntry[],
  queue: QueueEntry[],
  locale: Locale,
): string[] {
  const tags = new Set<string>();

  for (const note of filterNotesByLocale(notes, locale)) {
    note.data.tags.forEach((tag) => tags.add(tag));
  }

  for (const item of filterReadingQueueByLocale(queue, locale)) {
    item.data.tags.forEach((tag) => tags.add(tag));
  }

  return [...tags].sort((a, b) => a.localeCompare(b));
}

export function filterNotesByTag(
  notes: NoteEntry[],
  locale: Locale,
  tag: string,
): NoteEntry[] {
  return sortNotesByWrittenOrder(
    filterNotesByLocale(notes, locale).filter((note) => note.data.tags.includes(tag)),
  );
}

export function filterQueueByTag(
  queue: QueueEntry[],
  locale: Locale,
  tag: string,
): QueueEntry[] {
  return filterReadingQueueByLocale(queue, locale)
    .filter((item) => item.data.tags.includes(tag))
    .sort((a, b) => b.data.savedAt.valueOf() - a.data.savedAt.valueOf());
}
