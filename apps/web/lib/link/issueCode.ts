/** Client-side helper: asks POST /api/link/code (session cookie) for a one-time iPhone link code. */
export async function issueLinkCode(): Promise<
  { ok: true; code: string; display: string; expiresAt: number } | { ok: false; status: number }
> {
  const res = await fetch("/api/link/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json()) as { code: string; display: string; expiresAt: string };
  return { ok: true, code: data.code, display: data.display, expiresAt: Date.parse(data.expiresAt) };
}
