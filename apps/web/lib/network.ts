// Server-only guard: the app never writes on mainnet (AGENTS.md section 3, docs/mvp.md section 9). Mainnet is a
// read-only display of a wallet's real Collector Crypt cards (GET /api/solana/assets?network=mainnet). Every write
// route calls refuseMainnet() first and answers 400 when the request names mainnet, in the query or the JSON body.
import { NextResponse } from "next/server";

export type AppNetwork = "devnet" | "mainnet";

const MAX_BODY_PEEK = 8192;

function isMainnet(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "mainnet";
}

/** The `network` query value of a read route: "devnet" (default), "mainnet", or null when it is anything else. */
export function parseNetworkParam(raw: string | null): AppNetwork | null {
  if (raw === null || raw === "") return "devnet";
  if (raw === "devnet" || raw === "mainnet") return raw;
  return null;
}

/**
 * 400 `mainnet_not_supported` when the request asks for mainnet (`?network=mainnet` or body `{ "network": "mainnet" }`),
 * otherwise null. The body is read from a clone, so the route can still read it afterwards.
 */
export async function refuseMainnet(request: Request): Promise<NextResponse | null> {
  let named = isMainnet(new URL(request.url).searchParams.get("network"));
  if (!named && request.method !== "GET" && request.method !== "HEAD") {
    try {
      const text = await request.clone().text();
      if (text.length > 0 && text.length <= MAX_BODY_PEEK) {
        const body = JSON.parse(text) as unknown;
        named = Boolean(body) && typeof body === "object" && isMainnet((body as Record<string, unknown>).network);
      }
    } catch {
      // Not JSON / unreadable: the route's own validation answers it.
    }
  }
  return named
    ? NextResponse.json({ error: "mainnet_not_supported", message: "Mainnet is read-only in this app. Pull, buyback and transfer are devnet only." }, { status: 400 })
    : null;
}
