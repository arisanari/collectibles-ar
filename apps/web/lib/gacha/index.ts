// Server-side GachaProvider selection. Only route handlers import this.
//   demo=true  -> MockGachaProvider (DEMO DATA, never touches the network)
//   otherwise  -> env GACHA_PROVIDER=mock selects Mock, anything else CollectorCryptGachaProvider (devnet)
import { CollectorCryptGachaProvider } from "./collectorCryptProvider";
import { MockGachaProvider } from "./mockProvider";
import type { GachaProvider } from "./types";

// Providers are cheap and stateless (the mock keeps its per-memo counters on globalThis), so a fresh one per
// request means env changes and hot reloads are always picked up.
export function getGachaProvider(options: { demo?: boolean } = {}): GachaProvider {
  if (options.demo || process.env.GACHA_PROVIDER === "mock") return new MockGachaProvider();
  return new CollectorCryptGachaProvider();
}
