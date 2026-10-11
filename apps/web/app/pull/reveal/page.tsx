"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PackReveal } from "../../../components/PackReveal";
import { packUi, pullUi } from "../../../lib/copy/pull";
import { useI18n } from "../../../lib/i18n";
import { backPhotoUrl, EFFECT_TIER, effectTier, revealFacts } from "../../../lib/reveal/pullReveal";

type Card = { title: string; imageUrl: string | null; backImageUrl: string | null; grade: string | null; gradingCompany: string | null; rarity: string | null };
type Loaded = { nft: string; card: Card | null };

function Reveal() {
  const { t } = useI18n();
  const params = useSearchParams();
  const nft = params.get("nft") ?? "";
  // Only used when the server has no rarity for this card (a Pull recorded before it was kept); limited to Collector Crypt's four tier names.
  const rarityParam = (params.get("rarity") ?? "").toLowerCase();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<"none" | "kept">("none");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/gacha/reveal?nft=${encodeURIComponent(nft)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as Card) : null))
      .catch(() => null)
      .then((card) => {
        if (!cancelled) setLoaded({ nft, card });
      });
    return () => {
      cancelled = true;
    };
  }, [nft]);

  const current = loaded?.nft === nft ? loaded : null;
  const card = current?.card ?? null;
  const rarity = card?.rarity ?? (rarityParam in EFFECT_TIER ? rarityParam : undefined);

  return (
    <main className="shell pullPage">
      <div className="pullBadges">
        <span className="demoBadge">DEVNET</span>
        <span className="eyebrow" style={{ margin: 0 }}>{t(pullUi.eyebrow)}</span>
      </div>
      <h1>{t(pullUi.revealTitle)}</h1>
      <p className="pullLead">{t(pullUi.revealLead)}</p>
      {!current && <p className="pullNote">{t(pullUi.revealLoading)}</p>}
      {current && !card && <p className="pullError" role="alert">{t(pullUi.revealNotFound)}</p>}
      {card && (
        <>
          <p className="pullNote">{card.title}</p>
          <div className="pullActions">
            {/* a tap, so the browser may ask for the camera */}
            <button className="primary" onClick={() => { setOutcome("none"); setOpen(true); }}>{t(pullUi.revealStart)}</button>
            <Link href="/collection" className="secondary linkButton">{t(pullUi.collectionLink)}</Link>
          </div>
        </>
      )}
      {open && card && (
        <PackReveal
          tier={effectTier(rarity)}
          imageUrl={card.imageUrl ?? undefined}
          backImageUrl={card.backImageUrl ?? backPhotoUrl(card.imageUrl ?? undefined)}
          facts={revealFacts({ title: card.title, grade: card.grade ?? undefined, gradingCompany: card.gradingCompany ?? undefined, rarity }, { year: packUi.factYear, grade: packUi.factGrade, rarity: packUi.factRarity }, t)}
          title={card.title}
          demo={false}
          outcome={outcome}
          onKeep={() => setOutcome("kept")}
          onAgain={() => setOutcome("none")}
          onClose={() => setOpen(false)}
        />
      )}
    </main>
  );
}

/** Replays the opening of a card that was pulled on devnet, in a browser that can use the camera. Display only: nothing is signed or sent. */
export default function PullRevealPage() {
  return (
    <Suspense fallback={null}>
      <Reveal />
    </Suspense>
  );
}
