import { useAppStore } from '../store';
import { DEFAULT_LOCALE, I18N_DICT, type I18nKey, type Locale } from './dict';

type I18nParams = Record<string, string | number>;

function interpolate(template: string, params: I18nParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(params[key] ?? ''));
}

export function t(key: I18nKey, params?: I18nParams): string {
  const locale = useAppStore.getState().locale ?? DEFAULT_LOCALE;
  return interpolate(I18N_DICT[key]?.[locale] ?? I18N_DICT[key]?.[DEFAULT_LOCALE] ?? key, params);
}

export function useLocale(): {
  locale: Locale;
  setLocale: (locale: Locale) => void;
} {
  return {
    locale: useAppStore((s) => s.locale),
    setLocale: useAppStore((s) => s.setLocale),
  };
}

export type { I18nKey, Locale };
