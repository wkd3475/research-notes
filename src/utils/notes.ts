import type { CollectionEntry } from 'astro:content';
import { type Locale, parseNoteId } from '../i18n';

export function filterNotesByLocale(
  notes: CollectionEntry<'notes'>[],
  locale: Locale,
): CollectionEntry<'notes'>[] {
  return notes.filter((note) => {
    const { locale: noteLocale } = parseNoteId(note.id);
    return noteLocale === locale && !note.data.draft;
  });
}

export function findNoteByTranslationId(
  notes: CollectionEntry<'notes'>[],
  translationId: string,
  locale: Locale,
) {
  return notes.find((note) => {
    const parsed = parseNoteId(note.id);
    return parsed.translationId === translationId && parsed.locale === locale;
  });
}

export function getTranslationIds(notes: CollectionEntry<'notes'>[], locale: Locale): Set<string> {
  return new Set(
    filterNotesByLocale(notes, locale).map((note) => parseNoteId(note.id).translationId),
  );
}
