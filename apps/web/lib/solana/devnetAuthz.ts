// Server-only authorization helpers for /api/devnet/transfer (Issue #45).
// The dev-only server-signing shortcut can only sign for the devnet test
// wallets (owner-a / owner-b), so an authenticated wallet is accepted only
// if it IS one of those wallets and equals the requested `from`.

import { loadDevnetKeypair, type DevnetWalletLabel } from "./devnetKeys";

export const PHANTOM_SIGNING_REQUIRED_MESSAGE = "このwalletの署名にはPhantomでの署名が必要です（未対応）。WebのMy collectionで承認してください";
export const SERVER_SIGNING_DISABLED_MESSAGE =
  "サーバー署名の転送は無効です。所有者本人がWebのMy collectionでPhantom署名して承認してください";

/**
 * Local-testing-only escape hatch: TWINFOLD_DEVNET_ALLOW_UNAUTHENTICATED_TRANSFER=1.
 * Insecure by design; always off in production regardless of the env value.
 */
export function unauthenticatedTransferEscapeEnabled(): boolean {
  if (process.env.TWINFOLD_DEVNET_ALLOW_UNAUTHENTICATED_TRANSFER !== "1") return false;
  if (process.env.NODE_ENV === "production") return false;
  return true;
}

/** Public address of a test wallet, or null if its keypair file is missing. Never exposes the secret key. */
export function devnetWalletAddressOrNull(label: DevnetWalletLabel): string | null {
  try {
    return loadDevnetKeypair(label).publicKey.toBase58();
  } catch {
    return null;
  }
}

/** "owner-a" / "owner-b" if `wallet` is that test wallet's address, else null. */
export function testWalletLabelFor(wallet: string): "owner-a" | "owner-b" | null {
  for (const label of ["owner-a", "owner-b"] as const) {
    if (devnetWalletAddressOrNull(label) === wallet) return label;
  }
  return null;
}
