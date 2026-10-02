// Pure sliding-window cap per key (no imports, unit-testable). Used to stop one
// wallet from burning Twinfold's vault wallet SOL (fee payer) through repeated
// transfer-request creation, prepare, or acquisition calls.
//
// MVP LIMITATION: process-local (globalThis), like the other stores.

export const HOUR_MS = 60 * 60 * 1000;

const g = globalThis as unknown as { __twinfoldRateBuckets?: Map<string, number[]> };
const buckets: Map<string, number[]> = (g.__twinfoldRateBuckets ??= new Map());

/** Records one use of `bucket`/`key` if fewer than `limit` happened in the last `windowMs`. Returns false (and records nothing) when over the cap. */
export function takeSlot(bucket: string, key: string, limit: number, windowMs = HOUR_MS, now = Date.now()): boolean {
  const id = `${bucket}\n${key}`;
  const recent = (buckets.get(id) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    buckets.set(id, recent);
    return false;
  }
  recent.push(now);
  buckets.set(id, recent);
  if (buckets.size > 5000) {
    buckets.forEach((times, k) => {
      if (times.every((t) => now - t >= windowMs)) buckets.delete(k);
    });
  }
  return true;
}
