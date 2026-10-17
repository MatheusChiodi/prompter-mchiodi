import type { UiLang } from './i18n';

export type Settings = {
  uiLang: UiLang;
  fontSize: number;
  focus: number;
  mirrorH: boolean;
  mirrorV: boolean;
  lang: string;
  speakHeadings: boolean;
  lostAfterSec: number;
  wpm: number;
};

export const DEFAULT_SETTINGS: Settings = {
  uiLang: typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('pt') === false ? 'en' : 'pt',
  fontSize: 52,
  focus: 0.33,
  mirrorH: false,
  mirrorV: false,
  lang: 'pt-BR',
  speakHeadings: false,
  lostAfterSec: 6,
  wpm: 150,
};

const KEY = 'prompter-mchiodi:settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* modo privado */
  }
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
