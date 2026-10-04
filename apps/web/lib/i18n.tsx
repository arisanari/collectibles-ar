"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/** Supported UI languages. To add one: add an entry here, then TypeScript flags every `Localized` missing it. */
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];
export const DEFAULT_LANG: Lang = "en";

/** One UI string in every supported language. */
export type Localized = Record<Lang, string>;

const STORAGE_KEY = "oshipin.lang";
const listeners = new Set<() => void>();

function isLang(value: unknown): value is Lang {
  return LANGUAGES.some((entry) => entry.code === value);
}

function readStored(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLang(stored) ? stored : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function writeLang(lang: Lang) {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
  listeners.forEach((listener) => listener());
}

/**
 * The selected UI language (default English, not the browser locale) and a translator.
 * The server renders English; a stored choice is applied after hydration.
 */
export function useI18n() {
  const lang = useSyncExternalStore(subscribe, readStored, () => DEFAULT_LANG);
  const t = useCallback((text: Localized) => text[lang], [lang]);
  return { lang, setLang: writeLang, t };
}

/** Header language picker. A <select> so more languages can be added without a layout change. */
export function LanguageSelect() {
  const { lang, setLang } = useI18n();
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <select
      className="langSelect"
      aria-label="Language"
      value={lang}
      onChange={(event) => {
        if (isLang(event.target.value)) setLang(event.target.value);
      }}
    >
      {LANGUAGES.map((entry) => (
        <option key={entry.code} value={entry.code}>{entry.label}</option>
      ))}
    </select>
  );
}
