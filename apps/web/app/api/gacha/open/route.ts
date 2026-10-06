import { NextResponse } from "next/server";
import { readSmallJson } from "../../../../lib/auth/http";
import { getGachaProvider } from "../../../../lib/gacha";
import { openPackForUi } from "../../../../lib/gacha/openResult";
import { getPack, getOwnedPack, recordGenerated } from "../../../../lib/gacha/packStore";
import { gachaErrorResponse, isPlayerAddress, MEMO, memoNotOwned, OPEN_PER_HOUR, rateLimited, requireSession } from "../../../../lib/gacha/routeUtils";
import { takeSlot } from "../../../../lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/gacha/open { memo, playerAddress?, demo? }
 * One openPack attempt. `{ state: "waiting" }` means Collector Crypt has not settled the payment yet (WAITING_FOR_WEBHOOK):
 * the client calls again with the SAME memo about once a second. The same memo always yields the same card, so
 * retries and a resumed session never open a second pack. On success returns the card as a TwinfoldAsset.
 * The memo must belong to the signed-in wallet (the pack record made by /api/gacha/pack), otherwise 403.
 * The Pull event is `confirmed` only when its signature is found on chain; until then `pending`.
 */
export async function POST(request: Request) {
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
    if (!record || record.demo) return memoNotOwned();
    if (!takeSlot("gacha_open", `${session.wallet}\n${memo}`, OPEN_PER_HOUR)) return rateLimited();
  }

  try {
    const provider = getGachaProvider({ demo });
    return NextResponse.json(await openPackForUi(provider, record, owner));
  } catch (error) {
    return gachaErrorResponse(error);
  }
}
