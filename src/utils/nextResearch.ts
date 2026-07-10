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
  const items: NextResearchEntry[] = [];

  for (const note of filterNotesByLocale(notes, locale)) {
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

  return items.sort((a, b) => {
    if (!options?.pendingOnly) {
      const aPending = a.note ? 1 : 0;
      const bPending = b.note ? 1 : 0;
      if (aPending !== bPending) return aPending - bPending;
    }
    return a.label.localeCompare(b.label, locale);
  });
}
