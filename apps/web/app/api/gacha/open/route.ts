import { NextResponse } from "next/server";
import { readSmallJson } from "../../../../lib/auth/http";
import { getGachaProvider } from "../../../../lib/gacha/index";
import { openPackForUi } from "../../../../lib/gacha/openResult";
import { getPack, getOwnedPack, recordError, recordGenerated, type GachaPackError, type GachaPackRecord } from "../../../../lib/gacha/packStore";
import { gachaErrorResponse, isPlayerAddress, MEMO, memoNotOwned, OPEN_PER_HOUR, requireSession } from "../../../../lib/gacha/routeUtils";
import { GachaApiError } from "../../../../lib/gacha/types";
import { takeSlot } from "../../../../lib/rateLimit";
import { refuseMainnet } from "../../../../lib/network";

export const dynamic = "force-dynamic";

/**
 * POST /api/gacha/open { memo, playerAddress?, demo? }
 * One openPack attempt. `{ state: "waiting" }` means Collector Crypt has not settled the payment yet (WAITING_FOR_WEBHOOK):
 * the client calls again with the SAME memo about once a second. The same memo always yields the same card, so
 * retries and a resumed session never open a second pack. On success returns the card as a TwinfoldAsset.
 * The memo must belong to the signed-in wallet (the pack record made by /api/gacha/pack), otherwise 403.
 * The Pull event is `confirmed` only when its signature is found on chain; until then `pending`.
 * A refusal is kept on the pack record as `lastError` and returned in the response.
 * `{ error: "unpaid", code: "unpaid" }` (409): the record is `failed` and no payment is going to arrive, so the client stops
 * polling instead of waiting for a payment that never lands. Two cases: the submit failed because the transaction expired
 * (nothing was ever sent: answered at once, Collector Crypt is not asked), or the record is `failed` for another reason and
 * Collector Crypt still answers WAITING_FOR_WEBHOOK. A failed record that Collector Crypt DOES open (paid, then an upstream
 * error) still opens: only the WAITING answer is turned into `unpaid`.
 */
/** The pack never reached Collector Crypt as a payment: stop polling. Not a failure of the request itself, so 409. */
function unpaid(record: GachaPackRecord): NextResponse {
  return NextResponse.json(
    {
      error: "unpaid",
      code: "unpaid",
      message: "No payment was found for this memo. Check again, or start a new pull.",
      ...(record.lastError ? { lastError: record.lastError } : {}),
    },
    { status: 409 }
  );
}

export async function POST(request: Request) {
  const mainnet = await refuseMainnet(request);
  if (mainnet) return mainnet;
  const body = await readSmallJson(request);
  const demo = body?.demo === true;
  const session = await requireSession(request, demo);
  if (!session.ok) return session.response;

  const memo = body?.memo;
  const playerAddress = body?.playerAddress;
  if (typeof memo !== "string" || !MEMO.test(memo) || (playerAddress !== undefined && !isPlayerAddress(playerAddress, demo))) {
    return NextResponse.json({ error: "invalid_input", message: "memo is required" }, { status: 400 });
  }
  const owner = session.wallet ?? (typeof playerAddress === "string" ? playerAddress : null);

  let record;
  if (demo) {
    // DEMO DATA has no session. A demo call may never touch a record that belongs to a real wallet.
    record = getPack(memo);
    if (record && !record.demo) return memoNotOwned();
    record ??= recordGenerated({ memo, wallet: owner ?? "DEMO-PLAYER-WALLET", packType: "demo", demo: true });
  } else {
    record = getOwnedPack(memo, session.wallet as string);
    if (!record || record.demo) {
      console.error("[gacha open]", { memo, wallet: session.wallet, httpStatus: 403, code: "memo_not_owned", message: "memo does not belong to the signed-in wallet" });
      return memoNotOwned();
    }
    // The submit failed on an expired transaction: it never landed, so there is nothing to wait for (Collector Crypt is not asked).
    if (record.state === "failed" && record.lastError?.code === "tx_expired") return unpaid(record);
    if (!takeSlot("gacha_open", `${session.wallet}\n${memo}`, OPEN_PER_HOUR)) {
      const lastError = recordError(record, { stage: "open", code: "rate_limited", httpStatus: 429, message: "Too many requests. Please try again later." });
      return NextResponse.json({ error: "rate_limited", message: lastError.message, lastError }, { status: 429 });
    }
  }

  try {
    const provider = getGachaProvider({ demo });
    const payload = await openPackForUi(provider, record, owner);
    // A failed record that Collector Crypt still reports as waiting: no payment is coming. (A paid one would have opened.)
    if (payload.state === "waiting" && record.state === "failed") return unpaid(record);
    return NextResponse.json(payload);
  } catch (error) {
    // Why it failed stays on the pack record (and in the response) so the screen can show it. markFailed already ran in openPackForUi.
    const upstream = error instanceof GachaApiError;
    const httpStatus = upstream ? error.status : 500;
    const message = upstream ? [error.message, error.details].filter(Boolean).join(" | ") : error instanceof Error ? error.message : "unknown error";
    const code = !upstream
      ? "server_error"
      : httpStatus === 429
        ? "busy_pending"
        : httpStatus === 503
          ? "busy_opening"
          : /off balance/i.test(message)
            ? "machine_off_balance"
            : "upstream_error";
    const lastError: GachaPackError = recordError(record, { stage: "open", code, httpStatus, message });
    const response = gachaErrorResponse(error);
    return NextResponse.json({ ...((await response.json()) as object), lastError }, { status: response.status });
  }
}
