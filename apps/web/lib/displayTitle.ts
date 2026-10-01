import type { TwinfoldAsset } from "./contract";

/** ja if `lang` is Japanese and a ja title exists, else en if it exists,
 * else `title`. Mirrors `TwinfoldAsset.displayTitle(for:)` in TwinfoldCore. */
export function displayTitle(asset: TwinfoldAsset, lang: string): string {
  const isJa = lang.toLowerCase().split("-")[0] === "ja";
  const { ja, en } = asset.titleLocalized ?? {};
  if (isJa && ja) return ja;
  if (en) return en;
  return asset.title;
}
