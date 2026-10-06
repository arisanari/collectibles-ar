// Server-only: runs openPack once and turns the answer into the UI payload. Used by app/api/gacha/open.
import { getAsset, getSignatureStatuses, type HeliusSignatureStatus } from "../solana/heliusClient";
import type { TwinfoldAsset } from "../contract";
import { openPackToAsset, pickImageUrl } from "./normalize";
import { markFailed, markOpened, recordAsset, type GachaPackRecord } from "./packStore";
import { GachaApiError, type GachaProvider } from "./types";

export type OpenResultPayload =
  | { state: "waiting"; memo: string; isDemoData: boolean }
  | {
      state: "opened";
      memo: string;
      isDemoData: boolean;
      asset: TwinfoldAsset;
      rarity?: string;
      roll?: number | string;
      transactionSignature?: string;
    };

/** A signature counts as on chain only when the cluster knows it, it did not fail, and it reached confirmed or finalized. */
export function isStatusConfirmed(status: HeliusSignatureStatus | undefined): boolean {
  return Boolean(status) && status!.err === null && (status!.confirmationStatus === "confirmed" || status!.confirmationStatus === "finalized");
}

/** Asks the devnet RPC (existing Helius client, server side). Any RPC failure counts as "not confirmed yet". */
export async function signatureIsOnChain(signature: string): Promise<boolean> {
  try {
    return isStatusConfirmed((await getSignatureStatuses([signature]))[0]);
  } catch (error) {
    console.warn("gacha open: getSignatureStatuses failed, leaving the Pull pending", error instanceof Error ? error.message : "unknown error");
    return false;
  }
}

/**
 * One openPack attempt for a Pull whose pack record the caller already checked belongs to the signed-in wallet.
 * The first success is recorded (mint, signature, time); later calls with the same memo reuse the recorded time, so
 * the card and its event time do not change between calls. Only the Status can move pending -> confirmed.
 */
export async function openPackForUi(provider: GachaProvider, record: GachaPackRecord, playerAddress: string | null): Promise<OpenResultPayload> {
  const memo = record.memo;
  let outcome;
  try {
    outcome = await provider.openPack({ memo });
  } catch (error) {
    // 429 / 503 are "busy, try again"; anything else is a refusal for this memo.
    if (!(error instanceof GachaApiError && (error.status === 429 || error.status === 503))) markFailed(record);
    throw error;
  }
  if (outcome.state === "waiting") return { state: "waiting", memo, isDemoData: provider.isDemoData };

  const { won } = outcome;
  markOpened(record, { nftAddress: won.nft_address, txSignature: won.transactionSignature });
  // What an earlier call already found through DAS is kept on the record, so DAS is asked once per memo.
  let fallbackImageUrl: string | undefined = record.imageUrl;
  let assetInterface: string | undefined = record.assetInterface;
  // openPack's nftWon often has no image. Read it through Helius DAS (the existing server-side client), runtime only.
  // Owner is NOT taken from DAS here: right after the transfer DAS can still report the gacha wallet.
  if (!provider.isDemoData && !pickImageUrl(won.nftWon) && !(fallbackImageUrl && assetInterface)) {
    try {
      const das = await getAsset(won.nft_address);
      fallbackImageUrl = pickImageUrl(das) ?? fallbackImageUrl;
      assetInterface = das.interface ?? assetInterface;
    } catch (error) {
      console.warn("gacha open: DAS getAsset failed, showing the card without an image", error instanceof Error ? error.message : "unknown error");
    }
  }

  // DEMO DATA has no chain to ask (its signature is made up and the screen says DEMO DATA).
  // Once the Pull has been seen on chain it stays confirmed (no new RPC call, and a later RPC hiccup cannot turn it back to pending).
  const alreadyConfirmed = record.asset?.provenance.some((e) => e.status === "confirmed" && e.metadata?.memo === memo) === true;
  const chainConfirmed =
    Boolean(won.transactionSignature) && (provider.isDemoData || alreadyConfirmed || (await signatureIsOnChain(won.transactionSignature as string)));
  const asset = openPackToAsset({ won, memo, owner: playerAddress, fallbackImageUrl, assetInterface, chainConfirmed, now: new Date(record.openedAt ?? Date.now()) });
  recordAsset(record, { asset, imageUrl: fallbackImageUrl, assetInterface });
  return {
    state: "opened",
    memo,
    isDemoData: provider.isDemoData,
    asset,
    rarity: won.rarity,
    roll: won.roll,
    transactionSignature: won.transactionSignature,
  };
}
