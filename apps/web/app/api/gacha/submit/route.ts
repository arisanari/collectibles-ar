import { NextResponse } from "next/server";
import { readSmallJson } from "../../../../lib/auth/http";
import { getGachaProvider } from "../../../../lib/gacha";
import { getOwnedPack, getPack, isTxExpiredFailure, markFailed, markSubmitted, recordError, recordSubmitSignature, type GachaPackError, type GachaPackRecord } from "../../../../lib/gacha/packStore";
import { BUYBACK_PER_HOUR, gachaErrorResponse, isBase64Transaction, MEMO, memoNotOwned, requireSession, SUBMIT_PER_HOUR } from "../../../../lib/gacha/routeUtils";
import { checkWalletIsSigner, firstSignature } from "../../../../lib/gacha/submitCheck";
import { GachaApiError } from "../../../../lib/gacha/types";
import { reconcileSubmit } from "../../../../lib/gacha/submitReconcile";
import { takeSlot } from "../../../../lib/rateLimit";
import { refuseMainnet } from "../../../../lib/network";

export const dynamic = "force-dynamic";

/** Same code the UI already tells apart (gachaErrorResponse): busy_pending / busy_opening / machine_off_balance / upstream_error. */
function upstreamCode(error: GachaApiError): string {
  const text = `${error.message} ${error.details ?? ""}`;
  return error.status === 429 ? "busy_pending" : error.status === 503 ? "busy_opening" : /off balance/i.test(text) ? "machine_off_balance" : "upstream_error";
}

/** Our own check refused the request: keep why on the pack record (when there is one) and answer with it. */
function refuse(record: GachaPackRecord | undefined, wallet: string | null, status: number, code: string, message: string): NextResponse {
  let lastError: GachaPackError | undefined;
  if (record) lastError = recordError(record, { stage: "submit", code, httpStatus: status, message });
  else console.error("[gacha submit]", { memo: null, wallet, httpStatus: status, code, message });
  return NextResponse.json({ error: code, message, ...(lastError ? { lastError } : {}) }, { status });
}

/**
 * POST /api/gacha/submit { signedTransaction (base64), memo?, kind?: "pack" | "buyback", demo? }
 * Forwards the player-signed transaction to Collector Crypt. The signed transaction is never logged.
 * Before relaying: the signed-in wallet must be a required signer of the transaction (400 otherwise), and for a Pull
 * (kind "pack", the default) `memo` is required and must belong to the signed-in wallet (403 otherwise).
 * A buyback transaction (kind "buyback") has no Pull memo; it only gets the signer check.
 * A refusal (ours or Collector Crypt's) is kept on the pack record as `lastError` and returned in the response.
 * A Pull whose upstream message says the blockhash expired answers `{ error: "tx_expired" }` (nothing was paid). Any other
 * failure (HTTP 500, network error) does not say whether it landed: the signature is kept on the record and the chain is asked
 * (lib/gacha/submitReconcile.ts). If it landed the answer is a success (`recovered: true`) and the record goes back to
 * `submitted`; otherwise the memo stays usable ("checking"), never "unpaid" on the strength of the failure alone.
 * A repeated submit for a memo whose earlier signature is already on chain is not relayed again (`alreadyOnChain: true`).
 */
export async function POST(request: Request) {
  const mainnet = await refuseMainnet(request);
  if (mainnet) return mainnet;
  const body = await readSmallJson(request, 4608);
  const demo = body?.demo === true;
  const session = await requireSession(request, demo);
  if (!session.ok) return session.response;

  const signedTransaction = body?.signedTransaction;
  const kind = body?.kind === "buyback" ? "buyback" : "pack";
  const memo = body?.memo;
  // Demo mode has nothing to sign, so an empty value is allowed there only.
  if (demo ? typeof signedTransaction !== "string" : !isBase64Transaction(signedTransaction)) {
    return NextResponse.json({ error: "invalid_input", message: "signedTransaction (base64) is required" }, { status: 400 });
  }
  if (memo !== undefined && (typeof memo !== "string" || !MEMO.test(memo))) {
    return NextResponse.json({ error: "invalid_input", message: "memo is invalid" }, { status: 400 });
  }

  let record;
  if (demo) {
    record = typeof memo === "string" ? getPack(memo) : undefined;
    if (record && !record.demo) return memoNotOwned();
  } else {
    const wallet = session.wallet as string;
    if (kind === "pack") {
      if (typeof memo !== "string") return NextResponse.json({ error: "invalid_input", message: "memo is required" }, { status: 400 });
      record = getOwnedPack(memo, wallet);
      if (!record || record.demo) {
        // Not stored: a foreign or unknown memo has no record of ours to write to. Logged only.
        console.error("[gacha submit]", { memo, wallet, httpStatus: 403, code: "memo_not_owned", message: "memo does not belong to the signed-in wallet" });
        return memoNotOwned();
      }
    }
    const signer = checkWalletIsSigner(signedTransaction as string, wallet);
    if (!signer.ok) {
      const undecodable = signer.reason === "undecodable";
      return refuse(
        record,
        wallet,
        400,
        undecodable ? "invalid_transaction" : "wallet_not_signer",
        undecodable ? "signedTransaction is not a valid transaction" : "The signed-in wallet is not a required signer of this transaction"
      );
    }
    if (!takeSlot(kind === "pack" ? "gacha_submit" : "gacha_buyback_submit", wallet, kind === "pack" ? SUBMIT_PER_HOUR : BUYBACK_PER_HOUR)) {
      return refuse(record, wallet, 429, "rate_limited", "Too many requests. Please try again later.");
    }
  }

  // Real Pull only: remember the signature before relaying (the chain can answer later whether it landed), and do not relay
  // again when an earlier signed transaction for this memo is already on chain.
  if (record && !demo && kind === "pack") {
    const signature = firstSignature(signedTransaction as string);
    if (record.state !== "opened" && (await reconcileSubmit(record)) === "landed") {
      return NextResponse.json({ success: true, alreadyOnChain: true, isDemoData: false });
    }
    if (signature) recordSubmitSignature(record, signature);
  }

  try {
    const provider = getGachaProvider({ demo });
    const result = await provider.submitSigned({ signedTransaction: signedTransaction as string });
    if (record) markSubmitted(record);
    return NextResponse.json({ ...result, isDemoData: provider.isDemoData });
  } catch (error) {
    // Unknown whether it landed: the memo stays usable for open (never a new generatePack).
    if (record) markFailed(record);
    const wallet = demo ? null : (session.wallet as string);
    const upstream = error instanceof GachaApiError;
    const httpStatus = upstream ? error.status : 500;
    const message = upstream ? [error.message, error.details].filter(Boolean).join(" | ") : error instanceof Error ? error.message : "unknown error";
    // A Pull whose blockhash ran out never landed: no payment, so the UI offers a fresh Pull instead of "check again".
    // Only the upstream wording counts; a bare 500 / network error is not proof (the chain is asked below).
    // (A buyback has no pack record and its client does not know this code, so only a Pull is classified.)
    const expired = upstream && kind === "pack" && isTxExpiredFailure({ httpStatus, message });
    const code = expired ? "tx_expired" : upstream ? upstreamCode(error) : "server_error";
    let lastError: GachaPackError | undefined;
    if (record) lastError = recordError(record, { stage: "submit", code, httpStatus, message });
    else console.error("[gacha submit]", { memo: typeof memo === "string" ? memo : null, wallet, httpStatus, code, message });
    if (!expired && record && !demo && kind === "pack" && (await reconcileSubmit(record)) === "landed") {
      // It landed although submitTransaction errored: carry on with the normal open flow.
      return NextResponse.json({ success: true, recovered: true, isDemoData: false });
    }
    if (expired) {
      return NextResponse.json(
        { error: "tx_expired", message: "The transaction expired before it was sent. No payment was made. Start a new pull.", ...(lastError ? { lastError } : {}) },
        { status: 502 }
      );
    }
    const response = gachaErrorResponse(error);
    if (!lastError) return response;
    return NextResponse.json({ ...((await response.json()) as object), lastError }, { status: response.status });
  }
}
