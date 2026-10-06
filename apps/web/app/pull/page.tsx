"use client";

/* eslint-disable @next/next/no-img-element -- the machine thumbnail is served by Collector Crypt's host */
import Link from "next/link";
import { useEffect, useState } from "react";
import { CardAssetCard } from "../../components/CardAssetCard";
import { useAuth } from "../../components/AuthProvider";
import { pullUi } from "../../lib/copy/pull";
import { formatEv, formatOdds, formatStock } from "../../lib/gacha/format";
import type { GachaMachine } from "../../lib/gacha/types";
import { usePull, type PullState } from "../../lib/gacha/usePull";
import { useI18n } from "../../lib/i18n";
import { explorerTxUrl, shortAddress } from "../../lib/labels";

const DEFAULT_MACHINE = "pokemon_25";
const TIERS = ["common", "uncommon", "rare", "epic"] as const;

type MachinesResult = { key: string; machines: GachaMachine[]; isDemoData: boolean; fetchedAt: string; failed: boolean };

const stageText = (state: PullState) => {
  switch (state.stage) {
    case "creating":
      return pullUi.stage.creating;
    case "signing":
      return pullUi.stage.signing;
    case "submitting":
      return pullUi.stage.submitting;
    case "opening":
      return state.paused ? pullUi.stage.openingPaused : state.busyRetry ? pullUi.stage.openingBusy : pullUi.stage.opening;
    default:
      return null;
  }
};

/** Pull page: machine info (Collector Crypt's values as received), Pull button, result card. */
export default function PullPage() {
  const { t } = useI18n();
  const auth = useAuth();
  const authedWallet = auth.status === "authenticated" ? auth.wallet : null;
  const [demoOn, setDemoOn] = useState(false);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [result, setResult] = useState<MachinesResult | null>(null);

  const key = demoOn ? "demo" : "devnet";
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/gacha/machines${demoOn ? "?demo=1" : ""}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { isDemoData: boolean; fetchedAt: string; machines: GachaMachine[] };
        if (!cancelled) setResult({ key, machines: body.machines, isDemoData: body.isDemoData, fetchedAt: body.fetchedAt, failed: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, machines: [], isDemoData: demoOn, fetchedAt: "", failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [key, demoOn]);

  const current = result?.key === key ? result : null;
  const machines = current?.machines ?? [];
  // DEMO DATA when the user chose it, or when the server itself serves the mock provider.
  const isDemo = demoOn || current?.isDemoData === true;
  const machine = machines.find((m) => m.code === selectedCode) ?? machines.find((m) => m.code === DEFAULT_MACHINE) ?? machines[0];

  const pull = usePull({ demo: isDemo, wallet: authedWallet });
  const { state } = pull;
  const inProgress = ["creating", "signing", "submitting"].includes(state.stage) || (state.stage === "opening" && !state.paused);
  const connecting = auth.status === "connecting" || auth.status === "awaiting_signature";
  const canPull = Boolean(machine) && !inProgress && !(state.resumable && (state.stage === "failed" || state.stage === "opening"));
  const message = stageText(state);
  const valueNote = isDemo ? t(pullUi.demoValue) : t(pullUi.published);
  // The badge waits until the provider is known: the user chose DEMO DATA, or the machines answer said which one it is.
  const badge = demoOn || (current && !current.failed) ? (isDemo ? "DEMO DATA" : "DEVNET") : null;
  const myOrphans = pull.orphans.filter((o) => o.wallet === authedWallet);

  function startNewPull() {
    if (pull.needsConfirm && !window.confirm(t(pullUi.confirmNewPull))) return;
    pull.reset();
  }

  return (
    <main className="shell pullPage">
      <div className="pullBadges">
        {badge && <span className="demoBadge">{badge}</span>}
        <span className="eyebrow" style={{ margin: 0 }}>{t(pullUi.eyebrow)}</span>
      </div>
      <h1>{t(pullUi.title)}</h1>
      <p className="pullLead">{t(pullUi.lead)}</p>
      <p className="pullLead">{isDemo ? t(pullUi.demoOn) : t(pullUi.network)}</p>
      {isDemo ? (
        demoOn && <button className="textButton" onClick={() => setDemoOn(false)}>{t(pullUi.demoOff)}</button>
      ) : (
        <button className="textButton" onClick={() => setDemoOn(true)}>{t(pullUi.demoTry)}</button>
      )}

      <div className="pullLayout">
        <section className="machinePanel" aria-label={t(pullUi.machine)}>
          <div className="eyebrow">{t(pullUi.machine)}</div>
          {!current && <p className="pullNote">{t(pullUi.machinesLoading)}</p>}
          {current?.failed && <p className="pullError" role="alert">{t(pullUi.machinesFailed)}</p>}
          {machine && (
            <>
              <div className="machineHead">
                {machine.thumbnailUrl && <img className="machineThumb" src={machine.thumbnailUrl} alt="" />}
                <div>
                  <h2>{machine.name}</h2>
                  {machines.length > 1 && (
                    <select className="machineSelect" aria-label={t(pullUi.machine)} value={machine.code} onChange={(e) => setSelectedCode(e.target.value)} disabled={inProgress}>
                      {machines.map((m) => (
                        <option key={m.code} value={m.code}>{m.code} · {m.price} {t(pullUi.priceUnit)}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              <dl className="machineFacts">
                <div><dt>{t(pullUi.price)}</dt><dd>{machine.price} {t(pullUi.priceUnit)}</dd></div>
                <div>
                  <dt>{t(pullUi.odds)}<small>{valueNote}</small></dt>
                  <dd>{TIERS.map((tier) => `${t(pullUi.tier[tier])} ${formatOdds(machine.odds[tier])}`).join(" · ")}</dd>
                </div>
                {machine.ev !== undefined && (
                  <div><dt>{t(pullUi.ev)}<small>{valueNote}</small></dt><dd>{formatEv(machine.ev)}</dd></div>
                )}
                {machine.stock && (
                  <div>
                    <dt>{t(pullUi.stock)}<small>{valueNote}</small></dt>
                    <dd>{TIERS.map((tier) => `${t(pullUi.tier[tier])} ${formatStock(machine.stock?.[tier] ?? 0)}`).join(" · ")}</dd>
                  </div>
                )}
                <div><dt>{t(pullUi.buyback)}<small>{valueNote}</small></dt><dd>{machine.instantBuyback}%</dd></div>
              </dl>
              <p className="pullNote">{t(pullUi.buybackNote)}</p>
              {current?.fetchedAt && <p className="pullNote">{t(pullUi.fetchedAt)}: {current.fetchedAt}</p>}

              <div className="pullActions">
                {canPull && (isDemo || authedWallet) && (
                  <button className="primary" onClick={() => void pull.start(machine.code)}>
                    {isDemo ? t(pullUi.pullDemo) : t(pullUi.pull)}
                  </button>
                )}
                {canPull && !isDemo && !authedWallet && (
                  <button className="primary" disabled={connecting} onClick={() => void auth.connect()}>
                    {connecting ? t(pullUi.connecting) : t(pullUi.connect)}
                  </button>
                )}
                {inProgress && <button className="primary" disabled>{t(pullUi.busy)}</button>}
                {state.resumable && (state.stage === "failed" || state.paused) && (
                  <>
                    <button className="primary" onClick={pull.checkAgain}>{t(pullUi.checkAgain)}</button>
                    <button className="secondary" onClick={startNewPull}>{t(pullUi.newPull)}</button>
                  </>
                )}
              </div>
            </>
          )}
        </section>

        <section className="resultPanel" aria-live="polite" aria-label={t(pullUi.resultTitle)}>
          <div className="eyebrow">{t(pullUi.resultTitle)}</div>
          {pull.status === null && <p className="pullNote">—</p>}
          {pull.status !== null && (
            <div className="pullStatus">
              <span>{t(pullUi.statusLabel)}</span>
              <span className={`statusTag ${pull.status}`}>{t(pullUi.status[pull.status])}</span>
              {state.stage === "opening" && <span>{t(pullUi.attempts)} {state.attempts}</span>}
            </div>
          )}
          {state.resumed && state.stage !== "opened" && <p className="pullNote">{t(pullUi.stage.resumed)}</p>}
          {state.stage === "opened" && pull.status === "pending" && <p className="pullNote">{t(pullUi.confirmingNote)}</p>}
          {message && <p className="pullNote">{t(message)}</p>}
          {state.error && (
            <p className="pullError" role="alert">
              {t(pullUi.errors[state.error])}
              {state.errorDetail ? ` (${state.errorDetail})` : ""}
            </p>
          )}
          {state.memo && state.stage !== "opened" && <p className="pullMemo">memo: {state.memo}</p>}
          {state.stage === "opened" && state.asset && (
            <>
              <CardAssetCard asset={state.asset} demo={isDemo} />
              {state.rarity && <p className="pullNote">{t(pullUi.rarity)}: {state.rarity}</p>}
              {isDemo ? (
                <p className="pullNote">{t(pullUi.demoResultNote)}</p>
              ) : (
                state.transactionSignature && (
                  <p className="pullNote">
                    {t(pullUi.tx)}: <a href={explorerTxUrl(state.transactionSignature)} target="_blank" rel="noreferrer">{shortAddress(state.transactionSignature)}</a>
                  </p>
                )
              )}
              <div className="pullActions">
                <Link href="/collection" className="secondary linkButton">{t(pullUi.collectionLink)}</Link>
              </div>
            </>
          )}
        </section>
      </div>

      {myOrphans.length > 0 && (
        <section className="orphanPanel" aria-label={t(pullUi.orphanTitle)}>
          <div className="eyebrow">{t(pullUi.orphanTitle)}</div>
          <p className="pullNote">{t(pullUi.orphanNote)}</p>
          <ul className="orphanList">
            {myOrphans.map((o) => (
              <li key={o.memo}>
                <span className="pullMemo">{o.memo}</span>
                <span className="pullNote">{o.packType} · {o.droppedAt}</span>
                <button className="textButton" onClick={() => pull.dismissOrphan(o.memo)}>{t(pullUi.orphanDismiss)}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
