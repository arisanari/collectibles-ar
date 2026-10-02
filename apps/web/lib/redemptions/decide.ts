// Pure decision rules for chain-driven redemption state changes (unit-testable, no I/O).
// Principle: a stale or ambiguous read must never move a redemption to a state that strands the Asset.

/**
 * A locked redemption becomes `cancelled` ONLY when a return transaction we sent (known signature) is
 * confirmed on chain. A DAS owner read (which can lag) is never an input here.
 */
export function decideLockedCancel(returnSignature: string | undefined, signatureState: "confirmed" | "failed" | "unknown" | undefined): "cancel" | "stay" {
  return returnSignature && signatureState === "confirmed" ? "cancel" : "stay";
}

/** shipped / received with the Asset (RPC read) back at the requester: it left escrow outside this flow. */
export function decideOwnerBack(rpcOwner: string | null, requester: string): "exception" | "stay" {
  return rpcOwner !== null && rpcOwner === requester ? "exception" : "stay";
}

/** A plain `send` must not target Twinfold's own wallets (vault / escrow): buyback and redeem are the paths for those. */
export function isTwinfoldOperatedWallet(to: string, vault: string | null, escrow: string | null): boolean {
  return (!!vault && to === vault) || (!!escrow && to === escrow);
}
