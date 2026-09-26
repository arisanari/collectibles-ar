// Maps Twinfold's internal stable asset id (e.g. "tf-ukiyoe-001") to its
// Solana devnet Asset address, so the real Reference Asset's address can be
// swapped in after RWA registration + mint (scripts/solana) without a code
// change. Server-only (imported by app/api/solana/* route handlers).
//
// Format (apps/web/.env.local): SOLANA_ASSET_ADDRESSES as a JSON object,
// e.g. {"tf-ukiyoe-001":"2KqvewsvVvLrvPASLgDXwaaRCXrueH6pnqeSE1XmUipZ"}

export function loadAssetRegistry(): Record<string, string> {
  const raw = process.env.SOLANA_ASSET_ADDRESSES;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    console.error("SOLANA_ASSET_ADDRESSES is not valid JSON; ignoring it.");
    return {};
  }
}

export function resolveAssetAddress(assetId: string): string {
  const registry = loadAssetRegistry();
  const address = registry[assetId];
  if (!address) {
    throw new Error(
      `No devnet Asset address configured for "${assetId}". Set SOLANA_ASSET_ADDRESSES in apps/web/.env.local.`
    );
  }
  return address;
}

export function listConfiguredAssetIds(): string[] {
  return Object.keys(loadAssetRegistry());
}
