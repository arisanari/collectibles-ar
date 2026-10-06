// Display formatting only. The values come from Collector Crypt's /api/machines and are never recomputed:
// odds are published as fractions (0.75) and shown as a percent ("75%"), EV with two decimals, stock as given.

/** 0.75 -> "75%", 0.04 -> "4%", 0.005 -> "0.5%". Unit change only; trailing zeros and float noise (0.2*100) are trimmed. */
export function formatOdds(value: number): string {
  return `${Number((value * 100).toFixed(2))}%`;
}

/** 24.698898... -> "24.70". */
export function formatEv(value: number): string {
  return value.toFixed(2);
}

/** Stock is shown as the integer the API gives. */
export function formatStock(value: number): string {
  return String(Math.trunc(value));
}
