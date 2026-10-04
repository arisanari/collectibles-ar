import { NextResponse } from "next/server";
import { boundedString, readSmallJson } from "../../../../../lib/auth/http";
import { recordAudit } from "../../../../../lib/link/audit";
import { authorize, ownedRequest } from "../../../../../lib/transferRequests/access";
import { BlockhashExpiredError, sendAndConfirmFinal } from "../../../../../lib/transferRequests/chain";
import { markConfirmed, markFailed, markSubmitted, toView } from "../../../../../lib/transferRequests/store";
import { verifyOwnerSignedTransaction } from "../../../../../lib/transferRequests/verify";
import { reconcileRedemption } from "../../../../../lib/redemptions/flow";
import { getRedemption } from "../../../../../lib/redemptions/store";

export const dynamic = "force-dynamic";

const MAX_SIGNED_TX_BASE64 = 4096;

/**
 * POST /api/transfer-requests/[id]/submit { signedTransaction }  (web session, same-origin)
 * `signedTransaction` is the prepared transaction after Phantom's signTransaction
 * (base64). Before anything is sent the server checks the signed message equals
 * the one it prepared and that the owner's ed25519 signature verifies; the fee
 * payer's signature on chain is always the server's own. Then it submits through
 * its own devnet RPC and waits for confirmation. Idempotent: a request that is
 * already submitted/confirmed returns its current state without re-sending.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, { webOnly: true, mutating: true });
  if (!access.ok) return access.response;
  const { id } = await context.params;
  const found = ownedRequest(id, access.auth.wallet);
  if (!found.ok) return found.response;
  const r = found.request;

  if (r.status === "submitted" || r.status === "confirmed" || r.submitting) return NextResponse.json(toView(r));
  if (r.status === "expired") return NextResponse.json({ error: "expired" }, { status: 410 });
  if (r.status !== "awaiting_approval" || !r.prepared) {
    return NextResponse.json({ error: r.status === "awaiting_approval" ? "not_prepared" : `request is ${r.status}`, status: r.status }, { status: 409 });
  }

  const body = await readSmallJson(request, MAX_SIGNED_TX_BASE64 + 64);
  const signedB64 = boundedString(body?.signedTransaction, MAX_SIGNED_TX_BASE64);
  if (!signedB64 || !/^[A-Za-z0-9+/]+=*$/.test(signedB64)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const verified = verifyOwnerSignedTransaction({
    preparedTransaction: Buffer.from(r.prepared.transactionB64, "base64"),
    signedTransaction: Buffer.from(signedB64, "base64"),
    owner: r.wallet,
  });
  if (!verified.ok) {
    recordAudit("transfer_refused", { wallet: r.wallet, detail: `submit rejected: ${verified.reason}` });
    return NextResponse.json({ error: `signature_check_failed: ${verified.reason}` }, { status: 400 });
  }

  // Re-check after the awaits above, then set the flag with no await in between, so two concurrent submits cannot both send.
  if (r.submitting || r.status !== "awaiting_approval") return NextResponse.json(toView(r));
  r.submitting = true;
  try {
    const result = await sendAndConfirmFinal(verified.transaction, r.prepared.lastValidBlockHeight, (signature) => markSubmitted(r, signature));
    if (result.error) markFailed(r, result.error, false);
    else markConfirmed(r);
  } catch (error) {
    if (r.signature) {
      // Already sent: a confirm timeout / RPC error says nothing about whether it lands. Stay `submitted`;
      // reconcileRequest (on later reads) settles it from getSignatureStatuses / the on-chain owner.
      console.error("transfer-requests/submit: confirmation uncertain, staying submitted", error instanceof Error ? error.message : "unknown error");
    } else if (error instanceof BlockhashExpiredError) {
      markFailed(r, "The approval expired (blockhash). Please approve again.", true);
    } else {
      console.error("transfer-requests/submit failed", error instanceof Error ? error.message : "unknown error");
      markFailed(r, "Sending to devnet failed (check the vault wallet's SOL balance or the RPC)", true);
    }
  } finally {
    r.submitting = false;
  }
  // A confirmed redeem lock moves its redemption to `locked` (the chain is checked again inside).
  const redemption = r.kind === "redeem_lock" && r.redemptionId ? getRedemption(r.redemptionId) : undefined;
  if (redemption) await reconcileRedemption(redemption, Date.now() + 10_000);
  return NextResponse.json(toView(r));
}
