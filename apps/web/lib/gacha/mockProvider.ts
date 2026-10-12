// MockGachaProvider: DEMO DATA only. No network. One machine and a pool of three self-made dummy cards
// (fixtures/demo/assets.json, owner walletC: "Collectibles AR Demo Card #1..#3", placeholder SVG art, no real card names or images).
// Responses use Collector Crypt's wire shapes so the same normalizer and UI run on Mock and on the real provider.
import type { TwinfoldAsset } from "../contract";
import assetsFixture from "../fixtures/demo/assets.json";
import type {
  BuildBuybackRequest,
  BuildBuybackResult,
  BuybackAvailable,
  CcOpenPackWon,
  GachaMachine,
  GachaPoolCard,
  GachaProvider,
  GeneratePackRequest,
  GeneratePackResult,
  OpenPackOutcome,
  OpenPackRequest,
  SubmitSignedRequest,
  SubmitSignedResult,
} from "./types";
import { GachaApiError } from "./types";

/**
 * Test-only submit failures for DEMO DATA (nothing is ever signed there, so `signedTransaction` is free to carry them;
 * the /pull page sends one when the URL has ?fail=submit or ?fail=expired). The real provider ignores these.
 */
export const MOCK_FAIL_SUBMIT = "DEMO-FAIL-SUBMIT";
export const MOCK_FAIL_EXPIRED = "DEMO-FAIL-EXPIRED";

const DEMO_MACHINE: GachaMachine = {
  code: "demo_25",
  name: "Collectibles AR Demo Machine (DEMO DATA)",
  price: 25,
  instantBuyback: 85,
  odds: { common: 0.75, uncommon: 0.2, rare: 0.04, epic: 0.01 },
  tierRanges: {
    common: { start: 13, end: 30 },
    uncommon: { start: 30, end: 55 },
    rare: { start: 55, end: 125 },
    epic: { start: 125, end: 500 },
  },
  stock: { common: 3, uncommon: 3, rare: 3, epic: 0 },
  ev: 24,
};

/** Cap on the memo -> call count map (oldest dropped first). */
const MAX_TRACKED_MEMOS = 100;

const pool: TwinfoldAsset[] = (assetsFixture as TwinfoldAsset[]).filter(
  (asset) => asset.category === "card" && asset.id.startsWith("tf-card-DEMO-")
);

const TRAITS: [string, (a: TwinfoldAsset) => string | number | undefined][] = [
  ["Type", () => "Card"],
  ["The Grade", (a) => a.grade],
  ["Grading Company", (a) => a.gradingCompany],
  ["Grading ID", (a) => a.gradingId],
  ["Insured Value", (a) => a.insuredValueUsd],
  ["Vault", (a) => a.vault],
  ["Vault ID", (a) => a.vaultId],
];

function toWon(asset: TwinfoldAsset): CcOpenPackWon {
  return {
    success: true,
    nft_address: asset.address,
    transactionSignature: asset.provenance[0]?.transaction,
    nftWon: {
      image: asset.imageUrl,
      content: {
        metadata: {
          name: asset.title,
          attributes: TRAITS.flatMap(([trait, read]) => {
            const value = read(asset);
            return value === undefined ? [] : [{ trait_type: trait, value }];
          }),
        },
      },
    },
    rarity: "demo",
    roll: 0,
  };
}

function pickIndex(memo: string): number {
  let hash = 0;
  for (const ch of memo) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % pool.length;
}

export class MockGachaProvider implements GachaProvider {
  readonly isDemoData = true;
  readonly network = "devnet" as const;
  /**
   * memo -> number of openPack calls, so the first call answers `waiting` (exercises the retry path).
   * Kept on globalThis because route handlers create a provider per request.
   */
  private calls: Map<string, number> = (globalThis as unknown as { __twinfoldMockGachaCalls?: Map<string, number> }).__twinfoldMockGachaCalls ??= new Map();

  async listMachines(): Promise<GachaMachine[]> {
    return [DEMO_MACHINE];
  }

  /** DEMO DATA has no pool images (no card image is kept in the repo); the UI shows its drawn placeholders instead. */
  async listPoolCards(): Promise<GachaPoolCard[]> {
    return [];
  }

  async generatePack(request: GeneratePackRequest): Promise<GeneratePackResult> {
    void request;
    // `transaction` is empty on purpose: there is nothing to sign in DEMO DATA mode.
    return { memo: `demo-memo-${crypto.randomUUID()}`, transaction: "" };
  }

  async submitSigned(request: SubmitSignedRequest): Promise<SubmitSignedResult> {
    if (request.signedTransaction === MOCK_FAIL_SUBMIT) throw new GachaApiError("Simulated submit failure (DEMO DATA)", 400, "demo test flag ?fail=submit");
    if (request.signedTransaction === MOCK_FAIL_EXPIRED) throw new GachaApiError("Transaction expired: block height exceeded (DEMO DATA)", 500, "demo test flag ?fail=expired");
    return { success: true, signature: "DEMO-TX-SUBMIT", confirmationStatus: "demo" };
  }

  async openPack(request: OpenPackRequest): Promise<OpenPackOutcome> {
    const count = (this.calls.get(request.memo) ?? 0) + 1;
    this.calls.delete(request.memo); // re-insert so the Map order is "least recently used first"
    this.calls.set(request.memo, count);
    // Keep the per-memo counters bounded: drop the oldest beyond MAX_TRACKED_MEMOS.
    while (this.calls.size > MAX_TRACKED_MEMOS) {
      const oldest = this.calls.keys().next().value;
      if (oldest === undefined) break;
      this.calls.delete(oldest);
    }
    if (count === 1) return { state: "waiting", memo: request.memo };
    // Same memo -> same card (idempotent, like the real API).
    return { state: "opened", won: toWon(pool[pickIndex(request.memo)]) };
  }

  async buybackAvailable(request: { nft: string }): Promise<BuybackAvailable> {
    void request;
    return { available: true, amount: 21_250_000, timeRemaining: 72 * 60 * 60 };
  }

  async buildBuyback(request: BuildBuybackRequest): Promise<BuildBuybackResult> {
    void request;
    return { serializedTransaction: "", refundAmount: 21_250_000, memo: "demo-buyback" };
  }
}
