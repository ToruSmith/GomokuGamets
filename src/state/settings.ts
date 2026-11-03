import { load, save } from '../platform/storage.ts';
import { signal } from './signal.ts';
import type { Locale } from '../i18n/index.ts';

export type ThemeSetting = 'system' | 'light' | 'dark';
export const BOARD_SKINS = ['kaya', 'hinoki', 'sumi', 'celadon'] as const;
export type BoardSkin = (typeof BOARD_SKINS)[number];

export interface Settings {
  theme: ThemeSetting;
  skin: BoardSkin;
  locale: Locale;
  sound: boolean;
  coords: boolean;
  numbers: boolean;
  touchConfirm: boolean;
  name: string;
}

function systemLocale(): Locale {
  const language = typeof navigator === 'undefined' ? 'zh-TW' : navigator.language;
  return language.toLowerCase().startsWith('zh') ? 'zh-TW' : 'en';
}

const DEFAULTS: Settings = {
  theme: 'system',
  skin: 'kaya',
  locale: systemLocale(),
  sound: true,
  coords: true,
  numbers: false,
  touchConfirm: true,
  name: '',
};

export const settings = signal<Settings>({ ...DEFAULTS, ...load('settings', {}) });

/** 獨立成一個 signal：改音效不該讓整個介面重新翻譯、重新渲染 */
export const locale = signal<Locale>(settings.peek().locale);

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.peek(), ...patch };
  locale.value = settings.peek().locale;
  save('settings', settings.peek());
}
