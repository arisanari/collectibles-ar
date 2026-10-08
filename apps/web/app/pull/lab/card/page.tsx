"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HoloCard, isHttpsUrl } from "../../../../components/HoloCard";
import { holoUi } from "../../../../lib/copy/pull";
import { useI18n } from "../../../../lib/i18n";
import { requestOrientationPermission } from "../../../../lib/reveal/deviceOrientation";
import { useCameraStream } from "../../../../lib/reveal/useCameraStream";

type Foil = 0 | 1 | 2 | 3;
const FOILS: Foil[] = [0, 1, 2, 3];

function FoilButtons({ foil, onPick, label }: { foil: Foil; onPick: (n: Foil) => void; label: string }) {
  const { t } = useI18n();
  return (
    <div className="labTiers holoCardFoils" role="group" aria-label={label}>
      {FOILS.map((n) => (
        <button key={n} type="button" aria-pressed={foil === n} onClick={() => onPick(n)}>
          {t(holoUi.foilName)} {n}
        </button>
      ))}
    </div>
  );
}

function Stage({ imageUrl, backImageUrl, title, foil, onFoil, onClose }: { imageUrl?: string; backImageUrl?: string; title: string; foil: Foil; onFoil: (n: Foil) => void; onClose: () => void }) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const camera = useCameraStream(videoRef);
  const close = () => {
    camera.stop();
    onClose();
  };
  return (
    <div className="holoCardStage" role="dialog" aria-modal="true">
      <video ref={videoRef} className="holoCardVideo" playsInline muted autoPlay />
      <div className="holoCardWrap">
        <HoloCard imageUrl={imageUrl} backImageUrl={backImageUrl} title={title} foil={foil} demo />
      </div>
      <div className="cameraRevealTop">
        <div>
          <span className="demoBadge">DEMO DATA</span>
          {(imageUrl || backImageUrl) && <p className="cameraRevealNote">{t(holoUi.imgNote)}</p>}
          {camera.failed && <p className="cameraRevealNote">{t(holoUi.noCamera)}{camera.error ? ` (${camera.error})` : ""}</p>}
        </div>
        <button type="button" className="cameraRevealClose holoCardClose" onClick={close} aria-label={t(holoUi.closeLabel)}>
          ×
        </button>
      </div>
      <p className="holoCardHint">{t(holoUi.spinHint)}</p>
      <div className="holoCardBar">
        <FoilButtons foil={foil} onPick={onFoil} label={t(holoUi.foilLabel)} />
      </div>
    </div>
  );
}

function CardLab() {
  const { t } = useI18n();
  const params = useSearchParams();
  const rawImg = params.get("img");
  const imageUrl = isHttpsUrl(rawImg) ? rawImg : undefined;
  const rawBack = params.get("back");
  const backImageUrl = isHttpsUrl(rawBack) ? rawBack : undefined;
  const titleParam = params.get("title");
  const title = titleParam || t(holoUi.dummyTitle);
  const [foil, setFoil] = useState<Foil>(0);
  const [open, setOpen] = useState(false);

  // iOS asks for motion access only inside a user gesture, so it is requested in the click handler.
  const start = () => {
    void requestOrientationPermission().finally(() => setOpen(true));
  };

  return (
    <main className="shell pullPage">
      <div className="pullBadges">
        <span className="demoBadge">DEMO DATA</span>
        <span className="eyebrow" style={{ margin: 0 }}>LAB</span>
      </div>
      <h1>{t(holoUi.title)}</h1>
      <p className="pullLead">{t(holoUi.note)}</p>
      <p className="pullLead">{t(holoUi.lead)}</p>
      {(imageUrl || backImageUrl) && <p className="pullLead">{t(holoUi.imgNote)}</p>}
      <FoilButtons foil={foil} onPick={setFoil} label={t(holoUi.foilLabel)} />
      <button type="button" className="primary" onClick={start}>{t(holoUi.start)}</button>
      {open && <Stage imageUrl={imageUrl} backImageUrl={backImageUrl} title={title} foil={foil} onFoil={setFoil} onClose={() => setOpen(false)} />}
    </main>
  );
}

/** Prototype page for the single-card look (DOM and CSS only). Not linked from the header; not connected to the real Pull flow. */
export default function HoloCardLabPage() {
  return (
    <Suspense fallback={null}>
      <CardLab />
    </Suspense>
  );
}
