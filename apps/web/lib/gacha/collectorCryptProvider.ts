// CollectorCryptGachaProvider: server-only HTTP client for Collector Crypt's Gacha API (devnet).
// Only app/api/gacha/* route handlers import this (via lib/gacha/index.ts). Never import it from a client
// component: the UI goes through those routes (AGENTS.md section 3).
//
// Env (server-side only, never NEXT_PUBLIC_):
//   COLLECTOR_CRYPT_GACHA_BASE_URL  default https://dev-gacha.collectorcrypt.com (devnet). Only the devnet host over
//                                   https is accepted. localhost / 127.0.0.1 (a local stub) is accepted only when
//                                   NODE_ENV is not "production". Anything else is refused: no mainnet from this app.
//   COLLECTOR_CRYPT_API_KEY         optional. When set it is sent as `x-api-key` (it only tags the memo with our slug).
//                                   Play endpoints work without it. The key is never logged or echoed.
import type {
  BuildBuybackRequest,
  BuildBuybackResult,
  BuybackAvailable,
  CcOpenPackWon,
  GachaMachine,
  GachaProvider,
  GeneratePackRequest,
  GeneratePackResult,
  OpenPackOutcome,
  OpenPackRequest,
  SubmitSignedRequest,
  SubmitSignedResult,
} from "./types";
import { GachaApiError } from "./types";
import { httpsOnly } from "./normalize";

export const DEFAULT_GACHA_BASE_URL = "https://dev-gacha.collectorcrypt.com";
const DEVNET_HOST = "dev-gacha.collectorcrypt.com";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const REQUEST_TIMEOUT_MS = 15_000;

/** Normalizes the configured base URL and refuses anything that is not devnet over https (or a local stub outside production). */
export function resolveGachaBaseUrl(raw: string | undefined, nodeEnv: string | undefined = process.env.NODE_ENV): string {
  const candidate = (raw ?? "").trim() || DEFAULT_GACHA_BASE_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("COLLECTOR_CRYPT_GACHA_BASE_URL is not a valid URL");
  }
  if (LOCAL_HOSTS.has(url.hostname)) {
    if (nodeEnv === "production") throw new Error("Refusing a localhost COLLECTOR_CRYPT_GACHA_BASE_URL in production.");
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("COLLECTOR_CRYPT_GACHA_BASE_URL must be http(s)");
    return url.origin;
  }
  if (url.hostname !== DEVNET_HOST) {
    throw new Error(`Refusing COLLECTOR_CRYPT_GACHA_BASE_URL host "${url.hostname}": only the devnet gacha host is allowed (no mainnet).`);
  }
  if (url.protocol !== "https:") throw new Error("COLLECTOR_CRYPT_GACHA_BASE_URL must use https");
  return url.origin;
}

type JsonBody = Record<string, unknown>;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** A string, or a short JSON rendering of an object / array (Collector Crypt's `details` is not always a string). */
function asText(value: unknown): string | undefined {
  if (typeof value === "string") return value !== "" ? value : undefined;
  if (value !== null && typeof value === "object") {
    try {
      return JSON.stringify(value).slice(0, 500);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export class CollectorCryptGachaProvider implements GachaProvider {
  readonly isDemoData = false;
  readonly network = "devnet" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(options: { baseUrl?: string; apiKey?: string } = {}) {
    this.baseUrl = resolveGachaBaseUrl(options.baseUrl ?? process.env.COLLECTOR_CRYPT_GACHA_BASE_URL);
    this.apiKey = (options.apiKey ?? process.env.COLLECTOR_CRYPT_API_KEY)?.trim() || undefined;
  }

  private async call(path: string, init?: { method: "POST"; body: unknown }): Promise<{ status: number; body: JsonBody }> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init) headers["Content-Type"] = "application/json";
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: init?.method ?? "GET",
        headers,
        body: init ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
        // A redirect could carry the x-api-key header to another host. This API does not redirect, so any redirect is an error.
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Network failure or timeout. The message never includes headers, so the key cannot leak.
      throw new GachaApiError("Collector Crypt could not be reached", 502);
    }
    const body = (await response.json().catch(() => ({}))) as JsonBody;
    return { status: response.status, body };
  }

  private fail(status: number, body: JsonBody, fallback: string): never {
    const error = asText(body.error);
    const text = asText(body.message);
    const message = error ?? text ?? fallback;
    // Keep all three of error / message / details: the first one wins as the headline, the rest goes to details.
    const details = [asText(body.details), error && text && text !== error ? text : undefined].filter(Boolean).join(" | ") || undefined;
    throw new GachaApiError(message, status, details);
  }

  private absoluteUrl(value: string | undefined): string | undefined {
    return value?.startsWith("/") && !value.startsWith("//") ? `${this.baseUrl}${value}` : value;
  }

  async listMachines(): Promise<GachaMachine[]> {
    const { status, body } = await this.call("/api/machines");
    if (status < 200 || status >= 300 || !Array.isArray(body.machines)) this.fail(status || 502, body, "Could not load machines");
    return (body.machines as (GachaMachine & { public?: boolean })[])
      .filter((machine) => machine.public !== false)
      .map((machine) => ({
        code: machine.code,
        name: machine.name,
        price: machine.price,
        instantBuyback: machine.instantBuyback,
        odds: machine.odds,
        tierRanges: machine.tierRanges,
        stock: machine.stock,
        ev: machine.ev,
        // Image URLs are loaded in the browser: https only (same rule as the card images).
        image: httpsOnly(this.absoluteUrl(machine.image)),
        // The API returns a path such as "/pokemon_25.png" (relative to the gacha host) for most machines.
        thumbnailUrl: httpsOnly(this.absoluteUrl(machine.thumbnailUrl)),
      }));
  }

  async generatePack(request: GeneratePackRequest): Promise<GeneratePackResult> {
    const { status, body } = await this.call("/api/generatePack", { method: "POST", body: request });
    const memo = asString(body.memo);
    const transaction = asString(body.transaction);
    if (status < 200 || status >= 300 || !memo || !transaction) this.fail(status || 502, body, "Could not create the pack");
    return { memo, transaction };
  }

  async submitSigned(request: SubmitSignedRequest): Promise<SubmitSignedResult> {
    const { status, body } = await this.call("/api/submitTransaction", { method: "POST", body: request });
    if (status < 200 || status >= 300 || body.success !== true) this.fail(status || 502, body, "Could not submit the transaction");
    return {
      success: true,
      signature: asString(body.signature),
      confirmationStatus: asString(body.confirmationStatus),
    };
  }

  async openPack(request: OpenPackRequest): Promise<OpenPackOutcome> {
    const { status, body } = await this.call("/api/openPack", { method: "POST", body: request });
    // WAITING_FOR_WEBHOOK is normal until the payment settles: same memo, try again (idempotent on their side).
    if (body.code === "WAITING_FOR_WEBHOOK") return { state: "waiting", memo: asString(body.memo) ?? request.memo };
    if (status >= 200 && status < 300 && body.success === true && asString(body.nft_address)) {
      return { state: "opened", won: body as unknown as CcOpenPackWon };
    }
    this.fail(status || 502, body, "Could not open the pack");
  }

  /**
   * GET /api/pack/status?memo= : what Collector Crypt itself recorded for a Pull (payment, card transfer, refund). Returns
   * the raw body; lib/gacha/resume.ts `remoteFromCc` reads it. Not part of GachaProvider (the Mock has no upstream to ask).
   */
  async packStatus(memo: string): Promise<unknown> {
    const { status, body } = await this.call(`/api/pack/status?memo=${encodeURIComponent(memo)}`);
    if (status < 200 || status >= 300) this.fail(status || 502, body, "Could not read the pack status");
    return body;
  }

  async buybackAvailable(request: { nft: string }): Promise<BuybackAvailable> {
    const { status, body } = await this.call(`/api/buyback/available?nft=${encodeURIComponent(request.nft)}`);
    if (status < 200 || status >= 300) this.fail(status || 502, body, "Could not check buyback");
    return {
      available: body.available === true,
      amount: typeof body.amount === "number" ? body.amount : undefined,
      timeRemaining: typeof body.timeRemaining === "number" ? body.timeRemaining : undefined,
    };
  }

  async buildBuyback(request: BuildBuybackRequest): Promise<BuildBuybackResult> {
    const { status, body } = await this.call("/api/buyback", { method: "POST", body: request });
    const serializedTransaction = asString(body.serializedTransaction);
    if (status < 200 || status >= 300 || !serializedTransaction) this.fail(status || 502, body, "Could not build the buyback");
    return {
      serializedTransaction,
      refundAmount: typeof body.refundAmount === "number" ? body.refundAmount : undefined,
      memo: asString(body.memo),
    };
  }
}

/** True for a provider that can ask Collector Crypt for a Pull's status (the real one; the DEMO DATA Mock cannot). */
export function hasPackStatus(provider: GachaProvider): provider is GachaProvider & { packStatus(memo: string): Promise<unknown> } {
  return typeof (provider as { packStatus?: unknown }).packStatus === "function";
}
