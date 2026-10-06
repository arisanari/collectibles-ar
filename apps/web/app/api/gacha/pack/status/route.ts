import { NextResponse } from "next/server";
import { getGachaProvider } from "../../../../../lib/gacha/index";
import { hasPackStatus } from "../../../../../lib/gacha/collectorCryptProvider";
import { getPackStatusLocal } from "../../../../../lib/gacha/packStore";
import { type RemotePackStatus, remoteFromCc } from "../../../../../lib/gacha/resume";
import { MEMO, memoNotOwned, rateLimited, requireSessionRead } from "../../../../../lib/gacha/routeUtils";
import { refuseMainnet } from "../../../../../lib/network";
import { takeSlot } from "../../../../../lib/rateLimit";

export const dynamic = "force-dynamic";

const STATUS_PER_HOUR = 300;

/**
 * GET /api/gacha/pack/status?memo=<memo>[&demo=1]
 *   -> { memo, local: { state, lastError, createdAt }, remote: { paid, opened, refunded } | null, isDemoData }
 * What the Web asks before it resumes a saved memo (lib/gacha/resume.ts decides). `local` is this app's own pack record;
 * `remote` is Collector Crypt's /api/pack/status read as paid / opened / refunded, or null when Collector Crypt did not
 * answer (and always null in DEMO DATA, which has no upstream). `local.createdAt` is when the pack was issued (ISO 8601).
 * The web session cookie is required (non-demo). A memo that is not the signed-in wallet's own (or unknown) is 403.
 * In DEMO DATA an unknown memo is 404. Read-only; capped at 300 reads per wallet per hour. Nothing secret is returned.
 */
export async function GET(request: Request) {
  const mainnet = await refuseMainnet(request);
  if (mainnet) return mainnet;
  const params = new URL(request.url).searchParams;
  const demo = params.get("demo") === "1";
  const session = await requireSessionRead(request, demo);
  if (!session.ok) return session.response;

  const memo = params.get("memo");
  if (memo === null || !MEMO.test(memo)) {
    return NextResponse.json({ error: "invalid_input", message: "memo is required" }, { status: 400 });
  }
  const found = getPackStatusLocal(memo, session.wallet);
  if (found.kind === "forbidden") return memoNotOwned();
  if (found.kind === "unknown") return NextResponse.json({ error: "unknown_memo", message: "No DEMO DATA record for this memo" }, { status: 404 });
  if (!demo && !takeSlot("gacha_pack_status", session.wallet as string, STATUS_PER_HOUR)) return rateLimited();

  const provider = getGachaProvider({ demo });
  let remote: RemotePackStatus | null = null;
  if (hasPackStatus(provider)) {
    try {
      remote = remoteFromCc(await provider.packStatus(memo));
    } catch {
      // Collector Crypt did not answer: remote stays null and the client decides from the local record alone.
      remote = null;
    }
  }
  return NextResponse.json({ memo, local: found.local, remote, isDemoData: provider.isDemoData }, { headers: { "Cache-Control": "no-store" } });
}
