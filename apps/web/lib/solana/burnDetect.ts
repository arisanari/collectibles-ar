// Pure. Recognizes a Metaplex Core BurnV1 instruction inside a getTransaction result, so a transaction is
// never recorded as the retire (burn) of a redemption just because it is the newest one on the Asset.

import bs58 from "bs58";

const MPL_CORE_PROGRAM_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const BURN_DISCRIMINATOR = 12; // BurnV1

type Ix = { programIdIndex: number; data: string };
type Tx = {
  transaction: { message: { accountKeys: string[]; instructions: Ix[] } };
  meta: { err?: unknown; innerInstructions?: { instructions: Ix[] }[] } | null;
} | null;

export function isBurnTransaction(tx: Tx): boolean {
  if (!tx || tx.meta?.err) return false;
  const keys = tx.transaction.message.accountKeys;
  const all = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions?.flatMap((i) => i.instructions) ?? [])];
  return all.some((ix) => {
    if (keys[ix.programIdIndex] !== MPL_CORE_PROGRAM_ID) return false;
    try {
      return bs58.decode(ix.data)[0] === BURN_DISCRIMINATOR;
    } catch {
      return false;
    }
  });
}
