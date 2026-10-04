import { NextResponse } from "next/server";
import { readSmallJson } from "../../../../../lib/auth/http";
import { checkOperatorToken } from "../../../../../lib/redemptions/operatorAuth";
import { reconcileRedemption, runRetire } from "../../../../../lib/redemptions/flow";
import {
  findPersonalDataKey,
  getRedemption,
  markException,
  markReceived,
  markResumed,
  markShipped,
  recordRefusal,
  runtimeOf,
  sanitizeNote,
} from "../../../../../lib/redemptions/store";
import { assertDevnetServerSigningAllowed } from "../../../../../lib/solana/devnetSigningGuard";

export const dynamic = "force-dynamic";

/**
 * POST /api/redemptions/[id]/operator { action: "ship" | "exception" | "retry_retire" | "resume", note? }
 * OPERATOR (dry run) steps, guarded by BOTH assertDevnetServerSigningAllowed() and the operator secret header
 * (TWINFOLD_OPERATOR_TOKEN, constant-time compare). `ship`: ONLY from `locked`, recording the dry-run shipping
 * step ("Insured-shipping equivalent (dry run, nothing actually shipped)"; no tracking, no personal data). `exception`: safe stop.
 * `retry_retire`: exception (from received) -> retire again. `resume`: exception (from locked/shipped) -> that status.
 * `busy` is taken synchronously after the last await before the state change, so it cannot interleave with an owner cancel.
 * The operator `note` is kept in the operator view / audit only; it never reaches the public Passport or asset API.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertDevnetServerSigningAllowed();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "devnet server signing disabled" }, { status: 403 });
  }
  const token = checkOperatorToken(request);
  if (!token.ok) {
    recordRefusal(undefined, "operator action refused: bad or missing operator token");
    return NextResponse.json({ error: token.error }, { status: token.status });
  }
  const { id } = await context.params;
  const r = getRedemption(id);
  if (!r) return NextResponse.json({ error: "redemption not found" }, { status: 404 });

  const body = await readSmallJson(request);
  if (findPersonalDataKey(body)) return NextResponse.json({ error: "personal_data_not_accepted" }, { status: 400 });
  const action = body?.action;
  const note = sanitizeNote(body?.note);
  if (!note.ok) return NextResponse.json({ error: "invalid_input: note must be short (<=120 chars) and contain no contact data" }, { status: 400 });
  if (action !== "ship" && action !== "exception" && action !== "retry_retire" && action !== "resume") {
    return NextResponse.json({ error: "invalid_input: action must be ship | exception | retry_retire | resume" }, { status: 400 });
  }
  const rt = runtimeOf(r.id);
  if (rt.busy) return NextResponse.json({ error: "Processing" }, { status: 409 });

  await reconcileRedemption(r, Date.now() + 10_000);

  // ---- no await from here to the end of the state change ----
  if (rt.busy) return NextResponse.json({ error: "Processing" }, { status: 409 });
  rt.busy = true;
  let retire = false;
  let ok = false;
  try {
    if (action === "ship") ok = markShipped(r).ok;
    else if (action === "exception") ok = markException(r, note.note ? `operator stop: ${note.note}` : "The operator stopped this on exception").ok;
    else if (action === "resume") ok = markResumed(r).ok;
    else if (r.status === "exception" && r.exceptionFrom === "received") ok = retire = markReceived(r).ok;
  } finally {
    rt.busy = false;
  }
  if (!ok) return NextResponse.json({ error: `This action cannot be run in the current state (${r.status})`, status: r.status }, { status: 409 });
  if (retire) await runRetire(r);
  return NextResponse.json(r);
}
