// Server-only, in-memory idempotency store for /api/devnet/transfer,
// keyed by requestId (AGENTS.md section 3: transfer must be idempotent by
// transaction signature or request ID). A repeated POST with the same
// requestId returns the stored result instead of re-sending. Process-local
// and cleared on server restart — acceptable for this dev-only shortcut
// (see devnetSigningGuard.ts); a real backend would persist this.

export type DevnetTransferRecord = {
  assetId: string;
  status: "pending" | "confirmed" | "failed";
  signature?: string;
  error?: string;
  /** Authenticated wallet that started the transfer (Issue #45). Unset only for the unauthenticated dev escape hatch. */
  wallet?: string;
};

const store = new Map<string, DevnetTransferRecord>();

export function getTransferRecord(requestId: string): DevnetTransferRecord | undefined {
  return store.get(requestId);
}

export function setTransferRecord(requestId: string, record: DevnetTransferRecord): void {
  store.set(requestId, record);
}
