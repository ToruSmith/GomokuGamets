import { locale } from '../state/settings.ts';
import { en } from './en.ts';
import { zhTW } from './zh-TW.ts';
import type { MessageKey } from './zh-TW.ts';

export const LOCALES = { 'zh-TW': '繁體中文', en: 'English' } as const;
export type Locale = keyof typeof LOCALES;

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { 'zh-TW': zhTW, en };

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = DICTIONARIES[locale.value][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
}

export type { MessageKey };
