// What the opening needs from a Pull result. Shared by the Pull page and the page that replays the opening in another browser.

type Text = { en: string };

/** Strength of the opening effect per rarity (presentation only; the rarity itself is Collector Crypt's value, shown as received). */
export const EFFECT_TIER: Record<string, 0 | 1 | 2 | 3> = { common: 0, uncommon: 1, rare: 2, epic: 3 };

export function effectTier(rarity: string | undefined): 0 | 1 | 2 | 3 {
  return EFFECT_TIER[rarity?.toLowerCase() ?? ""] ?? 1;
}

/**
 * Fallback for a result saved before the back photo was carried along: Collector Crypt serves a slab's two photos at .../front/<id> and
 * .../back/<id>, so the back is asked for at the matching address on the same host. Any other address gives no back photo.
 */
export function backPhotoUrl(front: string | undefined): string | undefined {
  if (!front) return undefined;
  const m = /^(https:\/\/[a-z0-9.-]*collectorcrypt\.com\/)front(\/[A-Za-z0-9_-]+)$/.exec(front);
  return m ? `${m[1]}back${m[2]}` : undefined;
}

/** Year, grade and rarity for the opening, as received: the year is the four digits the card's title starts with; a missing value is left out. */
export function revealFacts(input: { title: string; grade?: string; gradingCompany?: string; rarity?: string }, labels: { year: Text; grade: Text; rarity: Text }, t: (text: Text) => string) {
  const year = /^(19|20)\d{2}\b/.exec(input.title)?.[0];
  const grade = [input.gradingCompany, input.grade].filter(Boolean).join(" ");
  return [
    ...(year ? [{ label: t(labels.year), value: year }] : []),
    ...(grade ? [{ label: t(labels.grade), value: grade }] : []),
    ...(input.rarity ? [{ label: t(labels.rarity), value: input.rarity.toUpperCase(), emphasis: true }] : []),
  ];
}
