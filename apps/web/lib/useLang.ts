"use client";

import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};

/** Server snapshot is the page language (ja); React swaps to navigator.language
 * after hydration without a mismatch. */
export function useLang(): string {
  return useSyncExternalStore(subscribeNoop, () => navigator.language, () => "ja");
}
