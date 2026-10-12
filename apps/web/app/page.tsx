"use client";

/* eslint-disable @next/next/no-img-element -- pool card photos are served by Collector Crypt's host and read at run time */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { HoloCard, type HoloCardHandle } from "../components/HoloCard";
import { home } from "../lib/copy/landing";
import type { GachaPoolCard } from "../lib/gacha/types";
import { useI18n } from "../lib/i18n";

const GACHA_SITE = "https://gacha.collectorcrypt.com/";
const GACHA_SITE_LABEL = "gacha.collectorcrypt.com";
// The Pull buttons on this page link to /pull only when NEXT_PUBLIC_PULL_OPEN=1. Otherwise they show as "Opening soon".
const PULL_OPEN = process.env.NEXT_PUBLIC_PULL_OPEN === "1";
// Public install link for the iOS app (TestFlight or App Store). Unset: the iOS buttons scroll to the iPhone panel.
const IOS_APP_URL = process.env.NEXT_PUBLIC_IOS_APP_URL || "";
// Real-device recording for the hero. The file is not in git (it shows real card photos); when it cannot load, the 3D dummy card shows instead.
const HERO_VIDEO_URL = process.env.NEXT_PUBLIC_HERO_VIDEO_URL || "/lp/hero-demo.mp4";
const HERO_POSTER_URL = process.env.NEXT_PUBLIC_HERO_VIDEO_URL ? undefined : "/lp/hero-demo.jpg";
// Short clips cut from the same kind of recording, cropped to the camera view. Not in git either; a clip that cannot load is left out.
// Off for now: turn on once clips shot by other people are in, and show each with its owner's name.
const SHOW_SHARE_WALL = false;
const LP_MEDIA_BASE = process.env.NEXT_PUBLIC_LP_MEDIA_BASE || "/lp";
const SHARE_CLIPS = [
  { file: "share-1.mp4", label: "lineUp" },
  { file: "share-2.mp4", label: "desk" },
  { file: "share-3.mp4", label: "close" },
  { file: "share-4.mp4", label: "angle" },
  { file: "share-5.mp4", label: "stand" },
  { file: "share-6.mp4", label: "close" },
  { file: "share-7.mp4", label: "cardOnly" },
] as const;
// Places for the cards floating around the phone. Each holds a pool card when the sample loads, else a drawn placeholder.
const FLOATING_SLABS = [
  { hue: 200, no: "01" },
  { hue: 20, no: "02" },
  { hue: 150, no: "03" },
  { hue: 320, no: "04" },
  { hue: 262, no: "05" },
  { hue: 48, no: "06" },
];
// Real-device clip for the iOS block (not in git; drawn slabs show when it cannot load).
const IOS_CLIP = "ios-demo.mp4";
const WALL_HUES = [200, 262, 20, 150];

const delay = (seconds: number) => ({ "--d": `${seconds}s` }) as CSSProperties;

/** Phantom's app icon, shown next to "Linked with Phantom". The mark belongs to Phantom. */
function PhantomGlyph() {
  return <img className="lpPhantom" src="/brand/phantom-icon.png" alt="" width={26} height={26} />;
}

/** Self-made dummy slab drawn in CSS. Not a real card; no card image is shipped in the repo. */
function DemoSlab({ hue, no }: { hue: number; no: string }) {
  return (
    <div className="lpSlab" style={{ "--h": hue } as CSSProperties}>
      <div className="lpSlabIn">
        <div className="lpSlabLabel"><span>DEMO / NOT A REAL CARD</span><b>{no}</b></div>
        <div className="lpSlabArt" />
      </div>
    </div>
  );
}

/** One clip on the share wall: a looping, muted recording with a REC-style label. Renders nothing when the file is missing. */
function ShareClip({ src, label, tilt, onFail }: { src: string; label: string; tilt: number; onFail: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => {
    setFailed((was) => {
      if (!was) onFail();
      return true;
    });
  }, [onFail]);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const check = () => {
      if (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) fail();
    };
    check();
    const later = window.setTimeout(check, 1500);
    return () => window.clearTimeout(later);
  }, [fail]);
  if (failed) return null;
  return (
    <figure className="lpClip" style={{ "--tilt": `${tilt}deg` } as CSSProperties}>
      <video ref={ref} src={src} autoPlay muted loop playsInline preload="metadata" onError={fail} />
      <span className="lpClipRec">REC</span>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** Landing: two ways in, Pull a pack (web) or the iOS app. Static copy; no Solana RPC / DAS calls here. */
export default function Home() {
  const { t } = useI18n();
  const rootRef = useRef<HTMLElement>(null);
  const heroCard = useRef<HoloCardHandle>(null);
  const heroVideo = useRef<HTMLVideoElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [shareFailed, setShareFailed] = useState(0);
  const iosVideo = useRef<HTMLVideoElement>(null);
  const [iosClipFailed, setIosClipFailed] = useState(false);
  const [poolCards, setPoolCards] = useState<GachaPoolCard[]>([]);

  // Cards floating around the phone: a sample of the machine's pool, through our own API. Drawn placeholders stay if it fails.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/gacha/pool")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { cards?: GachaPoolCard[] } | null) => {
        if (!cancelled && body?.cards?.length) setPoolCards(body.cards);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const onShareFail = useCallback(() => setShareFailed((count) => count + 1), []);

  // A missing file can fail before React attaches onError, so check once after mount as well.
  useEffect(() => {
    const broken = (video: HTMLVideoElement | null) =>
      Boolean(video && (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE));
    const check = () => {
      if (broken(heroVideo.current)) setVideoFailed(true);
      if (broken(iosVideo.current)) setIosClipFailed(true);
    };
    check();
    const later = window.setTimeout(check, 1500);
    return () => window.clearTimeout(later);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // The hero card starts face down and turns over once.
    const turn = window.setTimeout(() => heroCard.current?.flip(1), 700);

    const seen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        seen.unobserve(entry.target);
      }
    }, { threshold: 0.15 });
    root.querySelectorAll("[data-r]").forEach((el) => seen.observe(el));

    // Panels light up under the pointer.
    const onPointer = (event: PointerEvent) => {
      const el = (event.target as Element).closest<HTMLElement>(".lpGlow");
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      el.style.setProperty("--my", `${event.clientY - rect.top}px`);
    };
    root.addEventListener("pointermove", onPointer);
    return () => {
      window.clearTimeout(turn);
      seen.disconnect();
      root.removeEventListener("pointermove", onPointer);
    };
  }, []);

  // A card for the room sketch around the iPhone: a pool photo when the sample loaded, else a drawn placeholder.
  const roomCard = (index: number) => {
    const card = poolCards.length ? poolCards[index % poolCards.length] : undefined;
    return card ? (
      <img className="lpRoomCard" src={card.image} alt={card.name} key={index} />
    ) : (
      <div className="lpRoomCard" key={index} aria-hidden="true"><DemoSlab hue={WALL_HUES[index % WALL_HUES.length]} no={`0${index + 1}`} /></div>
    );
  };

  // While the Pull is closed the button stays in place but is not a link: a rocking capsule and an "Opening soon" tag.
  const pullButton = (label = home.ctaPull) =>
    PULL_OPEN ? (
      <Link className="lpBtn acid" href="/pull">{t(label)} <span aria-hidden="true">→</span></Link>
    ) : (
      <span className="lpBtn acid soon" aria-disabled="true">
        <i className="lpMiniCap" aria-hidden="true" />
        {t(label)}
        <em className="lpBtnTag">{t(home.pullSoon)}</em>
      </span>
    );
  // Same idea for the iOS app: a real link only once NEXT_PUBLIC_IOS_APP_URL is set.
  const iosButton = IOS_APP_URL ? (
    <a className="lpBtn ghost" href={IOS_APP_URL} target="_blank" rel="noreferrer">{t(home.ctaIos)}</a>
  ) : (
    <span className="lpBtn ghost soon" aria-disabled="true">
      {t(home.ctaIos)}
      <em className="lpBtnTag">{t(home.iosSoon)}</em>
    </span>
  );

  return (
    <main className="lp" ref={rootRef}>
      <section className="lpHero">
        <div className="lpAurora" aria-hidden="true"><i /><i /><i /></div>
        <div className="lpFloor" aria-hidden="true"><i /></div>
        <div className="lpHeroIn shell">
          <div className="lpHeroText">
            <div className="lpHeroTop lpRise">
              <span className="lpPill">{t(home.heroEyebrow)}</span>
              <span className="lpBetaTag">{t(home.heroTest)}</span>
            </div>
            <h1 className="lpRise" style={delay(0.08)}>
              <span>{t(home.heroTitle1)}</span>
              <span className="lpGrad">{t(home.heroTitle2)}</span>
            </h1>
            <p className="lpRise" style={delay(0.16)}>{t(home.heroLead)}</p>
            <div className="lpCtas lpRise" style={delay(0.24)}>
              {pullButton()}
              {iosButton}
            </div>
            <p className="lpFine lpRise" style={delay(0.3)}>{t(home.heroFine)}</p>
          </div>
          <figure className="lpStage lpRise" style={delay(0.2)}>
            {videoFailed ? (
              <div className="lpFloat">
                <HoloCard title={t(home.dragHint)} foil={3} demo initialFace="back" controlRef={heroCard} />
              </div>
            ) : (
              <div className="lpPhone">
                <video
                  ref={heroVideo}
                  src={HERO_VIDEO_URL}
                  poster={HERO_POSTER_URL}
                  aria-label={t(home.videoLabel)}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  onError={() => setVideoFailed(true)}
                />
              </div>
            )}
            {!videoFailed && (
              <span className="lpArTag lpLinked t1"><PhantomGlyph /><b>{t(home.linkedWith)}</b></span>
            )}
            <figcaption className="lpStageNote">
              {videoFailed ? (
                <>
                  <span className="demoBadge">DEMO DATA</span>
                  <span>{t(home.dragHint)} · {t(home.artCaption)}</span>
                </>
              ) : (
                <span>{t(home.videoCaption)}</span>
              )}
            </figcaption>
          </figure>
        </div>
        <div className="lpScroll" aria-hidden="true">{t(home.scrollHint)}</div>
      </section>

      <section className="lpTwo shell" aria-label={t(home.two.label)}>
        <p className="lpTag" data-r>{t(home.two.label)}</p>
        <div className="lpTwoGrid">
          {home.two.items.map((item, index) => (
            <a className="lpTwoItem" href={item.href} key={item.href} data-r style={delay(index * 0.1)}>
              <span className="lpTwoNo">{`0${index + 1}`}</span>
              <span className="lpTwoBody">
                <b>{t(item.name)}</b>
                <span>{t(item.body)}</span>
              </span>
              <span className="lpTwoMeta">{t(item.where)}</span>
              <span className="lpTwoArrow" aria-hidden="true">↓</span>
            </a>
          ))}
        </div>
      </section>

      {SHOW_SHARE_WALL && shareFailed < SHARE_CLIPS.length * 2 && (
        <section className="lpShare">
          <div className="lpHead shell" data-r>
            <span className="lpTag">{t(home.shareEyebrow)}</span>
            <h2>{t(home.shareTitle)}</h2>
            <p>{t(home.shareBody)}</p>
          </div>
          <div className="lpShareRow">
            {[0, 1].map((copy) => (
              <div className="lpShareTrack" key={copy} aria-hidden={copy === 1}>
                {SHARE_CLIPS.map((clip, index) => (
                  <ShareClip key={clip.file} src={`${LP_MEDIA_BASE}/${clip.file}`} label={t(home.shareLabels[clip.label])} tilt={index % 2 ? 1.5 : -1.5} onFail={onShareFail} />
                ))}
              </div>
            ))}
          </div>
          <p className="lpFine shell">{t(home.shareNote)}</p>
        </section>
      )}

      <section className="lpSection lpPullShow shell" id="pull">
        <div className="lpHead" data-r>
          <span className="lpTag">{t(home.pullShow.eyebrow)}</span>
          <h2>{t(home.pullShow.title)}</h2>
          <p>{t(home.pullShow.body)}</p>
        </div>
        <div className="lpPullStage" data-r>
          {FLOATING_SLABS.map((slab, index) => {
            const card = poolCards[index];
            return (
              <div className={`lpFloater f${index + 1}`} key={slab.hue} aria-hidden={card ? undefined : true}>
                {card ? (
                  <figure className="lpPoolCard">
                    <img src={card.image} alt={card.name} />
                    <figcaption>{card.rarity}</figcaption>
                  </figure>
                ) : (
                  <DemoSlab hue={slab.hue} no={slab.no} />
                )}
              </div>
            );
          })}
          <div className="lpPhone">
            <div className="lpPhoneEmpty" aria-hidden="true">
              <div className="lpCapsuleShadow" />
              <div className="lpCapsule"><i /><i /><i /></div>
            </div>
          </div>
        </div>
        <div className="lpPullCta" data-r>
          {pullButton()}
          <p className="lpFine"><span className="demoBadge">DEVNET</span> {t(home.pullShow.note)}</p>
          {poolCards.length > 0 && <p className="lpFine">{t(home.pullShow.poolNote)}</p>}
        </div>
      </section>

      <section className="lpSection shell" id="ios">
        <div className="lpIos">
          <div className="lpHead" data-r>
            <span className="lpTag">{t(home.ios.eyebrow)}</span>
            <div className="lpIosTop">
              <span className="lpIosPill">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <rect x="10" y="4.6" width="4" height="1.3" rx=".65" fill="currentColor" />
                </svg>
                {t(home.ios.pill)}
              </span>
              <span className="lpBetaTag">{t(home.ios.beta)}</span>
            </div>
            <h2>{t(home.ios.title)}</h2>
            <p>{t(home.ios.body)}</p>
          </div>
          <div className="lpRoomStage" data-r>
            <div className="lpRoomCol">
              <div className="lpRoom shelf">
                <div className="lpRoomArt">
                  <svg viewBox="0 0 260 200" aria-hidden="true">
                    <path d="M14 132h232v8H14ZM50 140v30l30-30M210 140v30l-30-30" />
                    <path d="M24 132V78h12v54M36 132V66h14v66M50 132V84h10v48M27 90h6M39 80h8" />
                    <path d="M236 132v-14h-20v14M226 118c0-16-10-22-16-24M226 118c0-18 8-28 16-30M226 118V92" />
                  </svg>
                  {roomCard(0)}{roomCard(1)}{roomCard(2)}
                </div>
                <span className="lpTag">{t(home.ios.places[0])}</span>
              </div>
              <div className="lpRoom desk">
                <div className="lpRoomArt">
                  <svg viewBox="0 0 260 200" aria-hidden="true">
                    <path d="M18 118 178 92 244 116 84 146ZM18 118v10l66 28v-10M84 156 244 126v-10M30 133v58M84 156v40M232 128v54" />
                    <path d="M196 104c0-4 8-6 14-6s14 2 14 6-8 6-14 6-14-2-14-6ZM210 98 196 52M196 52l26-14M214 30l20 14-14 8Z" />
                  </svg>
                  {roomCard(3)}
                </div>
                <span className="lpTag">{t(home.ios.places[1])}</span>
              </div>
            </div>
            <figure className="lpIosStage">
              {iosClipFailed ? (
                <div className="lpPhone"><div className="lpPhoneEmpty" /></div>
              ) : (
                <div className="lpPhone">
                  <video
                    ref={iosVideo}
                    src={`${LP_MEDIA_BASE}/${IOS_CLIP}`}
                    poster={`${LP_MEDIA_BASE}/${IOS_CLIP.replace(".mp4", ".jpg")}`}
                    aria-label={t(home.ios.videoLabel)}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    onError={() => setIosClipFailed(true)}
                  />
                </div>
              )}
              <span className="lpArTag lpLinked t1"><PhantomGlyph /><b>{t(home.linkedWith)}</b></span>
            </figure>
            <div className="lpRoomCol">
              <div className="lpRoom cafe">
                <div className="lpRoomArt">
                  <svg viewBox="0 0 260 200" aria-hidden="true">
                    <path d="M130 0v22M110 38a20 20 0 0 1 40 0Z" />
                    <path d="M56 122c0-8 33-14 74-14s74 6 74 14-33 14-74 14-74-6-74-14ZM130 136v48M100 186h60" />
                    <path d="M168 104v10c0 5 5 8 11 8s11-3 11-8v-10ZM190 107c7 0 7 9 0 9M163 124h32M174 96c-3-4 3-6 0-10M184 96c-3-4 3-6 0-10" />
                  </svg>
                  {roomCard(4)}
                </div>
                <span className="lpTag">{t(home.ios.places[2])}</span>
              </div>
              <div className="lpRoom outside">
                <div className="lpRoomArt">
                  <svg viewBox="0 0 260 200" aria-hidden="true">
                    <path d="M0 186h260M48 138h150v8H48ZM52 104h142v10H52ZM62 114v24M184 114v24M62 146v40M184 146v40" />
                    <path d="M230 186v-76M230 110c-20 0-34-14-34-34s14-36 34-36 30 16 30 36M230 150l14-14M230 132l-12-12" />
                    <circle cx="34" cy="36" r="12" /><path d="M34 12v6M34 54v6M10 36h6M52 36h6M17 19l4 4M47 49l4 4M17 53l4-4M47 23l4-4" />
                  </svg>
                  {roomCard(5)}
                </div>
                <span className="lpTag">{t(home.ios.places[3])}</span>
              </div>
            </div>
          </div>
          <div className="lpPullCta" data-r>
            {IOS_APP_URL ? (
              <a className="lpBtn acid" href={IOS_APP_URL} target="_blank" rel="noreferrer">
                {t(home.ios.cta)} <em className="lpBtnTag">{t(home.ios.beta)}</em> <span aria-hidden="true">→</span>
              </a>
            ) : (
              <>
                <span className="lpBtn acid off" aria-disabled="true">
                  {t(home.ios.cta)} <em className="lpBtnTag">{t(home.ios.beta)}</em>
                </span>
                <p className="lpSoon">{t(home.ios.soon)}</p>
              </>
            )}
            <p className="lpFine"><span className="demoBadge">MAINNET (read-only)</span> {t(home.ios.note)}</p>
          </div>
        </div>
      </section>

      <section className="lpSection shell">
        <div className="lpHead" data-r>
          <span className="lpTag">{t(home.whatEyebrow)}</span>
          <h2>{t(home.whatTitle)}</h2>
        </div>
        <div className="lpFeatures">
          {home.features.map((feature, index) => (
            <article className="lpGlow" key={feature.title.en} data-r style={delay((index % 2) * 0.1)}>
              <span>{`0${index + 1}`}</span>
              <h3>{t(feature.title)}</h3>
              <p>{t(feature.body)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lpSection shell">
        <div className="lpHead" data-r>
          <span className="lpTag">{t(home.faqEyebrow)}</span>
          <h2>{t(home.faqTitle)}</h2>
        </div>
        <div className="lpFaq" data-r>
          {home.faqs.map((faq) => (
            <details key={faq.q.en}>
              <summary>{t(faq.q)}</summary>
              <p>{t(faq.a)}</p>
            </details>
          ))}
        </div>
        <p className="lpFine">
          <span className="demoBadge">DEVNET</span>
          <span>
            {t(home.realPacksPre)}
            <a href={GACHA_SITE} target="_blank" rel="noreferrer">{GACHA_SITE_LABEL}</a>
            {t(home.realPacksPost)}
          </span>
        </p>
      </section>

      <section className="lpClosing shell" data-r>
        <div className="lpAurora" aria-hidden="true"><i /><i /><i /></div>
        <div className="lpFloor" aria-hidden="true"><i /></div>
        <h2>{t(home.closingTitle)}</h2>
        <p>{t(home.closingBody)}</p>
        <div className="lpCtas">
          {pullButton()}
          {iosButton}
        </div>
      </section>
    </main>
  );
}
