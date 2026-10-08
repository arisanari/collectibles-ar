"use client";

/* eslint-disable @next/next/no-img-element -- the three dummy cards are self-made SVGs in /public (next/image does not optimise SVG) */
import Link from "next/link";
import { home } from "../lib/copy/landing";
import { useI18n } from "../lib/i18n";

const GACHA_SITE = "https://gacha.collectorcrypt.com/";
const GACHA_SITE_LABEL = "gacha.collectorcrypt.com";
const DEMO_CARDS = [1, 2, 3];

/** Landing: Pull a pack on Solana, the graded card appears life-size in AR. Static copy; no Solana RPC / DAS calls here. */
export default function Home() {
  const { t } = useI18n();

  return (
    <main>
      <section className="landingHero shell">
        <div className="landingHeroText">
          <div className="eyebrow">{t(home.eyebrow)}</div>
          <h1>{t(home.title)}</h1>
          <p>{t(home.lead)}</p>
          <div className="landingCtas">
            <Link className="primary linkButton" href="/pull">{t(home.ctaPull)}</Link>
            <Link className="secondary linkButton" href="/collection">{t(home.ctaCollection)}</Link>
          </div>
        </div>
        <figure className="landingArt">
          <div className="landingSlabs" aria-hidden="true">
            {DEMO_CARDS.map((n) => (
              <div className={`slabFrame slabFrame${n}`} key={n}>
                <img src={`/artworks/twinfold-demo-card-${n}.svg`} alt="" width={300} height={480} />
              </div>
            ))}
          </div>
          <figcaption>
            <span className="demoBadge">DEMO DATA</span> {t(home.artCaption)}
          </figcaption>
        </figure>
      </section>

      <section className="landingSection shell">
        <div className="sectionTitle">
          <div><span>{t(home.stepsEyebrow)}</span><h2>{t(home.stepsTitle)}</h2></div>
        </div>
        <ol className="landingSteps">
          {home.steps.map((step, index) => (
            <li key={step.name.en}>
              <span className="stepNo">{String(index + 1).padStart(2, "0")}</span>
              <h3>{t(step.name)}</h3>
              <p>{t(step.body)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landingSection shell">
        <div className="sectionTitle">
          <div><span>{t(home.whyEyebrow)}</span><h2>{t(home.whyTitle)}</h2></div>
        </div>
        <div className="landingWhy">
          <article>
            <h3>{t(home.whyMove.title)}</h3>
            <p>{t(home.whyMove.body)}</p>
          </article>
          <article>
            <h3>{t(home.whyVerify.title)}</h3>
            <p>
              {t(home.whyVerify.pre)}
              <a href={GACHA_SITE} target="_blank" rel="noreferrer">{t(home.whyVerify.linkText)}</a>
              {t(home.whyVerify.post)}
            </p>
          </article>
          <article>
            <h3>{t(home.whyFees.title)}</h3>
            <p>{t(home.whyFees.body)}</p>
          </article>
        </div>
      </section>

      <section className="landingSection shell">
        <div className="sectionTitle">
          <div><span>{t(home.diffEyebrow)}</span><h2>{t(home.diffTitle)}</h2></div>
        </div>
        <p className="landingLead">{t(home.diffBody)}</p>
        <div className="landingTableWrap">
          <table className="landingTable">
            <thead>
              <tr>
                <th scope="col"><span className="srOnly">{t(home.diffTitle)}</span></th>
                <th scope="col">{t(home.diffColOthers)}</th>
                <th scope="col">{t(home.diffColUs)}</th>
              </tr>
            </thead>
            <tbody>
              {home.diffRows.map((row) => (
                <tr key={row.label.en}>
                  <th scope="row">{t(row.label)}</th>
                  <td>
                    <span aria-label={t(row.others ? home.diffYes : home.diffNo)} role="img">{row.others ? "○" : "—"}</span>
                  </td>
                  <td>
                    <span aria-label={t(home.diffYes)} role="img">○</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="landingFine">{t(home.diffNote)}</p>
      </section>

      <section className="landingSection landingNotice shell">
        <div className="sectionTitle">
          <div><span>{t(home.noticeEyebrow)}</span><h2>{t(home.noticeTitle)}</h2></div>
          <span className="demoBadge">DEVNET</span>
        </div>
        <ul>
          {home.notices.map((notice) => <li key={notice.en}>{t(notice)}</li>)}
          <li>
            {t(home.realPacksPre)}
            <a href={GACHA_SITE} target="_blank" rel="noreferrer">{GACHA_SITE_LABEL}</a>
            {t(home.realPacksPost)}
          </li>
        </ul>
      </section>
    </main>
  );
}
