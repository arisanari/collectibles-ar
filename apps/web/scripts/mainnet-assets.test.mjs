// Unit test for the READ-ONLY mainnet My Collection: the Helius client's network switch (fetch is mocked, no real
// call), the collection-only card filter, the 60 s cache, GET /api/solana/assets?network=mainnet, and the guard that
// makes every write route refuse mainnet. No network, no chain, no real key.
//   node --experimental-strip-types --no-warnings --test scripts/mainnet-assets.test.mjs
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

process.env.HELIUS_API_KEY = "unit-test-key-not-real";
register("./ts-resolve-hooks.mjs", import.meta.url);
const helius = await import("../lib/solana/heliusClient.ts");
const n = await import("../lib/gacha/normalize.ts");
const mainnetAssets = await import("../lib/solana/mainnetAssets.ts");
const { refuseMainnet, parseNetworkParam } = await import("../lib/network.ts");
const { psaCertUrl, explorerAddressUrl, explorerTxUrl } = await import("../lib/labels.ts");
const route = await import("../app/api/solana/assets/route.ts");

const MAINNET_COLL = "CCryptUfeFSZ3Fgc9FLeKrhLVAP67FSqi1GuVoj9CRac";
const DEVNET_COLL = "CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf";
const WALLET = "11111111111111111111111111111112"; // base58, 32 bytes
const attrs = [
  { trait_type: "Type", value: "Card" },
  { trait_type: "The Grade", value: "GEM-MT 10" },
  { trait_type: "Grading Company", value: "PSA" },
  { trait_type: "Grading ID", value: "10000001" },
  { trait_type: "Insured Value", value: "487" },
  { trait_type: "Vault", value: "PSA Vault" },
  { trait_type: "Vault ID", value: "V-1" },
];
const das = (id, over = {}) => ({
  id,
  interface: "MplCoreAsset",
  content: { json_uri: "https://example.invalid/x.json", links: { image: "https://img.example/card.png" }, metadata: { name: `Card ${id}`, attributes: attrs } },
  grouping: [{ group_key: "collection", group_value: MAINNET_COLL }],
  ownership: { owner: WALLET },
  mutable: false,
  burnt: false,
  ...over,
});

// fetch mock ------------------------------------------------------------------------------------------------------

const realFetch = globalThis.fetch;
function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), method: body.method, params: body.params });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: handler(body) }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return calls;
}
test.afterEach(() => {
  globalThis.fetch = realFetch;
  mainnetAssets.clearMainnetAssetsCacheForTests();
});

// Helius client -----------------------------------------------------------------------------------------------------

test("getAssetsByOwner: devnet by default, the mainnet host only when asked, one DAS read call", async () => {
  const calls = mockFetch(() => ({ total: 0, items: [] }));
  await helius.getAssetsByOwner(WALLET);
  await helius.getAssetsByOwner(WALLET, "mainnet");
  assert.ok(calls[0].url.startsWith("https://devnet.helius-rpc.com/"));
  assert.ok(calls[1].url.startsWith("https://mainnet.helius-rpc.com/"));
  assert.deepEqual(calls.map((c) => c.method), ["getAssetsByOwner", "getAssetsByOwner"]);
});

test("getAssetsByOwner mainnet: reads the next page only while a page is full (devnet stays one call)", async () => {
  const page = (n) => Array.from({ length: n }, (_, i) => das(`Asset${i}-${Math.random()}`));
  let served = 0;
  const calls = mockFetch((body) => {
    served++;
    return { total: 1200, items: body.params.page === 1 ? page(1000) : page(200) };
  });
  const result = await helius.getAssetsByOwner(WALLET, "mainnet");
  assert.equal(calls.length, 2);
  assert.equal(result.items.length, 1200);
  assert.deepEqual(calls.map((c) => c.params.page), [1, 2]);
  served = 0;
  const devnetCalls = mockFetch(() => ({ total: 1000, items: page(1000) }));
  await helius.getAssetsByOwner(WALLET);
  assert.equal(devnetCalls.length, 1);
  assert.equal(served, 0);
});

// Collection-only filter ---------------------------------------------------------------------------------------------

test("mainnetCardsFromAssets: only the configured mainnet collection; shape-only, other collection, burnt are dropped", () => {
  const inColl = das("MintInCollection11111111111111111111111111111");
  const shapeOnly = das("MintShapeOnly111111111111111111111111111111", { grouping: [{ group_key: "collection", group_value: "SomeoneElse" }] });
  const devnetColl = das("MintDevnetColl1111111111111111111111111111111", { grouping: [{ group_key: "collection", group_value: DEVNET_COLL }] });
  const burnt = das("MintBurnt11111111111111111111111111111111111", { burnt: true });
  const plain = das("MintPlain111111111111111111111111111111111111", { content: { json_uri: "", metadata: { name: "Not a card" } }, grouping: [] });
  const cards = n.mainnetCardsFromAssets([shapeOnly, inColl, devnetColl, burnt, plain], [MAINNET_COLL]);
  assert.equal(cards.length, 1);
  const [card] = cards;
  assert.equal(card.address, inColl.id);
  assert.equal(card.category, "card");
  assert.equal(card.source, "collectorCrypt");
  assert.equal(card.sourceVerified, true);
  assert.equal(card.network, "mainnet");
  assert.equal(card.owner, WALLET);
  assert.equal(card.gradingCompany, "PSA");
  assert.equal(card.gradingId, "10000001");
  assert.equal(card.imageUrl, "https://img.example/card.png");
  assert.deepEqual(card.provenance, []);
  assert.deepEqual(n.mainnetCardsFromAssets([inColl, shapeOnly], []), [], "no collection configured -> nothing, shape never qualifies");
});

test("heliusCardToAsset keeps its devnet behaviour (shape-only card is still listed, unverified)", () => {
  const shapeOnly = das("MintShapeOnly111111111111111111111111111111", { grouping: [] });
  const card = n.heliusCardToAsset(shapeOnly, { collectionAddresses: [MAINNET_COLL] });
  assert.equal(card.sourceVerified, false);
  assert.equal(n.heliusCardToAsset(shapeOnly, { collectionAddresses: [MAINNET_COLL], requireVerified: true }), null);
});

// Cache -----------------------------------------------------------------------------------------------------------

test("loadMainnetCards: 60 s server cache per wallet, shared in-flight call, failures not cached", async () => {
  const env = { COLLECTOR_CRYPT_COLLECTION_ADDRESSES_MAINNET: MAINNET_COLL };
  let calls = 0;
  const fetchOwned = async () => (calls++, { total: 1, items: [das("MintCached11111111111111111111111111111111111")] });
  const T = 1_800_000_000_000;
  const [a, b] = await Promise.all([mainnetAssets.loadMainnetCards(WALLET, { fetchOwned, env, now: T }), mainnetAssets.loadMainnetCards(WALLET, { fetchOwned, env, now: T })]);
  assert.equal(calls, 1);
  assert.equal(a.length, 1);
  assert.deepEqual(a, b);
  await mainnetAssets.loadMainnetCards(WALLET, { fetchOwned, env, now: T + 59_999 });
  assert.equal(calls, 1);
  await mainnetAssets.loadMainnetCards(WALLET, { fetchOwned, env, now: T + 60_000 });
  assert.equal(calls, 2);

  mainnetAssets.clearMainnetAssetsCacheForTests();
  let attempts = 0;
  const flaky = async () => {
    attempts++;
    if (attempts === 1) throw new Error("boom");
    return { total: 0, items: [] };
  };
  await assert.rejects(mainnetAssets.loadMainnetCards(WALLET, { fetchOwned: flaky, env, now: T }));
  assert.deepEqual(await mainnetAssets.loadMainnetCards(WALLET, { fetchOwned: flaky, env, now: T + 1 }), []);
  assert.equal(attempts, 2);
});

// Route -----------------------------------------------------------------------------------------------------------

const getAssets = (query) => route.GET(new Request(`http://localhost:3000/api/solana/assets${query}`));

test("GET /api/solana/assets?network=mainnet: collection cards only, mainnet host, cached; bad input is 400", async () => {
  process.env.COLLECTOR_CRYPT_COLLECTION_ADDRESSES_MAINNET = MAINNET_COLL;
  const calls = mockFetch(() => ({
    total: 2,
    items: [das("MintRoute111111111111111111111111111111111111"), das("MintRoute222222222222222222222222222222222222", { grouping: [] })],
  }));
  const res = await getAssets(`?wallet=${WALLET}&network=mainnet`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].network, "mainnet");
  assert.equal(body[0].sourceVerified, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith("https://mainnet.helius-rpc.com/"));
  assert.equal((await getAssets(`?wallet=${WALLET}&network=mainnet`)).status, 200);
  assert.equal(calls.length, 1, "second call is served from the 60 s cache");

  assert.equal((await getAssets("?network=mainnet")).status, 400);
  assert.equal((await getAssets("?wallet=not-a-wallet&network=mainnet")).status, 400);
  assert.equal((await getAssets(`?wallet=${WALLET}&network=ethereum`)).status, 400);
  delete process.env.COLLECTOR_CRYPT_COLLECTION_ADDRESSES_MAINNET;
});

test("mainnet with an upstream failure is 502 and never leaks the key", async () => {
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  const res = await getAssets(`?wallet=${WALLET}&network=mainnet`);
  assert.equal(res.status, 502);
  assert.equal((await res.text()).includes("unit-test-key"), false);
});

// Write guard -------------------------------------------------------------------------------------------------------

test("refuseMainnet: query or JSON body naming mainnet is 400 and the body stays readable; devnet/none pass", async () => {
  const post = (url, body) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const byQuery = await refuseMainnet(post("http://localhost/api/gacha/pack?network=mainnet", { packType: "pokemon_25" }));
  assert.equal(byQuery.status, 400);
  assert.equal((await byQuery.json()).error, "mainnet_not_supported");
  const byBody = await refuseMainnet(post("http://localhost/api/gacha/pack", { packType: "pokemon_25", network: "mainnet" }));
  assert.equal(byBody.status, 400);
  assert.equal((await refuseMainnet(post("http://localhost/api/gacha/pack", { network: " MAINNET " }))).status, 400);
  const ok = post("http://localhost/api/gacha/pack", { packType: "pokemon_25", network: "devnet" });
  assert.equal(await refuseMainnet(ok), null);
  assert.deepEqual(await ok.json(), { packType: "pokemon_25", network: "devnet" });
  assert.equal(await refuseMainnet(post("http://localhost/api/gacha/pack", { packType: "pokemon_25" })), null);
  assert.equal(await refuseMainnet(post("http://localhost/api/gacha/pack")), null);
  assert.equal(await refuseMainnet(new Request("http://localhost/api/gacha/buyback?nft=x")), null);
  assert.equal((await refuseMainnet(new Request("http://localhost/api/gacha/buyback?nft=x&network=mainnet"))).status, 400);
});

test("every write route calls refuseMainnet first", async () => {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("grep", ["-rLE", "refuseMainnet", "--include=route.ts", "app/api"], { encoding: "utf8" }).split("\n").filter(Boolean);
  // Read-only / session-only routes that are allowed not to call it.
  const allowed = [
    "app/api/auth/", "app/api/link/", "app/api/solana/registry/", "app/api/devnet/capabilities/", "app/api/vault/", "app/api/passports/",
    "app/api/operator/", "app/api/gacha/machines/", "app/api/redemptions/[id]/route.ts", "app/api/acquisitions/[id]/route.ts",
    "app/api/transfer-requests/[id]/route.ts", "app/api/devnet/transfer/[requestId]/route.ts", "app/api/solana/assets/[assetId]/route.ts",
    "app/api/solana/assets/[assetId]/buyback-quote/route.ts",
    "app/api/solana/assets/route.ts", // the one route that accepts network=mainnet (read-only DAS)
  ];
  const missing = out.filter((f) => !allowed.some((a) => f.startsWith(a) || f === a));
  assert.deepEqual(missing, []);
});

// Labels ------------------------------------------------------------------------------------------------------------

test("PSA cert link only for Grading Company PSA with a numeric cert; Explorer URLs per network", () => {
  assert.equal(psaCertUrl("PSA", "10000001"), "https://www.psacard.com/cert/10000001");
  assert.equal(psaCertUrl("psa ", " 12345678 "), "https://www.psacard.com/cert/12345678");
  assert.equal(psaCertUrl("BGS", "10000001"), undefined);
  assert.equal(psaCertUrl(undefined, "10000001"), undefined);
  assert.equal(psaCertUrl("PSA", undefined), undefined);
  assert.equal(psaCertUrl("PSA", "12/../x"), undefined);
  assert.equal(explorerAddressUrl("Abc"), "https://explorer.solana.com/address/Abc?cluster=devnet");
  assert.equal(explorerAddressUrl("Abc", "mainnet"), "https://explorer.solana.com/address/Abc");
  assert.equal(explorerTxUrl("Sig", "mainnet"), "https://explorer.solana.com/tx/Sig");
  assert.equal(parseNetworkParam(null), "devnet");
  assert.equal(parseNetworkParam("mainnet"), "mainnet");
  assert.equal(parseNetworkParam("x"), null);
});
