// Unit test for GET /api/gacha/packs: the since filter, ordering and limit, the card each opened memo carries
// (same normalizer as /api/gacha/open), pending -> confirmed refresh, and the route's auth (device Bearer token) and
// wallet scoping. No network, no chain. Device tokens come from the real link store with throwaway wallets.
//   node --experimental-strip-types --no-warnings --test scripts/gacha-feed.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.TWINFOLD_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "twinfold-gacha-feed-"));
process.env.TWINFOLD_SESSION_SECRET = "unit-test-secret-0123456789";
register("./ts-resolve-hooks.mjs", import.meta.url);
const store = await import("../lib/gacha/packStore.ts");
const feed = await import("../lib/gacha/packFeed.ts");
const { openPackForUi } = await import("../lib/gacha/openResult.ts");
const { MockGachaProvider } = await import("../lib/gacha/mockProvider.ts");
const { takeSlot } = await import("../lib/rateLimit.ts");
const link = await import("../lib/link/store.ts");
const route = await import("../app/api/gacha/packs/route.ts");

const T0 = Date.parse("2026-10-06T00:00:00Z");
let seq = 0;
const memo = () => `feed-memo-${++seq}-${Math.random().toString(36).slice(2, 8)}`;
const makeOpened = (wallet, createdAt, openedAt, extra = {}) => {
  const r = store.recordGenerated({ memo: memo(), wallet, packType: "pokemon_25" }, createdAt);
  store.markOpened(r, { nftAddress: `Nft-${r.memo}`, txSignature: `Sig-${r.memo}` }, openedAt);
  return Object.assign(r, extra);
};

// ---- shaping ----------------------------------------------------------------------------------------------------

test("parseSince: ISO 8601, empty, invalid, and a '+09:00' whose plus became a space", () => {
  assert.equal(feed.parseSince(null), null);
  assert.equal(feed.parseSince(""), null);
  assert.equal(feed.parseSince("2026-10-06T00:00:00Z"), T0);
  assert.equal(feed.parseSince("2026-10-06T09:00:00 09:00"), T0);
  assert.equal(feed.parseSince("yesterday"), "invalid");
});

test("buildPackFeed: shape, newest openedAt first, unopened sorted by createdAt, asset only for opened", () => {
  const generated = store.recordGenerated({ memo: memo(), wallet: "W-shape", packType: "pokemon_50" }, T0 + 5000);
  const older = makeOpened("W-shape", T0, T0 + 1000);
  const newer = makeOpened("W-shape", T0, T0 + 3000);
  const result = feed.buildPackFeed([older, generated, newer], { wallet: "W-shape" });
  assert.equal(result.wallet, "W-shape");
  assert.deepEqual(result.packs.map((p) => p.memo), [generated.memo, newer.memo, older.memo]);
  const [g, o] = result.packs;
  assert.deepEqual(Object.keys(g).sort(), ["asset", "createdAt", "memo", "nftAddress", "openedAt", "packType", "state"]);
  assert.equal(g.state, "generated");
  assert.equal(g.openedAt, null);
  assert.equal(g.nftAddress, null);
  assert.equal(g.asset, null);
  assert.equal(g.createdAt, new Date(T0 + 5000).toISOString());
  assert.equal(o.state, "opened");
  assert.equal(o.openedAt, new Date(T0 + 3000).toISOString());
  assert.equal(o.nftAddress, `Nft-${newer.memo}`);
  assert.equal(o.asset, null); // no card stored on this synthetic record
});

test("buildPackFeed: `since` keeps records changed at or after it; max 20", () => {
  const old = makeOpened("W-since", T0, T0 + 10);
  const fresh = makeOpened("W-since", T0 + 100_000, T0 + 200_000);
  const justCreated = store.recordGenerated({ memo: memo(), wallet: "W-since", packType: "pokemon_25" }, T0 + 300_000);
  const since = (ms) => feed.buildPackFeed([old, fresh, justCreated], { wallet: "W-since", since: ms }).packs.map((p) => p.memo);
  assert.deepEqual(since(null).length, 3);
  assert.deepEqual(since(T0 + 150_000), [justCreated.memo, fresh.memo]);
  assert.deepEqual(since(T0 + 200_001), [justCreated.memo]);
  assert.deepEqual(since(T0 + 300_001), []);
  const many = Array.from({ length: 25 }, (_, i) => makeOpened("W-many", T0, T0 + i));
  const page = feed.buildPackFeed(many, { wallet: "W-many" }).packs;
  assert.equal(page.length, 20);
  assert.equal(page[0].openedAt, new Date(T0 + 24).toISOString());
});

// ---- the card: same memo, same output ---------------------------------------------------------------------------

test("an opened memo carries exactly the card /api/gacha/open returned (and keeps carrying it)", async () => {
  const provider = new MockGachaProvider();
  const record = store.recordGenerated({ memo: memo(), wallet: "DEMO-PLAYER-WALLET", packType: "demo", demo: true }, T0);
  const first = await openPackForUi(provider, record, "DEMO-PLAYER-WALLET"); // the mock answers "waiting" first
  assert.equal(first.state, "waiting");
  const opened = await openPackForUi(provider, record, "DEMO-PLAYER-WALLET");
  assert.equal(opened.state, "opened");
  const [item] = feed.buildPackFeed([record], { wallet: "x" }).packs;
  assert.equal(item.state, "opened");
  assert.deepEqual(item.asset, opened.asset);
  const again = await openPackForUi(provider, record, "DEMO-PLAYER-WALLET");
  assert.deepEqual(again.asset, opened.asset);
  assert.deepEqual(feed.buildPackFeed([record], { wallet: "x" }).packs[0].asset, opened.asset);
  assert.equal(item.asset.gachaMemo, record.memo);
  assert.equal(item.nftAddress, opened.asset.address);
});

test("the stored card survives a restart (file-backed), image lookups included", async () => {
  const provider = new MockGachaProvider();
  const record = store.recordGenerated({ memo: memo(), wallet: "W-persist", packType: "pokemon_25" }, T0);
  // Not a demo record, so it is persisted; the mock provider stands in for Collector Crypt.
  await openPackForUi(provider, record, "W-persist"); // waiting
  const opened = await openPackForUi(provider, record, "W-persist");
  store.recordAsset(record, { asset: opened.asset, imageUrl: "https://img.example/a.png", assetInterface: "MplCoreAsset" });
  store.reloadFromDiskForTests();
  const reloaded = store.getPack(record.memo);
  assert.deepEqual(reloaded.asset, opened.asset);
  assert.equal(reloaded.imageUrl, "https://img.example/a.png");
  assert.equal(reloaded.assetInterface, "MplCoreAsset");
});

test("recordAsset bumps updatedAt only when the stored card changes", () => {
  const record = makeOpened("W-bump", T0, T0 + 1);
  const asset = { id: "a", provenance: [] };
  store.recordAsset(record, { asset }, T0 + 50);
  assert.equal(record.updatedAt, T0 + 50);
  store.recordAsset(record, { asset: { ...asset } }, T0 + 99);
  assert.equal(record.updatedAt, T0 + 50);
});

test("refreshPendingConfirmations: pending Pull event becomes confirmed + onchain when the chain knows the signature", async () => {
  const provider = new MockGachaProvider();
  const record = store.recordGenerated({ memo: memo(), wallet: "W-pending", packType: "pokemon_25" }, T0);
  await openPackForUi(provider, record, "W-pending"); // waiting
  const opened = await openPackForUi(provider, record, "W-pending");
  // Make it look like the real flow: signature known, chain check negative -> pending.
  const pendingAsset = {
    ...opened.asset,
    provenance: opened.asset.provenance.map((e) => ({ ...e, source: "offchain_evidence", status: "pending" })),
  };
  store.recordAsset(record, { asset: pendingAsset }, T0 + 10);
  record.txSignature = opened.asset.provenance[0].transaction;
  const before = record.updatedAt;

  const calls = [];
  await feed.refreshPendingConfirmations([record], async (sig) => (calls.push(sig), false));
  assert.equal(calls.length, 1);
  assert.equal(record.asset.provenance[0].status, "pending");

  await feed.refreshPendingConfirmations([record], async () => true, 5);
  const event = record.asset.provenance[0];
  assert.equal(event.status, "confirmed");
  assert.equal(event.source, "onchain");
  assert.equal(event.occurredAt, pendingAsset.provenance[0].occurredAt);
  assert.equal(event.transaction, pendingAsset.provenance[0].transaction);
  assert.ok(record.updatedAt >= before);

  const noMoreCalls = [];
  await feed.refreshPendingConfirmations([record], async (sig) => (noMoreCalls.push(sig), true));
  assert.equal(noMoreCalls.length, 0, "a confirmed card is not checked again");
});

test("refreshPendingConfirmations skips DEMO DATA records and caps the checks per call", async () => {
  const demo = feed.demoSampleRecord();
  const calls = [];
  const many = Array.from({ length: 8 }, () => {
    const r = makeOpened("W-cap", T0, T0 + 1);
    store.recordAsset(r, { asset: { id: "x", gachaMemo: r.memo, provenance: [{ id: `x-pull-${r.memo}`, status: "pending", transaction: r.txSignature }] } });
    return r;
  });
  await feed.refreshPendingConfirmations([demo, ...many], async (sig) => (calls.push(sig), false), 5);
  assert.equal(calls.length, 5);
});

test("DEMO DATA feed: demo records, else one fixed sample card; DEMO records never show for a wallet", () => {
  assert.equal(feed.recordsForFeed("W-nobody").length, 0);
  const sample = feed.recordsForFeed(null);
  assert.equal(sample.length >= 1, true);
  const [item] = feed.buildPackFeed([feed.demoSampleRecord()], { wallet: feed.DEMO_FEED_WALLET }).packs;
  assert.equal(item.memo, "demo-memo-sample");
  assert.equal(item.state, "opened");
  assert.match(item.asset.address, /^DEMO-/);
  assert.equal(item.asset.gachaMemo, "demo-memo-sample");
  assert.equal(store.listPacksForWallet("DEMO-PLAYER-WALLET").length, 0);
});

// ---- the route: auth, wallet scoping, since, mainnet, rate limit ------------------------------------------------

function deviceTokenFor(wallet) {
  const code = link.issueLinkCode(wallet);
  assert.equal(code.ok, true);
  const exchanged = link.exchangeLinkCode(code.code, "test iPhone", `ip-${wallet}`);
  assert.equal(exchanged.ok, true);
  return exchanged.token;
}
const get = (query = "", token) =>
  route.GET(new Request(`http://localhost:3000/api/gacha/packs${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));

test("route: a bad or revoked Bearer token is 401 (no cookie fallback; the cookie path itself is checked against `next dev`)", async () => {
  assert.equal((await get("", "not-a-device-token")).status, 401);
  const wallet = "RevokedWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const token = deviceTokenFor(wallet);
  assert.equal((await get("", token)).status, 200);
  link.revokeDevicesForWallet(wallet, "test");
  assert.equal((await get("", token)).status, 401);
});

test("route: a device token sees only its own wallet's Pulls, newest first, with the stored card", async () => {
  const walletA = "RouteWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const walletB = "RouteWalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  const provider = new MockGachaProvider();
  const mine = store.recordGenerated({ memo: memo(), wallet: walletA, packType: "pokemon_25" }, Date.now() - 5000);
  await openPackForUi(provider, mine, walletA);
  const opened = await openPackForUi(provider, mine, walletA);
  const theirs = makeOpened(walletB, Date.now() - 4000, Date.now() - 3000);
  const submitted = store.recordGenerated({ memo: memo(), wallet: walletA, packType: "pokemon_50" }, Date.now() - 1000);
  store.markSubmitted(submitted, Date.now() - 900);

  const res = await get("", deviceTokenFor(walletA));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(body.wallet, walletA);
  assert.equal(body.packs.some((p) => p.memo === theirs.memo), false);
  assert.deepEqual(body.packs.map((p) => p.memo).sort(), [mine.memo, submitted.memo].sort());
  const card = body.packs.find((p) => p.memo === mine.memo);
  assert.equal(card.state, "opened");
  assert.deepEqual(card.asset, opened.asset);
  assert.equal(body.packs.find((p) => p.memo === submitted.memo).state, "submitted");

  const other = await (await get("", deviceTokenFor(walletB))).json();
  assert.equal(other.wallet, walletB);
  assert.deepEqual(other.packs.map((p) => p.memo), [theirs.memo]);
});

test("route: `since` filters, a bad `since` is 400, network=mainnet is 400", async () => {
  const wallet = "SinceWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const token = deviceTokenFor(wallet);
  const early = makeOpened(wallet, Date.parse("2026-10-06T01:00:00Z"), Date.parse("2026-10-06T01:05:00Z"));
  const late = makeOpened(wallet, Date.parse("2026-10-06T03:00:00Z"), Date.parse("2026-10-06T03:05:00Z"));
  const all = await (await get("", token)).json();
  assert.deepEqual(all.packs.map((p) => p.memo), [late.memo, early.memo]);
  const res = await get(`?since=${encodeURIComponent("2026-10-06T02:00:00Z")}`, token);
  assert.deepEqual((await res.json()).packs.map((p) => p.memo), [late.memo]);
  assert.equal((await get("?since=garbage", token)).status, 400);
  const refused = await get("?network=mainnet", token);
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).error, "mainnet_not_supported");
});

test("route: FEED_PER_HOUR reads per wallet per hour, then 429", async () => {
  const wallet = "RateWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const token = deviceTokenFor(wallet);
  for (let i = 0; i < feed.FEED_PER_HOUR - 1; i++) assert.equal(takeSlot("gacha_packs_feed", wallet, feed.FEED_PER_HOUR), true);
  assert.equal((await get("", token)).status, 200); // the last one allowed
  assert.equal((await get("", token)).status, 429);
  assert.equal((await get("", deviceTokenFor("OtherRateWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))).status, 200);
});

test("route: demo=1 needs no session and returns DEMO DATA", async () => {
  const res = await get("?demo=1");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.wallet, feed.DEMO_FEED_WALLET);
  assert.ok(body.packs.length >= 1);
  assert.match(body.packs[0].asset.address, /^DEMO-/);
  const later = await (await get(`?demo=1&since=${encodeURIComponent("2030-01-01T00:00:00Z")}`)).json();
  assert.deepEqual(later.packs, []);
});

test("the feed carries lastError only on a record that has one", () => {
  const withError = store.recordGenerated({ memo: `feed-err-${Math.random()}`, wallet: "FeedErrWallet", packType: "pokemon_25" }, T0);
  const clean = store.recordGenerated({ memo: `feed-ok-${Math.random()}`, wallet: "FeedErrWallet", packType: "pokemon_25" }, T0);
  const original = console.error;
  console.error = () => {};
  try {
    store.recordError(withError, { stage: "submit", code: "wallet_not_signer", httpStatus: 400, message: "m" }, T0 + 1);
  } finally {
    console.error = original;
  }
  const items = Object.fromEntries(feed.buildPackFeed([withError, clean], { wallet: "FeedErrWallet" }).packs.map((p) => [p.memo, p]));
  assert.equal(items[withError.memo].lastError.code, "wallet_not_signer");
  assert.equal("lastError" in items[clean.memo], false);
});
