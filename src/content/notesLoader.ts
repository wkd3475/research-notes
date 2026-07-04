import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Loader, LoaderContext } from 'astro/loaders';
import { glob } from 'tinyglobby';
import { parse as parseYaml } from 'yaml';

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseContentFile(raw: string): { title: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { title: 'Untitled', body: raw };
  }

  const [, yaml, body] = match;
  const titleMatch = yaml.match(/^title:\s*(.+)$/m);
  return {
    title: titleMatch ? unquote(titleMatch[1]) : 'Untitled',
    body,
  };
}

async function syncNotes(context: LoaderContext) {
  const { parseData, store, generateDigest, renderMarkdown, logger } = context;
  const baseDir = fileURLToPath(new URL('./notes', import.meta.url));
  const rootDir = fileURLToPath(context.config.root);

  if (!existsSync(baseDir)) {
    logger.warn(`Notes directory not found: ${baseDir}`);
    return;
  }

  const contentFiles = await glob('**/content.md', {
    cwd: baseDir,
    absolute: true,
  });

  const untouchedEntries = new Set(store.keys());

  for (const contentPath of contentFiles) {
    const noteDir = dirname(contentPath);
    const metaPath = resolve(noteDir, 'meta.yaml');
    const id = relative(baseDir, noteDir).replace(/\\/g, '/');

    if (!existsSync(metaPath)) {
      logger.warn(`Missing meta.yaml for ${id}`);
      continue;
    }

    untouchedEntries.delete(id);

    const contentRaw = await readFile(contentPath, 'utf-8');
    const metaRaw = await readFile(metaPath, 'utf-8');
    const { title, body } = parseContentFile(contentRaw);
    const meta = parseYaml(metaRaw) ?? {};

    const data = await parseData({
      id,
      data: { title, ...meta },
      filePath: relative(rootDir, contentPath),
    });

    const digest = generateDigest(`${contentRaw}\n---\n${metaRaw}`);
    const rendered = await renderMarkdown(body, {
      fileURL: pathToFileURL(contentPath),
    });

    store.set({
      id,
      data,
      body,
      filePath: relative(rootDir, contentPath),
      digest,
      rendered,
    });
  }

  untouchedEntries.forEach((id) => store.delete(id));
}

export function notesLoader(): Loader {
  return {
    name: 'notes-loader',
    load: async (context) => {
      await syncNotes(context);

      const { watcher, logger, config } = context;
      if (!watcher) return;

      const baseDir = fileURLToPath(new URL('./notes', import.meta.url));
      const rootDir = fileURLToPath(config.root);
      watcher.add(baseDir);

      const onNoteChange = async (changedPath: string) => {
        if (!changedPath.startsWith(baseDir)) return;
        await syncNotes(context);
        logger.info(`Reloaded notes after ${relative(rootDir, changedPath)}`);
      };

      watcher.on('change', onNoteChange);
      watcher.on('add', onNoteChange);
      watcher.on('unlink', onNoteChange);
    },
  };
}
