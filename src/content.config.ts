import { defineCollection, z } from 'astro:content';
import { nextResearchLoader } from './content/nextResearchLoader';
import { notesLoader } from './content/notesLoader';
import { readingQueueLoader } from './content/readingQueueLoader';

const exploreNextItem = z.object({
  id: z.string(),
  label: z.string(),
  reason: z.string().optional(),
  note: z.string().optional(),
});

const localizedText = z.object({
  en: z.string(),
  ko: z.string(),
});

const notes = defineCollection({
  loader: notesLoader(),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    exploreNext: z.array(exploreNextItem).default([]),
    exploredFrom: z.string().optional(),
    readingQueueFrom: z.string().optional(),
  }),
});

const nextResearch = defineCollection({
  loader: nextResearchLoader(),
  schema: z.object({
    label: localizedText,
    reason: localizedText.optional(),
    note: z.string().optional(),
  }),
});

const readingQueue = defineCollection({
  loader: readingQueueLoader(),
  schema: z.object({
    title: z.string(),
    url: z.string().url(),
    reason: z.string(),
    savedAt: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    source: z.string().optional(),
  }),
});

export const collections = { notes, nextResearch, readingQueue };

export type ExploreNextItem = z.infer<typeof exploreNextItem>;
