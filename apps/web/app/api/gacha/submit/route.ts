import { NextResponse } from "next/server";
import { readSmallJson } from "../../../../lib/auth/http";
import { getGachaProvider } from "../../../../lib/gacha";
import { getOwnedPack, getPack, markFailed, markSubmitted } from "../../../../lib/gacha/packStore";
import { BUYBACK_PER_HOUR, gachaErrorResponse, isBase64Transaction, MEMO, memoNotOwned, rateLimited, requireSession, SUBMIT_PER_HOUR } from "../../../../lib/gacha/routeUtils";
import { checkWalletIsSigner } from "../../../../lib/gacha/submitCheck";
import { takeSlot } from "../../../../lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/gacha/submit { signedTransaction (base64), memo?, kind?: "pack" | "buyback", demo? }
 * Forwards the player-signed transaction to Collector Crypt. The signed transaction is never logged.
 * Before relaying: the signed-in wallet must be a required signer of the transaction (400 otherwise), and for a Pull
 * (kind "pack", the default) `memo` is required and must belong to the signed-in wallet (403 otherwise).
 * A buyback transaction (kind "buyback") has no Pull memo; it only gets the signer check.
 */
export async function POST(request: Request) {
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
      if (!record || record.demo) return memoNotOwned();
    }
    const signer = checkWalletIsSigner(signedTransaction as string, wallet);
    if (!signer.ok) {
      const message = signer.reason === "undecodable" ? "signedTransaction is not a valid transaction" : "The signed-in wallet is not a required signer of this transaction";
      return NextResponse.json({ error: signer.reason === "undecodable" ? "invalid_transaction" : "wallet_not_signer", message }, { status: 400 });
    }
    if (!takeSlot(kind === "pack" ? "gacha_submit" : "gacha_buyback_submit", wallet, kind === "pack" ? SUBMIT_PER_HOUR : BUYBACK_PER_HOUR)) return rateLimited();
  }

  try {
    const provider = getGachaProvider({ demo });
    const result = await provider.submitSigned({ signedTransaction: signedTransaction as string });
    if (record) markSubmitted(record);
    return NextResponse.json({ ...result, isDemoData: provider.isDemoData });
  } catch (error) {
    // Unknown whether it landed: the memo stays usable for open (never a new generatePack).
    if (record) markFailed(record);
    return gachaErrorResponse(error);
  }
}
