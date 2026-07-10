export const COLOR_MODE_STORAGE_KEY = 'research-notes-color-mode';
export const DEFAULT_COLOR_MODE = 'system';

export const colorModes = ['light', 'dark', 'system'] as const;
export type ColorMode = (typeof colorModes)[number];

export function isColorMode(value: string): value is ColorMode {
  return colorModes.includes(value as ColorMode);
}

export function applyColorMode(mode: ColorMode): void {
  if (mode === 'system') {
    document.documentElement.removeAttribute('data-color-mode');
  } else {
    document.documentElement.setAttribute('data-color-mode', mode);
  }
  localStorage.setItem(COLOR_MODE_STORAGE_KEY, mode);
}

export function readStoredColorMode(): ColorMode {
  try {
    const saved = localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    if (saved && isColorMode(saved)) return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_COLOR_MODE;
}
