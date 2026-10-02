import { NextResponse } from "next/server";
import { getRedemption } from "./store";
import type { Redemption } from "../contract";

/** A redemption that must belong to `wallet`. Another wallet's redemption is reported as not found. */
export function ownedRedemption(id: string, wallet: string): { ok: true; redemption: Redemption } | { ok: false; response: NextResponse } {
  const found = getRedemption(id);
  if (!found || found.wallet !== wallet) return { ok: false, response: NextResponse.json({ error: "redemption not found" }, { status: 404 }) };
  return { ok: true, redemption: found };
}
