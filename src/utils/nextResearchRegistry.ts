import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { ExploreNextItem } from '../content.config';
import type { Locale } from '../i18n';

export type NextResearchRecord = {
  id: string;
  label: { en: string; ko: string };
  reason?: { en: string; ko: string };
  note?: string;
};

export function getNextResearchDir(): string {
  return fileURLToPath(new URL('../content/nextResearch', import.meta.url));
}

export function loadNextResearchRegistry(): Map<string, NextResearchRecord> {
  const dir = getNextResearchDir();
  const registry = new Map<string, NextResearchRecord>();

  if (!existsSync(dir)) return registry;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.yaml')) continue;

    const id = basename(file, '.yaml');
    const raw = readFileSync(join(dir, file), 'utf-8');
    const parsed = parseYaml(raw) ?? {};

    const label = parsed.label ?? {};
    registry.set(id, {
      id,
      label: {
        en: typeof label.en === 'string' ? label.en : id,
        ko: typeof label.ko === 'string' ? label.ko : id,
      },
      reason:
        parsed.reason && typeof parsed.reason === 'object'
          ? {
              en: typeof parsed.reason.en === 'string' ? parsed.reason.en : undefined,
              ko: typeof parsed.reason.ko === 'string' ? parsed.reason.ko : undefined,
            }
          : undefined,
      note: typeof parsed.note === 'string' ? parsed.note : undefined,
    });
  }

  return registry;
}

export function resolveExploreNextIds(
  ids: string[],
  locale: Locale,
  registry: Map<string, NextResearchRecord>,
): ExploreNextItem[] {
  return ids.map((id) => {
    const record = registry.get(id);
    if (!record) {
      return { id, label: id };
    }

    return {
      id,
      label: record.label[locale],
      reason: record.reason?.[locale],
      note: record.note,
    };
  });
}

/** Supports registry IDs (strings) and legacy inline objects from old meta revisions. */
export function resolveExploreNextValue(
  value: unknown,
  locale: Locale,
  registry: Map<string, NextResearchRecord>,
): ExploreNextItem[] {
  if (!Array.isArray(value) || value.length === 0) return [];

  if (typeof value[0] === 'string') {
    return resolveExploreNextIds(value as string[], locale, registry);
  }

  return (value as Array<{ label: string; reason?: string; note?: string }>).map((item, index) => ({
    id: item.note ?? `legacy-${index}-${item.label}`,
    label: item.label,
    reason: item.reason,
    note: item.note,
  }));
}
