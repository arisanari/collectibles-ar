// Unit test for lib/gacha/{normalize,mockProvider,collectorCryptProvider}.ts. No network, no chain.
//   node --experimental-strip-types --no-warnings --test scripts/gacha-normalize.test.mjs
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

register("./ts-resolve-hooks.mjs", import.meta.url);
const n = await import("../lib/gacha/normalize.ts");
const { MockGachaProvider } = await import("../lib/gacha/mockProvider.ts");
const { resolveGachaBaseUrl } = await import("../lib/gacha/collectorCryptProvider.ts");

const attrs = (extra = {}) => {
  const base = {
    Type: "Card",
    "The Grade": "GEM-MT 10",
    "Grading Company": "PSA",
    "Grading ID": "10000001",
    "Insured Value": "487",
    Vault: "OmniVault",
    "Vault ID": "V-1",
    ...extra,
  };
  return Object.entries(base)
    .filter(([, v]) => v !== null)
    .map(([trait_type, value]) => ({ trait_type, value }));
};

const won = (overrides = {}) => ({
  success: true,
  nft_address: "NftAddr1111111111111111111111111111111111",
  transactionSignature: "SigAAAA",
  nftWon: { content: { metadata: { name: "Test Card A", attributes: attrs() } } },
  rarity: "rare",
  roll: 7,
  ...overrides,
});

const FIXED = new Date("2026-10-06T00:00:00Z");

test("openPackToAsset maps card fields, memo, source, network", () => {
  const a = n.openPackToAsset({ won: won(), memo: "memo-1234", owner: "OwnerWallet", now: FIXED, chainConfirmed: true });
  assert.equal(a.category, "card");
  assert.equal(a.source, "collectorCrypt");
  assert.equal(a.sourceVerified, true);
  assert.equal(a.network, "devnet");
  assert.equal(a.gachaMemo, "memo-1234");
  assert.equal(a.title, "Test Card A");
  assert.equal(a.grade, "GEM-MT 10");
  assert.equal(a.gradingCompany, "PSA");
  assert.equal(a.gradingId, "10000001");
  assert.equal(a.insuredValueUsd, 487);
  assert.equal(a.vault, "OmniVault");
  assert.equal(a.vaultId, "V-1");
  assert.equal(a.owner, "OwnerWallet");
  assert.equal(a.id, "tf-card-NftAddr1");
  assert.equal(a.address, "NftAddr1111111111111111111111111111111111");
  assert.equal(a.provenance.length, 1);
  assert.equal(a.provenance[0].source, "onchain");
  assert.equal(a.provenance[0].status, "confirmed");
  assert.equal(a.provenance[0].transaction, "SigAAAA");
  assert.equal(a.provenance[0].occurredAt, "2026-10-06T00:00:00.000Z");
});

test("a signature not confirmed on chain stays pending + offchain_evidence (openPack's say-so is not an onchain fact)", () => {
  for (const chainConfirmed of [undefined, false]) {
    const a = n.openPackToAsset({ won: won(), memo: "memo-1234", owner: "O", now: FIXED, chainConfirmed });
    assert.equal(a.provenance[0].status, "pending");
    assert.equal(a.provenance[0].source, "offchain_evidence");
    assert.equal(a.provenance[0].transaction, "SigAAAA");
  }
  // chainConfirmed without a signature cannot confirm anything
  const none = n.openPackToAsset({ won: won({ transactionSignature: undefined }), memo: "memo-1234", owner: "O", chainConfirmed: true });
  assert.equal(none.provenance[0].status, "pending");
});

test("same memo + same stored time -> identical asset (occurredAt comes from the pack record)", () => {
  const args = { won: won(), memo: "memo-1234", owner: "O", now: FIXED, chainConfirmed: true };
  assert.deepEqual(n.openPackToAsset(args), n.openPackToAsset(args));
});

test("missing attributes stay absent and a non-numeric insured value is not invented", () => {
  const a = n.openPackToAsset({
    won: won({ nftWon: { content: { metadata: { name: "X", attributes: attrs({ "Insured Value": "n/a", Vault: null, "Vault ID": null, "Grading ID": null }) } } } }),
    memo: "memo-1234",
    owner: null,
  });
  assert.equal("insuredValueUsd" in a, false);
  assert.equal("vault" in a, false);
  assert.equal("vaultId" in a, false);
  assert.equal("gradingId" in a, false);
  assert.equal(a.owner, null);
});

test("parseInsuredValue", () => {
  assert.equal(n.parseInsuredValue("487"), 487);
  assert.equal(n.parseInsuredValue("$1,200.50"), 1200.5);
  assert.equal(n.parseInsuredValue("abc"), undefined);
  assert.equal(n.parseInsuredValue(undefined), undefined);
});

test("no signature -> pending provenance", () => {
  const a = n.openPackToAsset({ won: won({ transactionSignature: undefined }), memo: "memo-1234", owner: "O", chainConfirmed: true });
  assert.equal(a.provenance[0].status, "pending");
  assert.equal("transaction" in a.provenance[0], false);
});

test("image: nftWon first, then DAS fallback, https only", () => {
  const withImage = n.openPackToAsset({ won: won({ nftWon: { image: "https://img.example/a.png", content: { metadata: { name: "X" } } } }), memo: "memo-1234", owner: "O", fallbackImageUrl: "https://das.example/b.png" });
  assert.equal(withImage.imageUrl, "https://img.example/a.png");
  assert.equal(withImage.display.imageUrl, "https://img.example/a.png");
  assert.equal(withImage.display.placeholder, false);

  const viaDas = n.openPackToAsset({ won: won(), memo: "memo-1234", owner: "O", fallbackImageUrl: "https://das.example/b.png" });
  assert.equal(viaDas.imageUrl, "https://das.example/b.png");

  const bad = n.openPackToAsset({ won: won({ nftWon: { image: "http://insecure.example/a.png", content: { metadata: { name: "X" } } } }), memo: "memo-1234", owner: "O", fallbackImageUrl: "javascript:alert(1)" });
  assert.equal("imageUrl" in bad, false);
  assert.equal(bad.display.imageUrl, "");
  assert.equal(bad.display.placeholder, true); // no usable image -> the UI shows its placeholder

  assert.equal(n.pickImageUrl({ content: { links: { image: "https://a/x" }, files: [{ uri: "https://a/y", cc_cdn: "https://a/z" }] } }), "https://a/x");
  assert.equal(n.pickImageUrl({ content: { files: [{ uri: "https://a/y", cc_cdn: "https://a/z" }] } }), "https://a/z");
  assert.equal(n.pickImageUrl({ content: { files: [{ uri: "//evil/y" }] } }), undefined);
});

const das = (over = {}) => ({
  id: "DasAsset11111111111111111111111111111111111",
  interface: "ProgrammableNFT",
  content: {
    json_uri: "https://arweave.net/x",
    links: { image: "https://arweave.net/img" },
    metadata: { name: "Pool Card", attributes: attrs() },
  },
  grouping: [{ group_key: "collection", group_value: "CollAddr" }],
  ownership: { owner: "HolderWallet" },
  mutable: true,
  burnt: false,
  ...over,
});

const COLL = "CCryptDevnetCollection1111111111111111111111";

test("isCollectorCryptCard: only a configured collection verifies the source; attributes alone never do", () => {
  const inColl = das({ grouping: [{ group_key: "collection", group_value: COLL }] });
  assert.equal(n.isCollectorCryptCard(inColl, [COLL]), true);
  assert.equal(n.isCollectorCryptCard(inColl, ["Other"]), false);
  assert.equal(n.isCollectorCryptCard(inColl, []), false); // nothing configured -> nothing verified
  assert.equal(n.isCollectorCryptCard(inColl), false);
  const attrsOnly = das({ grouping: [{ group_key: "collection", group_value: "SomeoneElse" }] });
  assert.equal(n.looksLikeGradedCard(attrsOnly), true);
  assert.equal(n.isCollectorCryptCard(attrsOnly, [COLL]), false);
  // a collection match works even without the attributes
  const bare = das({ content: { json_uri: "", metadata: { name: "Plain" } }, grouping: [{ group_key: "collection", group_value: COLL }] });
  assert.equal(n.looksLikeGradedCard(bare), false);
  assert.equal(n.isCollectorCryptCard(bare, [COLL]), true);
  // the group key must be "collection"
  assert.equal(n.isCollectorCryptCard(das({ grouping: [{ group_key: "creator", group_value: COLL }] }), [COLL]), false);
});

test("looksLikeGradedCard needs both Grading Company and Vault ID", () => {
  const oneAttr = das({ content: { json_uri: "", metadata: { name: "Plain", attributes: [{ trait_type: "Grading Company", value: "PSA" }] } } });
  assert.equal(n.looksLikeGradedCard(oneAttr), false);
  const noAttrs = das({ content: { json_uri: "", metadata: { name: "Core thing" } }, grouping: undefined });
  assert.equal(n.looksLikeGradedCard(noAttrs), false);
});

test("heliusCardToAsset: collection match -> source + sourceVerified true", () => {
  const a = n.heliusCardToAsset(das({ grouping: [{ group_key: "collection", group_value: COLL }] }), { collectionAddresses: [COLL] });
  assert.equal(a.category, "card");
  assert.equal(a.source, "collectorCrypt");
  assert.equal(a.sourceVerified, true);
  assert.equal(a.standard, "pnft");
  assert.equal(a.owner, "HolderWallet");
  assert.equal(a.imageUrl, "https://arweave.net/img");
  assert.deepEqual(a.provenance, []);
  assert.equal("gachaMemo" in a, false);
});

test("heliusCardToAsset: attributes only -> card, source undefined, sourceVerified false (UNVERIFIED SOURCE)", () => {
  const a = n.heliusCardToAsset(das());
  assert.equal(a.category, "card");
  assert.equal("source" in a, false);
  assert.equal(a.sourceVerified, false);
  const b = n.heliusCardToAsset(das(), { collectionAddresses: ["NotThisOne"] });
  assert.equal("source" in b, false);
  assert.equal(b.sourceVerified, false);
});

test("heliusCardToAsset: neither collection nor attributes -> null", () => {
  assert.equal(n.heliusCardToAsset(das({ content: { json_uri: "", metadata: { name: "Plain" } }, grouping: [] })), null);
  assert.equal(n.heliusCardToAsset(das({ content: { json_uri: "", metadata: { name: "Plain" } }, grouping: [] }), { collectionAddresses: [COLL] }), null);
});

test("collectionAddressesFromEnv: one variable per network, never mixed", () => {
  const env = {
    COLLECTOR_CRYPT_COLLECTION_ADDRESSES: "Legacy",
    COLLECTOR_CRYPT_COLLECTION_ADDRESSES_DEVNET: " A , B ,,",
    COLLECTOR_CRYPT_COLLECTION_ADDRESSES_MAINNET: "C",
  };
  assert.deepEqual(n.collectionAddressesFromEnv(env, "devnet"), ["A", "B"]);
  assert.deepEqual(n.collectionAddressesFromEnv(env, "mainnet"), ["C"]);
  assert.deepEqual(n.collectionAddressesFromEnv({}, "devnet"), []);
});

test("gachaVerifyUrl", () => {
  assert.equal(n.gachaVerifyUrl("abc-123"), "https://dev-gacha.collectorcrypt.com/verify-selection/abc-123");
});

test("MockGachaProvider: DEMO DATA, waiting then opened, same memo -> same card", async () => {
  const p = new MockGachaProvider();
  assert.equal(p.isDemoData, true);
  const machines = await p.listMachines();
  assert.equal(machines.length, 1);
  const { memo } = await p.generatePack({ playerAddress: "x", packType: machines[0].code });
  const first = await p.openPack({ memo });
  assert.equal(first.state, "waiting");
  const second = await p.openPack({ memo });
  const third = await p.openPack({ memo });
  assert.equal(second.state, "opened");
  assert.equal(third.state, "opened");
  assert.equal(second.won.nft_address, third.won.nft_address);
  const asset = n.openPackToAsset({ won: second.won, memo, owner: "DemoWallet", chainConfirmed: true });
  assert.match(asset.title, /^SlabAR Demo Card #[123]$/);
  assert.equal(asset.category, "card");
  assert.equal(asset.source, "collectorCrypt");
  assert.equal(asset.gachaMemo, memo);
  assert.ok(asset.gradingId.startsWith("DEMO-"));
  assert.ok(asset.imageUrl.startsWith("/artworks/slabar-demo-card-"));
});

test("resolveGachaBaseUrl: devnet default over https, mainnet refused, localhost only outside production", () => {
  assert.equal(resolveGachaBaseUrl(undefined), "https://dev-gacha.collectorcrypt.com");
  assert.equal(resolveGachaBaseUrl(""), "https://dev-gacha.collectorcrypt.com");
  assert.equal(resolveGachaBaseUrl("http://localhost:4010", "development"), "http://localhost:4010");
  assert.equal(resolveGachaBaseUrl("http://127.0.0.1:4010", "test"), "http://127.0.0.1:4010");
  assert.throws(() => resolveGachaBaseUrl("http://localhost:4010", "production"), /production/);
  assert.throws(() => resolveGachaBaseUrl("http://127.0.0.1:4010", "production"), /production/);
  assert.throws(() => resolveGachaBaseUrl("http://dev-gacha.collectorcrypt.com"), /https/); // non-localhost must be https
  assert.throws(() => resolveGachaBaseUrl("http://evil.example"), /devnet/);
  assert.throws(() => resolveGachaBaseUrl("https://gacha.collectorcrypt.com"), /devnet/);
  assert.throws(() => resolveGachaBaseUrl("https://evil.example"), /devnet/);
  assert.throws(() => resolveGachaBaseUrl("not a url"));
});

test("demo cards get distinct stable ids that match the fixture ids", async () => {
  const p = new MockGachaProvider();
  const ids = new Set();
  for (let i = 0; i < 40; i++) {
    const memo = `demo-memo-test-${i}`;
    await p.openPack({ memo });
    const out = await p.openPack({ memo });
    ids.add(n.openPackToAsset({ won: out.won, memo, owner: null }).id);
  }
  assert.deepEqual([...ids].sort(), ["tf-card-DEMO-1-C", "tf-card-DEMO-2-C", "tf-card-DEMO-3-C"]);
});

test("MockGachaProvider keeps at most 100 memo counters (oldest dropped)", async () => {
  const p = new MockGachaProvider();
  const counters = p.calls;
  for (let i = 0; i < 150; i++) await p.openPack({ memo: `cap-memo-${i}` });
  assert.ok(counters.size <= 100, `size ${counters.size}`);
  assert.equal(counters.has("cap-memo-0"), false);
  assert.equal(counters.has("cap-memo-149"), true);
});
