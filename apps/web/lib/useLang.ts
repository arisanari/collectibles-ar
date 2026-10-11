"use client";

import { useI18n } from "./i18n";

/** The selected UI language code ("en"). Kept for callers that only need the code (e.g. displayTitle). */
export function useLang(): string {
  return useI18n().lang;
}
