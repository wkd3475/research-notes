export const THEME_STORAGE_KEY = 'research-notes-theme';
export const DEFAULT_THEME = 'forest';

export const themes = [
  { id: 'forest', label: 'Forest', swatch: '#2d6a4f' },
  { id: 'ocean', label: 'Ocean', swatch: '#1d4e89' },
  { id: 'sunset', label: 'Sunset', swatch: '#c45c26' },
  { id: 'lavender', label: 'Lavender', swatch: '#6b4c9a' },
  { id: 'rose', label: 'Rose', swatch: '#b5495a' },
] as const;

export type ThemeId = (typeof themes)[number]['id'];

export function isThemeId(value: string): value is ThemeId {
  return themes.some((theme) => theme.id === value);
}
