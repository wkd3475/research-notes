import type { Locale } from './i18n';
import { localePath } from './i18n';

export const site = {
  title: 'Research Notes',
  description: 'Diving deep until the questions clear',
  githubUsername: 'wkd3475',
  githubRepo: 'research-notes',
} as const;

/** GitHub Pages base path + locale를 포함한 내부 링크 */
export function href(path: string, locale: Locale = 'en'): string {
  if (path.startsWith('http')) return path;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const localized = localePath(locale, path);
  return `${base}${localized}`;
}
