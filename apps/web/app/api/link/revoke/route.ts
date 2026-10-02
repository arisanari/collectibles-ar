import { NextResponse } from "next/server";
import { hasSameOrigin } from "../../../../lib/auth/http";
import { authenticateCookie } from "../../../../lib/auth/requestAuth";
import { revokeDevicesForWallet } from "../../../../lib/link/store";

export const dynamic = "force-dynamic";

/** POST /api/link/revoke -> { revoked: n }. Web session required; revokes every device token issued for this wallet. */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
  const outcome = await authenticateCookie();
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ revoked: revokeDevicesForWallet(outcome.auth.wallet, "web revoke") });
}
