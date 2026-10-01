export const PREAUTH_COOKIE = "twinfold_preauth";
export const MAX_BODY_BYTES = 2048;
export const MAX_WALLET_LEN = 44;
export const MAX_SIGNATURE_LEN = 88;

/** POST requests must carry a same-origin `Origin` header. Missing, "null" or malformed -> false. */
export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Reads a small JSON object body; returns null when too large, malformed, or not an object. */
export async function readSmallJson(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return null;
  const text = await request.text().catch(() => "");
  if (text.length === 0 || text.length > MAX_BODY_BYTES) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function boundedString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}
