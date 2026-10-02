import { NextResponse } from "next/server";
import { getPassport } from "../../../../lib/redemptions/passportStore";

export const dynamic = "force-dynamic";

/**
 * GET /api/passports/[assetId] -> RedeemedProvenancePassport (public).
 * A Passport is a public provenance record: it holds no wallet beyond what is already on chain and no
 * personal data. It states provenance up to Vault exit and does NOT guarantee the current owner,
 * the current condition, or authenticity (see `limitations`).
 */
export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(assetId)) return NextResponse.json({ error: "invalid assetId" }, { status: 400 });
  const passport = getPassport(assetId);
  if (!passport) return NextResponse.json({ error: "no passport for this asset" }, { status: 404 });
  return NextResponse.json(passport);
}
