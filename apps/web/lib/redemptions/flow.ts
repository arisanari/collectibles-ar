// Server-only orchestration of the redeem dry run on top of the store (state machine), the chain
// (escrow-signed operations) and the owner-approval pipeline (transfer requests, kind `redeem_lock`).

import { randomUUID } from "node:crypto";
import type { Redemption, TwinfoldAsset } from "../contract";
import { assertDevnetServerSigningAllowed } from "../solana/devnetSigningGuard";
import { getAsset, getSignaturesForAddress, getTransaction, type HeliusAsset } from "../solana/heliusClient";
import { heliusAssetToTwinfoldAsset } from "../solana/normalize";
import { reconcileRequest } from "../transferRequests/reconcile";
import { createRequest, getRequest, markRejected } from "../transferRequests/store";
import { fetchSignatureState } from "../transferRequests/chain";
import { isBurnTransaction } from "../solana/burnDetect";
import { ESCROW_LABEL, ESCROW_NOT_CONFIGURED_MESSAGE, escrowAddress, escrowBurn, fetchOwnerViaRpc } from "./chain";
import { decideLockedCancel, decideOwnerBack } from "./decide";
import { buildPassport } from "./passport";
import { getPassport, getSnapshot, savePassport, saveSnapshot } from "./passportStore";
import {
  isOpenStatus,
  markCancelled,
  markException,
  markLocked,
  markRetired,
  runtimeOf,
  setLockRequestId,
} from "./store";

const RECEIVED_STUCK_MS = 90 * 1000;
const RECONCILE_MIN_INTERVAL_MS = 4000;

/**
 * Makes sure an owner-approval request that moves the Asset into escrow exists for a `requested` redemption.
 * A request that expired / was rejected / failed for good (or vanished with a server restart) is replaced by a
 * new one. Returns the request id, or null when the escrow wallet is not configured.
 */
export function ensureLockRequest(r: Redemption, assetTitle: string, origin: "web" | "device"): string | null {
  if (r.status !== "requested") return r.lockRequestId ?? null;
  const escrow = escrowAddress();
  if (!escrow) return null;
  const current = r.lockRequestId ? getRequest(r.lockRequestId) : undefined;
  const alive = current && (current.status === "awaiting_approval" || current.status === "submitted" || current.status === "confirmed" || (current.status === "failed" && current.retryable));
  if (alive) return current.id;
  const created = createRequest({
    id: `lock-${randomUUID()}`,
    wallet: r.wallet,
    assetId: r.assetId,
    assetAddress: r.assetAddress,
    assetTitle,
    kind: "redeem_lock",
    toWallet: escrow,
    toLabel: ESCROW_LABEL,
    origin,
    redemptionId: r.id,
  });
  if (!created.ok) return null;
  setLockRequestId(r, created.request.id);
  return created.request.id;
}

/** Withdraws a still-open lock approval (cancel of a `requested` redemption). Refuses if the owner already submitted it. */
export function withdrawLockRequest(r: Redemption): { ok: true } | { ok: false; reason: "submitted" } {
  const lock = r.lockRequestId ? getRequest(r.lockRequestId) : undefined;
  if (!lock) return { ok: true };
  if (lock.status === "submitted" || lock.status === "confirmed" || lock.submitting) return { ok: false, reason: "submitted" };
  if (lock.status === "awaiting_approval" || lock.status === "failed") markRejected(lock);
  return { ok: true };
}

async function readChain(r: Redemption): Promise<{ helius: HeliusAsset }> {
  return { helius: await getAsset(r.assetAddress) };
}

async function loadSnapshot(r: Redemption, helius: HeliusAsset): Promise<TwinfoldAsset> {
  const signatures = await getSignaturesForAddress(r.assetAddress);
  return heliusAssetToTwinfoldAsset(helius, signatures);
}

export function passportMissing(r: Redemption): boolean {
  return r.status === "retired" && !getPassport(r.assetId);
}

function tryWritePassport(r: Redemption): void {
  if (getPassport(r.assetId)) return;
  const rt = runtimeOf(r.id);
  if (rt.passportFailed) return; // surfaced to the operator (passportMissing); no silent retry loop
  const snapshot = getSnapshot(r.assetId);
  if (!snapshot) {
    rt.passportFailed = true;
    console.error(`redemption ${r.id.slice(0, 6)}: no pre-burn snapshot, Passport not written (operator attention needed)`);
    return;
  }
  try {
    savePassport(buildPassport(snapshot, r));
  } catch (error) {
    rt.passportFailed = true;
    console.error(`redemption ${r.id.slice(0, 6)}: Passport build failed`, error instanceof Error ? error.message : "unknown error");
  }
}

/** The burn is confirmed (by us or found on chain): retire the redemption and write the Passport. */
export function finalizeRetired(r: Redemption, signature: string): void {
  if (r.status === "received") markRetired(r, signature);
  if (r.status === "retired") tryWritePassport(r);
}

/**
 * Burn the Asset from escrow. ANY failure leaves a safe stop: status `exception`, the Asset stays in escrow,
 * nothing else changes; only the operator (`retry_retire`) can resume. A burn that was sent but whose
 * confirmation is uncertain keeps `received` and is settled by `reconcileRedemption` from the chain.
 */
export async function runRetire(r: Redemption): Promise<void> {
  const rt = runtimeOf(r.id);
  if (rt.busy) return;
  rt.busy = true;
  rt.burnSignature = undefined;
  try {
    if (r.status !== "received") return;
    if (!escrowAddress()) return void markException(r, ESCROW_NOT_CONFIGURED_MESSAGE);
    try {
      assertDevnetServerSigningAllowed();
    } catch (error) {
      return void markException(r, error instanceof Error ? error.message : "devnet server signing disabled");
    }
    let helius: HeliusAsset;
    let snapshot: TwinfoldAsset;
    try {
      helius = (await readChain(r)).helius;
      if (helius.burnt) return void (await finalizeFromChain(r));
      snapshot = await loadSnapshot(r, helius);
    } catch {
      return void markException(r, "Could not read the Asset's state from devnet (RPC). The operator should retry.");
    }
    if (helius.ownership.owner !== escrowAddress()) return void markException(r, "The Asset is not in the escrow wallet. Retirement (burn) was not performed.");
    saveSnapshot(r.assetId, snapshot);
    try {
      const result = await escrowBurn({ assetAddress: r.assetAddress, onSubmitted: (signature) => (rt.burnSignature = signature) });
      if (result.error || !result.signature) return void markException(r, result.error ?? "burn failed");
      finalizeRetired(r, result.signature);
    } catch (error) {
      if (rt.burnSignature) {
        // Sent but confirmation uncertain: stay `received`; reconcileRedemption settles it from the chain (burnt) or stops safely.
        console.error("redemption retire: confirmation uncertain, staying received", error instanceof Error ? error.message : "unknown error");
        return;
      }
      console.error("redemption retire failed", error instanceof Error ? error.message : "unknown error");
      markException(r, "Sending the retirement (burn) failed (check the vault wallet's SOL balance, the escrow, or the RPC). The Asset remains in escrow.");
    }
  } finally {
    rt.busy = false;
  }
}

/** The chain says the Asset is burnt but we have no signature (restart / lost response): use the newest transaction on it. */
export async function finalizeFromChain(r: Redemption): Promise<void> {
  // Never record "the newest signature" blindly: it must really be a Core BurnV1.
  const signatures = (await getSignaturesForAddress(r.assetAddress)).filter((s) => !s.err).slice(0, 5);
  for (const s of signatures) {
    if (isBurnTransaction(await getTransaction(s.signature))) return void finalizeRetired(r, s.signature);
  }
  markException(r, "The Asset is burned, but the transaction containing the burn instruction could not be identified. Operator review is needed.");
}

/**
 * Best-effort, throttled: keeps the redemption consistent with the chain. A status is never proof of
 * ownership; chain facts win. RPC errors leave everything unchanged.
 */
export async function reconcileRedemption(r: Redemption, now = Date.now()): Promise<void> {
  const rt = runtimeOf(r.id);
  if (rt.reconciling || rt.busy || (rt.reconciledAt && now - rt.reconciledAt < RECONCILE_MIN_INTERVAL_MS)) return;
  if (!isOpenStatus(r.status) && r.status !== "retired") return;
  rt.reconciling = true;
  rt.reconciledAt = now;
  try {
    if (r.status === "requested") {
      const lock = r.lockRequestId ? getRequest(r.lockRequestId) : undefined;
      if (lock) await reconcileRequest(lock);
      if (lock?.status === "confirmed") return void markLocked(r, lock.signature);
      const escrow = escrowAddress();
      if (!escrow) return;
      const { helius } = await readChain(r);
      if (!helius.burnt && helius.ownership.owner === escrow) markLocked(r, lock?.signature);
    } else if (r.status === "locked") {
      // NEVER infer `cancelled` from a DAS read (it can be stale). Only a return transaction we sent and know the
      // signature of, confirmed on chain, may cancel; otherwise it stays `locked`.
      if (rt.returnSignature) {
        const s = await fetchSignatureState(rt.returnSignature);
        if (decideLockedCancel(rt.returnSignature, s.state) === "cancel") markCancelled(r, rt.returnSignature);
      }
    } else if (r.status === "shipped") {
      await exceptionIfOwnerBack(r);
    } else if (r.status === "received") {
      if (await exceptionIfOwnerBack(r)) return;
      const { helius } = await readChain(r);
      if (helius.burnt) await finalizeFromChain(r);
      else if (now - Date.parse(r.updatedAt) > RECEIVED_STUCK_MS) markException(r, "Retirement (burn) did not complete. The Asset remains in escrow. The operator should retry.");
    } else if (r.status === "retired") {
      tryWritePassport(r);
    }
  } catch {
    // leave as is; the next read tries again
  } finally {
    rt.reconciling = false;
  }
}

/** shipped / received but the RPC shows the Asset back with the requester: it left escrow outside this flow. */
async function exceptionIfOwnerBack(r: Redemption): Promise<boolean> {
  const owner = await fetchOwnerViaRpc(r.assetAddress);
  if (decideOwnerBack(owner, r.wallet) === "exception") {
    markException(r, "After shipping, the Asset moved from escrow back to the requester's wallet (a transfer outside the procedure). Operator review is needed.");
    return true;
  }
  return false;
}
