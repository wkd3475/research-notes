import type { CollectionEntry } from 'astro:content';
import { type Locale, parseNoteId } from '../i18n';

export type ReferrerNote = {
  translationId: string;
  title: string;
  reason?: string;
};

export type AdjacentNote = {
  translationId: string;
  title: string;
};

export type AdjacentNotes = {
  prev: AdjacentNote | null;
  next: AdjacentNote | null;
};

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

/** Notes that link to `translationId` via exploreNext.note or exploredFrom. */
export function findReferrerNotes(
  notes: CollectionEntry<'notes'>[],
  translationId: string,
  locale: Locale,
  explicitExploredFrom?: string,
): ReferrerNote[] {
  const byId = new Map<string, ReferrerNote>();

  const add = (id: string, title: string, reason?: string) => {
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, { translationId: id, title, reason });
      return;
    }
    if (!existing.reason && reason) {
      byId.set(id, { ...existing, reason });
    }
  };

  for (const note of filterNotesByLocale(notes, locale)) {
    const { translationId: noteId } = parseNoteId(note.id);
    for (const item of note.data.exploreNext) {
      if (item.note === translationId) {
        add(noteId, note.data.title, item.reason);
      }
    }
  }

  if (explicitExploredFrom) {
    const parent = findNoteByTranslationId(notes, explicitExploredFrom, locale);
    if (parent) {
      add(explicitExploredFrom, parent.data.title);
    }
  }

  const result = Array.from(byId.values());
  if (explicitExploredFrom) {
    result.sort((a, b) => {
      if (a.translationId === explicitExploredFrom) return -1;
      if (b.translationId === explicitExploredFrom) return 1;
      return a.title.localeCompare(b.title, locale);
    });
  } else {
    result.sort((a, b) => a.title.localeCompare(b.title, locale));
  }

  return result;
}

/** Chronological neighbors by pubDate (prev = older, next = newer). */
export function getAdjacentNotes(
  notes: CollectionEntry<'notes'>[],
  translationId: string,
  locale: Locale,
): AdjacentNotes {
  const sorted = filterNotesByLocale(notes, locale).sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime(),
  );

  const index = sorted.findIndex((note) => parseNoteId(note.id).translationId === translationId);
  if (index === -1) {
    return { prev: null, next: null };
  }

  const toAdjacent = (note: CollectionEntry<'notes'>): AdjacentNote => ({
    translationId: parseNoteId(note.id).translationId,
    title: note.data.title,
  });

  return {
    prev: index < sorted.length - 1 ? toAdjacent(sorted[index + 1]) : null,
    next: index > 0 ? toAdjacent(sorted[index - 1]) : null,
  };
}
