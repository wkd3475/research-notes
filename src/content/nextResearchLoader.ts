import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Loader, LoaderContext } from 'astro/loaders';
import { glob } from 'tinyglobby';
import { parse as parseYaml } from 'yaml';

async function syncNextResearch(context: LoaderContext) {
  const { parseData, store, generateDigest, logger } = context;
  const baseDir = fileURLToPath(new URL('./nextResearch', import.meta.url));
  const rootDir = fileURLToPath(context.config.root);

  if (!existsSync(baseDir)) {
    logger.warn(`Next research directory not found: ${baseDir}`);
    return;
  }

  const yamlFiles = await glob('*.yaml', {
    cwd: baseDir,
    absolute: true,
  });

  const untouchedEntries = new Set(store.keys());

  for (const filePath of yamlFiles) {
    const id = basename(filePath, '.yaml');
    untouchedEntries.delete(id);

    const raw = await readFile(filePath, 'utf-8');
    const parsed = parseYaml(raw) ?? {};

    const data = await parseData({
      id,
      data: parsed,
      filePath: relative(rootDir, filePath),
    });

    store.set({
      id,
      data,
      filePath: relative(rootDir, filePath),
      digest: generateDigest(raw),
    });
  }

  untouchedEntries.forEach((id) => store.delete(id));
}

export function nextResearchLoader(): Loader {
  return {
    name: 'next-research-loader',
    load: async (context) => {
      await syncNextResearch(context);

      const { watcher, logger, config } = context;
      if (!watcher) return;

      const baseDir = fileURLToPath(new URL('./nextResearch', import.meta.url));
      const rootDir = fileURLToPath(config.root);
      watcher.add(baseDir);

      const onChange = async (changedPath: string) => {
        if (!changedPath.startsWith(baseDir)) return;
        await syncNextResearch(context);
        logger.info(`Reloaded next research after ${relative(rootDir, changedPath)}`);
      };

      watcher.on('change', onChange);
      watcher.on('add', onChange);
      watcher.on('unlink', onChange);
    },
  };
}
