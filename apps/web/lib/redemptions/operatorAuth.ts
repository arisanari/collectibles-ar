import { createHash, timingSafeEqual } from "node:crypto";

// Operator guard for the redeem dry run's operator steps. Two independent gates:
//  1. assertDevnetServerSigningAllowed() (the same dev-only gate as every vault/escrow signing path), checked by the route;
//  2. a shared secret in the `x-twinfold-operator-token` header, TWINFOLD_OPERATOR_TOKEN on the server,
//     compared in constant time. No token configured = operator actions refused. The token is never logged.

export const OPERATOR_HEADER = "x-twinfold-operator-token";

/** Constant-time comparison (both sides hashed to equal length first, so length leaks nothing). */
export function operatorTokenMatches(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export type OperatorCheck = { ok: true } | { ok: false; status: 403; error: string };

export function checkOperatorToken(request: Request): OperatorCheck {
  const expected = process.env.TWINFOLD_OPERATOR_TOKEN;
  if (!expected) return { ok: false, status: 403, error: "operator token is not configured on this server (TWINFOLD_OPERATOR_TOKEN)" };
  if (!operatorTokenMatches(request.headers.get(OPERATOR_HEADER), expected)) return { ok: false, status: 403, error: "invalid operator token" };
  return { ok: true };
}
