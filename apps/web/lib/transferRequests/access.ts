import { NextResponse } from "next/server";
import { hasSameOrigin } from "../auth/http";
import { authenticateCookie, authenticateRequest, type RequestAuth } from "../auth/requestAuth";
import { getRequest, type TransferRequest } from "./store";

type Access = { ok: true; auth: RequestAuth } | { ok: false; response: NextResponse };

const fail = (error: string, status: number): Access => ({ ok: false, response: NextResponse.json({ error }, { status }) });

/**
 * `webOnly`: the Web session cookie is the only accepted credential (approval
 * actions). Otherwise a device Bearer token is also accepted (iPhone).
 * `mutating`: cookie-authenticated requests must be same-origin (Bearer calls are not browser-ambient, so exempt).
 */
export async function authorize(request: Request, opts: { webOnly?: boolean; mutating?: boolean } = {}): Promise<Access> {
  const outcome = opts.webOnly ? await authenticateCookie() : await authenticateRequest(request);
  if (!outcome.ok) return fail(outcome.error, outcome.status);
  if (opts.mutating && outcome.auth.via === "cookie" && !hasSameOrigin(request)) return fail("forbidden origin", 403);
  return { ok: true, auth: outcome.auth };
}

/** Looks up a request that must belong to `wallet`. Another wallet's request is reported as not found. */
export function ownedRequest(id: string, wallet: string): { ok: true; request: TransferRequest } | { ok: false; response: NextResponse } {
  const found = getRequest(id);
  if (!found || found.wallet !== wallet) {
    return { ok: false, response: NextResponse.json({ error: "transfer request not found" }, { status: 404 }) };
  }
  return { ok: true, request: found };
}
