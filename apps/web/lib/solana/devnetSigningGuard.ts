// Server-only guard for /api/devnet/transfer. This route is a DEV-ONLY
// SHORTCUT that lets the Twinfold backend hold and use devnet test wallet
// secret keys to sign a real transfer, standing in for real wallet signing
// (Issue #19/#45, not yet built). It must never run in a production build,
// against a non-devnet RPC, or without an explicit opt-in env flag — this
// function is the single place that enforces all three, so every caller
// gets the same guarantee.

export function assertDevnetServerSigningAllowed(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing: devnet server signing (/api/devnet/transfer) is disabled when NODE_ENV=production."
    );
  }

  // apps/web only ever talks to Helius's devnet RPC endpoint
  // (lib/solana/heliusClient.ts's HELIUS_DEVNET_RPC), but SOLANA_NETWORK is
  // also checked here in case that ever becomes configurable, so this guard
  // doesn't silently pass if it does.
  const network = process.env.SOLANA_NETWORK ?? "devnet";
  if (!/devnet/i.test(network)) {
    throw new Error(
      `Refusing: SOLANA_NETWORK "${network}" does not look like devnet. ` +
        "devnet server signing only ever targets Solana devnet."
    );
  }

  if (process.env.TWINFOLD_DEVNET_SERVER_SIGNING !== "1") {
    throw new Error(
      "Refusing: devnet server signing is disabled. Set TWINFOLD_DEVNET_SERVER_SIGNING=1 in " +
        "apps/web/.env.local to opt in (dev-only; see apps/web/.env.example)."
    );
  }
}
