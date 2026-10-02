import { NextResponse } from "next/server";
import { assertDevnetServerSigningAllowed } from "../../../../lib/solana/devnetSigningGuard";
import { unauthenticatedTransferEscapeEnabled } from "../../../../lib/solana/devnetAuthz";

export const dynamic = "force-dynamic";

/**
 * GET /api/devnet/capabilities -> { serverSignedTestTransfers }
 * True only when the insecure local-testing flag
 * TWINFOLD_DEVNET_ALLOW_UNAUTHENTICATED_TRANSFER=1 is on AND the dev-only
 * server-signing guard passes. Clients use it to enable 送る / 売る in the
 * Owner A / Owner B test rooms; every real owner's transfer goes through the
 * Phantom-approved /api/transfer-requests flow instead. Reveals no secret.
 */
export async function GET() {
  let guardOk = true;
  try {
    assertDevnetServerSigningAllowed();
  } catch {
    guardOk = false;
  }
  return NextResponse.json({ serverSignedTestTransfers: guardOk && unauthenticatedTransferEscapeEnabled() });
}
