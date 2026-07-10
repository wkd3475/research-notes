import type { CollectionEntry } from 'astro:content';
import type { ExploreNextItem } from '../content.config';
import { type Locale, parseNoteId } from '../i18n';
import { filterNotesByLocale } from './notes';

export type NextResearchEntry = ExploreNextItem & {
  fromNoteId: string;
  fromTitle: string;
};

export function collectNextResearchItems(
  notes: CollectionEntry<'notes'>[],
  locale: Locale,
  options?: { pendingOnly?: boolean },
): NextResearchEntry[] {
  const localeNotes = filterNotesByLocale(notes, locale);
  const pubDates = new Map(
    localeNotes.map((note) => [parseNoteId(note.id).translationId, note.data.pubDate.valueOf()]),
  );
  const items: NextResearchEntry[] = [];

  for (const note of localeNotes) {
    const { translationId } = parseNoteId(note.id);
    for (const item of note.data.exploreNext) {
      if (options?.pendingOnly && item.note) continue;
      items.push({
        ...item,
        fromNoteId: translationId,
        fromTitle: note.data.title,
      });
    }
  }

  const sorted = items.sort((a, b) => {
    if (!options?.pendingOnly) {
      const aPending = a.note ? 1 : 0;
      const bPending = b.note ? 1 : 0;
      if (aPending !== bPending) return aPending - bPending;
    }
    return a.label.localeCompare(b.label, locale);
  });

  if (!options?.pendingOnly) return sorted;

  const seen = new Map<string, NextResearchEntry>();
  for (const item of sorted) {
    const existing = seen.get(item.label);
    if (!existing) {
      seen.set(item.label, item);
      continue;
    }

    const existingDate = pubDates.get(existing.fromNoteId) ?? 0;
    const itemDate = pubDates.get(item.fromNoteId) ?? 0;
    if (itemDate > existingDate) {
      seen.set(item.label, item);
    }
  }

  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, locale));
}
