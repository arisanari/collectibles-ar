import { NextResponse } from "next/server";
import { getTransferRecord } from "../../../../../lib/solana/devnetTransferStore";
import type { DevnetTransferResult } from "../../../../../lib/contract";

export const dynamic = "force-dynamic";

/**
 * GET /api/devnet/transfer/[requestId]
 *
 * Polls the status of a transfer started by POST /api/devnet/transfer.
 * Process-local, in-memory (devnetTransferStore.ts) — dev-only shortcut,
 * same as the POST route.
 */
export async function GET(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await context.params;
  const record = getTransferRecord(requestId);
  if (!record) {
    return NextResponse.json({ error: `no transfer found for requestId "${requestId}"` }, { status: 404 });
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
