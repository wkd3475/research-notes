import { defineCollection, z } from 'astro:content';
import { notesLoader } from './content/notesLoader';

const exploreNextItem = z.object({
  label: z.string(),
  reason: z.string().optional(),
  note: z.string().optional(),
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
  }),
});

export const collections = { notes };

export type ExploreNextItem = z.infer<typeof exploreNextItem>;
