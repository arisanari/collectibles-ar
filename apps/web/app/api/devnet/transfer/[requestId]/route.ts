import { NextResponse } from "next/server";
import { authenticateRequest } from "../../../../../lib/auth/requestAuth";
import { recordAudit } from "../../../../../lib/link/audit";
import { unauthenticatedTransferEscapeEnabled } from "../../../../../lib/solana/devnetAuthz";
import { getTransferRecord } from "../../../../../lib/solana/devnetTransferStore";
import type { DevnetTransferResult } from "../../../../../lib/contract";

export const dynamic = "force-dynamic";

/**
 * GET /api/devnet/transfer/[requestId]
 *
 * Polls the status of a transfer started by POST /api/devnet/transfer.
 * Process-local, in-memory (devnetTransferStore.ts) — dev-only shortcut,
 * same as the POST route. Same auth requirement as the POST (Issue #45):
 * web session cookie or device Bearer token, and the transfer must belong
 * to the authenticated wallet. (Cookie GET is not origin-checked: it is a
 * safe read.) The unauthenticated escape hatch applies here too.
 */
export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  const outcome = await authenticateRequest(request);
  if (!outcome.ok && (outcome.status === 500 || !unauthenticatedTransferEscapeEnabled())) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  const { requestId } = await context.params;
  const record = getTransferRecord(requestId);
  if (!record) {
    return NextResponse.json({ error: `no transfer found for requestId "${requestId}"` }, { status: 404 });
  }
  if (outcome.ok && record.wallet && record.wallet !== outcome.auth.wallet) {
    recordAudit("transfer_refused", { wallet: outcome.auth.wallet, detail: "status of another wallet's transfer" });
    return NextResponse.json({ error: "this transfer belongs to another wallet" }, { status: 403 });
  }
  const result: DevnetTransferResult = {
    requestId,
    assetId: record.assetId,
    status: record.status,
    signature: record.signature,
    error: record.error,
  };
  return NextResponse.json(result);
}
