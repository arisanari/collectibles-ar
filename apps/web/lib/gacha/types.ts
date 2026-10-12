// Types for the GachaProvider boundary (AGENTS.md section 3: UI never calls Collector Crypt directly).
// Shapes mirror Collector Crypt's Gacha API (https://docs.collectorcrypt.com/gacha/api, checked 2026-10-06).
// Machine numbers (odds, ev, stock, instantBuyback) are passed through untouched: Collectibles AR does not compute them.

export type GachaNetwork = "devnet"; // fixed: the app never transacts on mainnet

export type GachaOdds = { common: number; uncommon: number; rare: number; epic: number };
export type GachaTierRange = { start: number; end: number };

/** One machine as returned by GET /api/machines (only the fields the UI reads; extra fields are ignored). */
export type GachaMachine = {
  code: string; // also the `packType` for generatePack, e.g. "pokemon_25"
  name: string;
  price: number; // USDC, as published
  instantBuyback: number; // percent as published (85 = 85)
  odds: GachaOdds;
  tierRanges?: Record<keyof GachaOdds, GachaTierRange>;
  stock?: GachaOdds;
  ev?: number;
  image?: string;
  thumbnailUrl?: string; // made absolute by the provider
};

/** One card in a machine's pool, as GET /api/getNfts lists it (only the fields the UI reads). The image is Collector Crypt's URL, loaded at run time. */
export type GachaPoolCard = { nftAddress: string; name: string; rarity: keyof GachaOdds; image: string };
export type ListPoolCardsRequest = { code: string; rarity: keyof GachaOdds; limit: number };

export type GeneratePackRequest = { playerAddress: string; packType: string };
export type GeneratePackResult = {
  memo: string; // idempotency key for the whole Pull
  transaction: string; // base64, partially signed; sends USDC to the gacha wallet once the player signs
};

export type SubmitSignedRequest = { signedTransaction: string }; // base64
export type SubmitSignedResult = { success: boolean; signature?: string; confirmationStatus?: string };

export type OpenPackRequest = { memo: string };

export type CcAttribute = { trait_type: string; value: string | number | boolean };

/** openPack success body (fields we read). */
export type CcOpenPackWon = {
  success: true;
  nft_address: string;
  transactionSignature?: string;
  nftWon?: {
    image?: string;
    content?: {
      metadata?: { name?: string; description?: string; attributes?: CcAttribute[] };
      links?: { image?: string };
      files?: { uri?: string; cdn_uri?: string; cc_cdn?: string }[];
    };
  };
  rarity?: string;
  roll?: number | string;
  memo?: string;
};

/**
 * `waiting` = Collector Crypt answered WAITING_FOR_WEBHOOK (the payment is not settled yet): retry the SAME memo
 * about every second. It is not a failure and never means "open a new pack".
 */
export type OpenPackOutcome = { state: "waiting"; memo: string } | { state: "opened"; won: CcOpenPackWon };

export type BuybackAvailable = { available: boolean; amount?: number; timeRemaining?: number }; // amount: USDC with 6 decimals; timeRemaining: seconds
export type BuildBuybackRequest = { playerAddress: string; nftAddress: string };
export type BuildBuybackResult = { serializedTransaction: string; refundAmount?: number; memo?: string };

export interface GachaProvider {
  readonly isDemoData: boolean;
  readonly network: GachaNetwork;
  listMachines(): Promise<GachaMachine[]>;
  listPoolCards(request: ListPoolCardsRequest): Promise<GachaPoolCard[]>;
  generatePack(request: GeneratePackRequest): Promise<GeneratePackResult>;
  submitSigned(request: SubmitSignedRequest): Promise<SubmitSignedResult>;
  openPack(request: OpenPackRequest): Promise<OpenPackOutcome>;
  buybackAvailable(request: { nft: string }): Promise<BuybackAvailable>;
  buildBuyback(request: BuildBuybackRequest): Promise<BuildBuybackResult>;
}

/** Thrown by providers for an upstream refusal. `status` is the upstream HTTP status (429 = too many pending, 503 = too many opening). */
export class GachaApiError extends Error {
  readonly status: number;
  readonly details?: string;
  constructor(message: string, status: number, details?: string) {
    super(message);
    this.name = "GachaApiError";
    this.status = status;
    this.details = details;
  }
}
