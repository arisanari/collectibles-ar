import { NextResponse } from "next/server";
import { authenticateCookie } from "../../../../lib/auth/requestAuth";
import { hasSameOrigin } from "../../../../lib/auth/http";
import { formatCode, issueLinkCode } from "../../../../lib/link/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/link/code -> { code, display, expiresAt }
 * Requires the Web session cookie (same-origin only; a device token cannot mint
 * further codes). The code is single-use, valid 2 minutes, bound to the session's
 * wallet; issuing a new one invalidates the previous live code for that wallet.
 */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
  const outcome = await authenticateCookie();
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  const issued = issueLinkCode(outcome.auth.wallet);
  if (!issued.ok) return NextResponse.json({ error: "too many pending link codes, retry later" }, { status: 429 });
  const response = NextResponse.json({
    code: issued.code,
    display: formatCode(issued.code),
    expiresAt: new Date(issued.expiresAt).toISOString(),
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
