import type { Redemption, RedemptionEvent, RedemptionStatus, RedemptionSummary } from "../contract";
import { recordAudit, ref } from "../link/audit";
import { readJsonFile, writeJsonFileAtomic } from "../persist/jsonFile";

/**
 * Redeem Physical state machine and store (Issues #22/#23/#28/#42), dry run.
 *
 *   requested -> locked -> shipped -> received -> retired
 *   requested | locked -> cancelled           (never after shipped)
 *   locked | shipped | received -> exception  (safe stop; Asset stays in escrow)
 *   exception -> received                     (operator `retry_retire` only; the retire is then attempted again)
 *
 * Persistence: file-backed JSON (lib/persist/jsonFile.ts) so redemptions survive a dev-server restart.
 * In-flight flags (a retire currently running, last chain reconcile) stay in memory only.
 * NO personal data (name, address, phone, tracking) is ever stored: `note` is short free text that
 * `sanitizeNote` rejects when it looks like contact data.
 */

export const OPEN_STATUSES: RedemptionStatus[] = ["requested", "locked", "shipped", "received", "exception"];
export const isOpenStatus = (s: RedemptionStatus) => OPEN_STATUSES.includes(s);

/** Max simultaneously open redemptions per wallet (each one costs the vault fees). */
export const MAX_OPEN_PER_WALLET = 3;
export const MAX_REDEMPTIONS = 500;
const FILE = "redemptions.json";

type Persisted = { redemptions: Record<string, Redemption> };

const g = globalThis as unknown as { __twinfoldRedemptions?: Map<string, Redemption>; __twinfoldRedemptionRuntime?: Map<string, Runtime> };
export type Runtime = { reconciledAt?: number; reconciling?: boolean; busy?: boolean; burnSignature?: string; returnSignature?: string; passportFailed?: boolean };
const runtime: Map<string, Runtime> = (g.__twinfoldRedemptionRuntime ??= new Map());

function load(): Map<string, Redemption> {
  if (g.__twinfoldRedemptions) return g.__twinfoldRedemptions;
  const data = readJsonFile<Persisted>(FILE, { redemptions: {} });
  g.__twinfoldRedemptions = new Map(Object.entries(data.redemptions));
  return g.__twinfoldRedemptions;
}

function persist() {
  writeJsonFileAtomic(FILE, { redemptions: Object.fromEntries(load()) } satisfies Persisted);
}

/** Test hook: forget the in-memory copy so the next call re-reads the file (simulates a restart). */
export function reloadFromDiskForTests() {
  g.__twinfoldRedemptions = undefined;
  runtime.clear();
}

export function runtimeOf(id: string): Runtime {
  let r = runtime.get(id);
  if (!r) runtime.set(id, (r = {}));
  return r;
}

const iso = (now: number) => new Date(now).toISOString();

export function getRedemption(id: string): Redemption | undefined {
  return load().get(id);
}

export function listForWallet(wallet: string): Redemption[] {
  return Array.from(load().values())
    .filter((r) => r.wallet === wallet)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listOpen(): Redemption[] {
  return Array.from(load().values())
    .filter((r) => isOpenStatus(r.status))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function findOpenByAsset(assetId: string): Redemption | undefined {
  for (const r of Array.from(load().values())) if (r.assetId === assetId && isOpenStatus(r.status)) return r;
  return undefined;
}

/** Newest redemption of an Asset that is open or retired (a cancelled one no longer affects the Asset). */
export function findEffectiveByAsset(assetId: string): Redemption | undefined {
  const all = Array.from(load().values())
    .filter((r) => r.assetId === assetId && (isOpenStatus(r.status) || r.status === "retired"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return all[0];
}

export function isAssetInRedemption(assetId: string): boolean {
  return !!findOpenByAsset(assetId);
}

export function summaryOf(r: Redemption): RedemptionSummary {
  return { id: r.id, status: r.status, open: isOpenStatus(r.status), updatedAt: r.updatedAt };
}

// ---- note / personal-data guard ----

const PERSONAL_KEYS = /^(name|fullname|firstname|lastname|address|addr|street|city|zip|zipcode|postal|postalcode|postcode|phone|tel|telephone|mobile|email|mail|recipient|shipto|shipping|shippingaddress|tracking|trackingnumber|届け先|宛先|住所|氏名|電話)$/i;

/** Keys that would carry personal data. A request body containing one is refused outright (not silently dropped). */
export function findPersonalDataKey(body: Record<string, unknown> | null | undefined): string | null {
  if (!body) return null;
  for (const key of Object.keys(body)) if (PERSONAL_KEYS.test(key.replace(/[_\-\s]/g, ""))) return key;
  return null;
}

/** Short operator note. Returns null (refuse) when it looks like contact data: an email, 7+ digits in a row, or a postal mark. */
export function sanitizeNote(raw: unknown): { ok: true; note?: string } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") return { ok: true };
  if (typeof raw !== "string" || raw.length > 120) return { ok: false };
  if (/[^\s@]+@[^\s@]+/.test(raw) || /\d[\d\s\-()]{6,}\d/.test(raw) || /〒/.test(raw)) return { ok: false };
  return { ok: true, note: raw.trim() };
}

// ---- state machine ----

const ALLOWED: Record<RedemptionStatus, RedemptionStatus[]> = {
  requested: ["locked", "cancelled"],
  locked: ["shipped", "cancelled", "exception"],
  shipped: ["received", "exception"],
  received: ["retired", "exception"],
  exception: ["received", "locked", "shipped"],
  retired: [],
  cancelled: [],
};

export type TransitionResult = { ok: true } | { ok: false; reason: "wrong_state"; status: RedemptionStatus };

function transition(
  r: Redemption,
  to: RedemptionStatus,
  event: Omit<RedemptionEvent, "at"> | null,
  patch: Partial<Redemption>,
  now: number,
): TransitionResult {
  if (!ALLOWED[r.status].includes(to)) {
    recordAudit("redemption_refused", { wallet: r.wallet, detail: `redemption ${ref(r.id)}: ${r.status} -> ${to} not allowed` }, now);
    return { ok: false, reason: "wrong_state", status: r.status };
  }
  const leavingException = r.status === "exception" && to !== "exception";
  Object.assign(r, patch);
  if (leavingException) {
    r.exceptionReason = undefined;
    r.exceptionFrom = undefined;
  }
  r.status = to;
  r.updatedAt = iso(now);
  if (event) r.events.push({ ...event, at: iso(now) });
  persist();
  return { ok: true };
}

export type CreateResult =
  | { ok: true; redemption: Redemption }
  | { ok: false; reason: "exists"; redemption: Redemption }
  | { ok: false; reason: "asset_busy"; redemption: Redemption }
  | { ok: false; reason: "wallet_cap" | "store_full" };

/** Idempotent by id; one open redemption per asset; capped open redemptions per wallet. Synchronous (no await). */
export function createRedemption(
  input: { id: string; wallet: string; assetId: string; assetAddress: string; assetTitle?: string },
  now = Date.now(),
): CreateResult {
  const all = load();
  const existing = all.get(input.id);
  if (existing) return { ok: false, reason: "exists", redemption: existing };
  const busy = findOpenByAsset(input.assetId);
  if (busy) {
    recordAudit("redemption_refused", { wallet: input.wallet, detail: `${input.assetId}: already in redemption ${ref(busy.id)}` }, now);
    return { ok: false, reason: "asset_busy", redemption: busy };
  }
  if (listForWallet(input.wallet).filter((r) => isOpenStatus(r.status)).length >= MAX_OPEN_PER_WALLET) {
    recordAudit("redemption_refused", { wallet: input.wallet, detail: "open redemption cap reached" }, now);
    return { ok: false, reason: "wallet_cap" };
  }
  if (all.size >= MAX_REDEMPTIONS) return { ok: false, reason: "store_full" };
  const redemption: Redemption = {
    id: input.id,
    assetId: input.assetId,
    assetAddress: input.assetAddress,
    ...(input.assetTitle ? { assetTitle: input.assetTitle } : {}),
    wallet: input.wallet,
    status: "requested",
    createdAt: iso(now),
    updatedAt: iso(now),
    events: [{ kind: "requested", at: iso(now), source: "offchain_evidence", note: "引き取り申請（dry run）" }],
    dryRun: true,
  };
  all.set(redemption.id, redemption);
  persist();
  recordAudit("redemption_requested", { wallet: redemption.wallet, detail: `redemption ${ref(redemption.id)} ${redemption.assetId}` }, now);
  return { ok: true, redemption };
}

export function setLockRequestId(r: Redemption, lockRequestId: string, now = Date.now()) {
  r.lockRequestId = lockRequestId;
  r.updatedAt = iso(now);
  persist();
  recordAudit("redemption_lock_requested", { wallet: r.wallet, detail: `redemption ${ref(r.id)} lock request ${ref(lockRequestId)}` }, now);
}

export function markLocked(r: Redemption, signature: string | undefined, now = Date.now()): TransitionResult {
  const result = transition(r, "locked", { kind: "locked", source: "onchain", signature, note: "流通Assetをredemption escrowへ移しました（流通停止）" }, { lockSignature: signature }, now);
  if (result.ok) recordAudit("redemption_locked", { wallet: r.wallet, detail: `redemption ${ref(r.id)}${signature ? ` tx ${ref(signature)}` : ""}` }, now);
  return result;
}

export const SHIPPED_NOTE = "保険付き配送相当（dry run、実配送なし）";

export function markShipped(r: Redemption, now = Date.now()): TransitionResult {
  // Shipping is only ever recorded from `locked` (never from `exception`: that goes through `resume`).
  if (r.status !== "locked") {
    recordAudit("redemption_refused", { wallet: r.wallet, detail: `redemption ${ref(r.id)}: ship refused in ${r.status}` }, now);
    return { ok: false, reason: "wrong_state", status: r.status };
  }
  const result = transition(r, "shipped", { kind: "shipped", source: "offchain_evidence", dryRun: true, note: SHIPPED_NOTE }, {}, now);
  if (result.ok) recordAudit("redemption_shipped", { wallet: r.wallet, detail: `redemption ${ref(r.id)} (dry run)` }, now);
  return result;
}

export function markReceived(r: Redemption, now = Date.now()): TransitionResult {
  const retry = r.status === "exception";
  const result = transition(
    r,
    "received",
    { kind: "received", source: "offchain_evidence", dryRun: true, note: retry ? "失効（burn）を再試行（operator）" : "受取確認（dry run、実配送なし）" },
    { exceptionReason: undefined, exceptionFrom: undefined },
    now,
  );
  if (result.ok) recordAudit(retry ? "redemption_retry" : "redemption_received", { wallet: r.wallet, detail: `redemption ${ref(r.id)}` }, now);
  return result;
}

/** Operator `resume`: leaves `exception` and returns to the status the safe stop happened in (locked / shipped). */
export function markResumed(r: Redemption, now = Date.now()): TransitionResult {
  const to = r.exceptionFrom;
  if (r.status !== "exception" || (to !== "locked" && to !== "shipped")) {
    recordAudit("redemption_refused", { wallet: r.wallet, detail: `redemption ${ref(r.id)}: resume not applicable (${r.status}/${to ?? "-"})` }, now);
    return { ok: false, reason: "wrong_state", status: r.status };
  }
  const result = transition(r, to, { kind: to, source: "offchain_evidence", note: "例外から再開（operator）" }, { exceptionReason: undefined, exceptionFrom: undefined }, now);
  if (result.ok) recordAudit("redemption_retry", { wallet: r.wallet, detail: `redemption ${ref(r.id)} resumed at ${to}` }, now);
  return result;
}

export function markRetired(r: Redemption, signature: string, now = Date.now()): TransitionResult {
  const result = transition(r, "retired", { kind: "retired", source: "onchain", signature, note: "流通Assetを失効（burn）しました" }, { retireSignature: signature }, now);
  if (result.ok) recordAudit("redemption_retired", { wallet: r.wallet, detail: `redemption ${ref(r.id)} tx ${ref(signature)}` }, now);
  return result;
}

export function markCancelled(r: Redemption, returnSignature: string | undefined, now = Date.now()): TransitionResult {
  const events: Omit<RedemptionEvent, "at">[] = [];
  if (returnSignature) events.push({ kind: "returned", source: "onchain", signature: returnSignature, note: "escrowからownerへ返却しました" });
  events.push({ kind: "cancelled", source: "offchain_evidence", note: "取消" });
  const first = transition(r, "cancelled", events[0], {}, now);
  if (!first.ok) return first;
  if (events[1]) r.events.push({ ...events[1], at: iso(now) });
  persist();
  recordAudit("redemption_cancelled", { wallet: r.wallet, detail: `redemption ${ref(r.id)}${returnSignature ? ` return tx ${ref(returnSignature)}` : ""}` }, now);
  return first;
}

/** Safe stop: the Asset stays where it is (escrow); nothing else changes. Operator-facing reason, no secrets. */
export function markException(r: Redemption, reason: string, now = Date.now()): TransitionResult {
  const from = r.status;
  const result = transition(r, "exception", { kind: "exception", source: "offchain_evidence", note: reason.slice(0, 200) }, { exceptionReason: reason.slice(0, 200), exceptionFrom: from }, now);
  if (result.ok) recordAudit("redemption_exception", { wallet: r.wallet, detail: `redemption ${ref(r.id)} from ${from}: ${reason.slice(0, 100)}` }, now);
  return result;
}

export function recordRefusal(wallet: string | undefined, detail: string, now = Date.now()) {
  recordAudit("redemption_refused", { wallet, detail }, now);
}

export function listAll(): Redemption[] {
  return Array.from(load().values());
}
