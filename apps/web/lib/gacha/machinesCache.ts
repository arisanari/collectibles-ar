// Server-only 30 second cache for GET /api/gacha/machines, so page views do not each hit Collector Crypt.
// The payload keeps the time it was REALLY fetched (`fetchedAt`), which the UI shows next to the numbers: a cached
// value is never presented as fresher than it is. Failures are not cached.
import type { GachaMachine } from "./types";

export const MACHINES_TTL_MS = 30_000;

export type MachinesPayload = { machines: GachaMachine[]; fetchedAt: string };

const g = globalThis as unknown as { __slabarMachinesCache?: Map<string, { at: number; payload: MachinesPayload }> };
const cache: Map<string, { at: number; payload: MachinesPayload }> = (g.__slabarMachinesCache ??= new Map());
// Concurrent requests for the same key share ONE upstream call (a page load fires the request more than once).
const inflight = new Map<string, Promise<MachinesPayload>>();

export async function cachedMachines(key: string, fetcher: () => Promise<GachaMachine[]>, now = Date.now()): Promise<MachinesPayload> {
  const hit = cache.get(key);
  if (hit && now - hit.at < MACHINES_TTL_MS) return hit.payload;
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = (async () => {
    const machines = await fetcher();
    const payload: MachinesPayload = { machines, fetchedAt: new Date(now).toISOString() };
    cache.set(key, { at: now, payload });
    return payload;
  })().finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

/** Test hook. */
export function clearMachinesCacheForTests() {
  cache.clear();
  inflight.clear();
}
