// Memos of Pulls the player walked away from ("Start a new pull") before they were confirmed. They may have been paid,
// so each memo stays listed (localStorage, this browser only) until the player removes it. Public values only: memo,
// pack type, public wallet address, time. Pure helpers so they can be unit tested; the hook does the storage I/O.

export const ORPHAN_MEMOS_KEY = "slabar.pull.orphanMemos";
export const MAX_ORPHANS = 20;

export type OrphanMemo = { memo: string; packType: string; wallet: string; droppedAt: string };

/** Adds an orphan (newest first), de-duplicated by memo and capped. */
export function addOrphan(list: readonly OrphanMemo[], orphan: OrphanMemo): OrphanMemo[] {
  return [orphan, ...list.filter((entry) => entry.memo !== orphan.memo)].slice(0, MAX_ORPHANS);
}

export function removeOrphan(list: readonly OrphanMemo[], memo: string): OrphanMemo[] {
  return list.filter((entry) => entry.memo !== memo);
}

/** Parses the stored JSON defensively; anything malformed is dropped. */
export function parseOrphans(raw: string | null): OrphanMemo[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is OrphanMemo =>
          !!entry && typeof entry.memo === "string" && typeof entry.packType === "string" && typeof entry.wallet === "string" && typeof entry.droppedAt === "string"
      )
      .slice(0, MAX_ORPHANS);
  } catch {
    return [];
  }
}
