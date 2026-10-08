"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isHttpsUrl } from "../../../../components/HoloCard";
import { PackReveal } from "../../../../components/PackReveal";
import { holoUi, labUi, packUi } from "../../../../lib/copy/pull";
import { useI18n } from "../../../../lib/i18n";
import { requestOrientationPermission } from "../../../../lib/reveal/deviceOrientation";

type Tier = 0 | 1 | 2 | 3;
const TIERS: Tier[] = [0, 1, 2, 3];
const SELL_WAIT_MS = 800; // stands in for waiting on a signature
const WAIT_MS = 1500;
const FACT_MAX = 60; // characters kept from each value in the query

/** Facts from the query, in this order. Strings are shown as given (rarity is upper-cased only). Placeholders when nothing is given. */
function readFacts(params: URLSearchParams, t: (x: { en: string; ja: string }) => string) {
  const defs = [
    { key: "year", label: packUi.factYear },
    { key: "grade", label: packUi.factGrade },
    { key: "rarity", label: packUi.factRarity, emphasis: true },
    { key: "series", label: packUi.factSeries },
  ]; // the first three are shown in huge type, one at a time; the fourth only in the sheet
  const out: { label: string; value: string; emphasis?: boolean }[] = [];
  for (const d of defs) {
    const v = params.get(d.key);
    if (v) out.push({ label: t(d.label), value: (d.emphasis ? v.toUpperCase() : v).slice(0, FACT_MAX), emphasis: d.emphasis });
  }
  if (out.length > 0) return { facts: out, demo: false };
  // DEMO DATA stand-ins, made up for this lab page
  return {
    demo: true,
    facts: [
      { label: t(packUi.factYear), value: "2000" },
      { label: t(packUi.factGrade), value: "DEMO 10" },
      { label: t(packUi.factRarity), value: "DEMO", emphasis: true },
      { label: t(packUi.factSeries), value: "DEMO SERIES" },
    ],
  };
} // how long the opening stays in "waiting" (a stand-in for the Pull result arriving)

function OpenLab() {
  const { t } = useI18n();
  const params = useSearchParams();
  const rawImg = params.get("img");
  const rawBack = params.get("back");
  const imageUrl = isHttpsUrl(rawImg) ? rawImg : undefined;
  const backImageUrl = isHttpsUrl(rawBack) ? rawBack : undefined;
  const title = params.get("title") || t(holoUi.dummyTitle);
  const { facts } = readFacts(params, t);
  const [tier, setTier] = useState<Tier>(1);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [outcome, setOutcome] = useState<"none" | "kept" | "sold">("none");

  // After opening, the pack waits for a moment, then becomes ready.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setReady(true), WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  // iOS asks for motion access only inside a user gesture, so it is requested in the click handler.
  const start = () => {
    void requestOrientationPermission().finally(() => {
      setReady(false);
      setOutcome("none");
      setOpen(true);
    });
  };

  return (
    <main className="shell pullPage">
      <div className="pullBadges">
        <span className="demoBadge">{imageUrl || backImageUrl ? "DEVNET" : "DEMO DATA"}</span>
        <span className="eyebrow" style={{ margin: 0 }}>LAB</span>
      </div>
      <h1>{t(packUi.title)}</h1>
      <p className="pullLead">{t(labUi.note)}</p>
      <p className="pullLead">{t(packUi.lead)}</p>
      <p className="pullLead">{t(packUi.sellNote)}</p>
      {(imageUrl || backImageUrl) && <p className="pullLead">{t(holoUi.imgNote)}</p>}
      <div className="labTiers" role="group" aria-label={t(labUi.tierLabel)}>
        {TIERS.map((n) => (
          <button key={n} type="button" aria-pressed={tier === n} onClick={() => setTier(n)}>
            {t(labUi.tierName)} {n} ({t(packUi.tierHint[n])})
          </button>
        ))}
      </div>
      <button type="button" className="primary" onClick={start}>{t(labUi.start)}</button>
      {open && <PackReveal tier={tier} facts={facts} ready={ready} imageUrl={imageUrl} backImageUrl={backImageUrl} title={title} demo={!imageUrl && !backImageUrl} onClose={() => setOpen(false)} buyback={{ amountLabel: t(packUi.demoAmount) }} outcome={outcome} onKeep={() => setOutcome("kept")} onSell={() => new Promise<void>((resolve) => window.setTimeout(() => { setOutcome("sold"); resolve(); }, SELL_WAIT_MS))} onAgain={() => setOutcome("none")} />}
    </main>
  );
}

/** Prototype page for the pack-and-lightning opening. Not linked from the header; not connected to the real Pull flow. */
export default function OpenLabPage() {
  return (
    <Suspense fallback={null}>
      <OpenLab />
    </Suspense>
  );
}
