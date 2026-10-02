import { NextResponse } from "next/server";
import { checkOperatorToken } from "../../../../lib/redemptions/operatorAuth";
import { getRedemptionsForOperator } from "../../../../lib/redemptions/operatorList";
import { reconcileRedemption } from "../../../../lib/redemptions/flow";
import { listOpen } from "../../../../lib/redemptions/store";
import { assertDevnetServerSigningAllowed } from "../../../../lib/solana/devnetSigningGuard";

export const dynamic = "force-dynamic";

/** GET /api/operator/redemptions -> open redemptions (all wallets). Same two gates as the operator actions. */
export async function GET(request: Request) {
  try {
    assertDevnetServerSigningAllowed();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "devnet server signing disabled" }, { status: 403 });
  }
  const token = checkOperatorToken(request);
  if (!token.ok) return NextResponse.json({ error: token.error }, { status: token.status });
  const open = listOpen();
  await Promise.all(open.map((r) => reconcileRedemption(r)));
  return NextResponse.json({ redemptions: getRedemptionsForOperator() });
}
