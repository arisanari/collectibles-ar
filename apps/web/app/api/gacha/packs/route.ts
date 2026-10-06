import { NextResponse } from "next/server";
import { FEED_PER_HOUR, buildPackFeed, DEMO_FEED_WALLET, parseSince, recordsForFeed, refreshPendingConfirmations } from "../../../../lib/gacha/packFeed";
import { signatureIsOnChain } from "../../../../lib/gacha/openResult";
import { rateLimited } from "../../../../lib/gacha/routeUtils";
import { refuseMainnet } from "../../../../lib/network";
import { takeSlot } from "../../../../lib/rateLimit";
import { authorize } from "../../../../lib/transferRequests/access";

export const dynamic = "force-dynamic";

/**
 * GET /api/gacha/packs[?since=<ISO 8601>][&demo=1]
 * The Pull feed the linked iPhone polls: the signed-in wallet's own Pull records, newest first by openedAt, at most 20.
 *   { wallet, packs: [{ memo, packType, state: generated|submitted|opened|failed, createdAt, openedAt|null, nftAddress|null, asset|null }] }
 * `asset` is the TwinfoldAsset /api/gacha/open returned for that memo (opened Pulls only; same memo, same card).
 * `since` keeps only records changed at or after it (a record's `updatedAt` moves with createdAt / openedAt).
 * Auth: Web session cookie OR device Bearer token (the iPhone link); a Bearer header is the only credential considered
 * when present. Read-only. Capped at 600 reads per wallet per hour. `demo=1` needs no session and returns DEMO DATA records.
 */
export async function GET(request: Request) {
  const mainnet = await refuseMainnet(request);
  if (mainnet) return mainnet;
  const params = new URL(request.url).searchParams;
  const since = parseSince(params.get("since"));
  if (since === "invalid") {
    return NextResponse.json({ error: "invalid_input", message: "since must be an ISO 8601 date-time" }, { status: 400 });
  }

  const demo = params.get("demo") === "1";
  let wallet: string | null = null;
  if (!demo) {
    const access = await authorize(request);
    if (!access.ok) return access.response;
    wallet = access.auth.wallet;
    if (!takeSlot("gacha_packs_feed", wallet, FEED_PER_HOUR)) return rateLimited();
  }

  const records = recordsForFeed(wallet);
  if (!demo) {
    // A card the Web stopped polling can still be pending; settle it here (bounded RPC checks, failures leave it pending).
    await refreshPendingConfirmations(records, signatureIsOnChain);
  }
  return NextResponse.json(buildPackFeed(records, { wallet: wallet ?? DEMO_FEED_WALLET, since }), {
    headers: { "Cache-Control": "no-store" },
  });
}
