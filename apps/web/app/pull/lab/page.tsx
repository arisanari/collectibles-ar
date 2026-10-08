"use client";

import { useState } from "react";
import { CameraReveal } from "../../../components/CameraReveal";
import { CameraReveal3D, requestOrientationPermission } from "../../../components/CameraReveal3D";
import { labUi } from "../../../lib/copy/pull";
import { useI18n } from "../../../lib/i18n";

type Tier = 0 | 1 | 2 | 3;
const TIERS: Tier[] = [0, 1, 2, 3];

/** Prototype page for the camera opening effect. Not linked from the header; not connected to the real Pull flow. */
export default function PullLabPage() {
  const { t } = useI18n();
  const [tier, setTier] = useState<Tier>(1);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"3d" | "2d">("3d");

  // iOS asks for motion access only inside a user gesture, so it is requested here, in the click handler.
  const start = () => {
    if (mode === "3d") void requestOrientationPermission().finally(() => setOpen(true));
    else setOpen(true);
  };

  return (
    <main className="shell pullPage">
      <div className="pullBadges">
        <span className="demoBadge">DEMO DATA</span>
        <span className="eyebrow" style={{ margin: 0 }}>LAB</span>
      </div>
      <h1>{t(labUi.title)}</h1>
      <p className="pullLead">{t(labUi.note)}</p>
      <p className="pullLead">{t(labUi.lead)}</p>
      <div className="labTiers" role="group" aria-label={t(labUi.tierLabel)}>
        {TIERS.map((n) => (
          <button key={n} type="button" aria-pressed={tier === n} onClick={() => setTier(n)}>
            {t(labUi.tierName)} {n}
          </button>
        ))}
      </div>
      <div className="labTiers" role="group" aria-label={t(labUi.modeLabel)}>
        <button type="button" aria-pressed={mode === "3d"} onClick={() => setMode("3d")}>{t(labUi.mode3d)}</button>
        <button type="button" aria-pressed={mode === "2d"} onClick={() => setMode("2d")}>{t(labUi.mode2d)}</button>
      </div>
      <button type="button" className="primary" onClick={start}>{t(labUi.start)}</button>
      {open && mode === "3d" && <CameraReveal3D tier={tier} cardTitle={t(labUi.dummyTitle)} demo onClose={() => setOpen(false)} />}
      {open && mode === "2d" && <CameraReveal tier={tier} cardTitle={t(labUi.dummyTitle)} demo onClose={() => setOpen(false)} />}
    </main>
  );
}
