// Smoke test for /api/link/* and the owner-only /api/devnet/transfer (Issue #45).
//
//   TWINFOLD_SESSION_SECRET=dummy-secret-0123456789 TWINFOLD_DEVNET_SERVER_SIGNING=1 \
//     TWINFOLD_LINK_CODE_TTL_MS=1500 npx next dev -p 3100
//   node scripts/link-smoke.mjs http://localhost:3100 [--lockout]
//
// - TWINFOLD_DEVNET_SERVER_SIGNING=1 is needed so the transfer route gets past its dev guard
//   to the auth checks. NO real transfer is ever sent: only refusal paths are asserted.
// - TWINFOLD_LINK_CODE_TTL_MS (the same value, ms) lets the expiry check run; without it that check is skipped.
// - --lockout also exercises the per-IP lockout (adds ~11 failed attempts to the global counter).
// Generates throwaway ed25519 keys in memory (nothing is written to disk, no real wallet is touched).
import { generateKeyPairSync, sign } from "node:crypto";

const base = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "http://localhost:3000";
const withLockout = process.argv.includes("--lockout");
const ttlMs = Number(process.env.TWINFOLD_LINK_CODE_TTL_MS) || 0;
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = (buf) => {
  let n = BigInt("0x" + buf.toString("hex"));
  let s = "";
  while (n > 0n) {
    s = A[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of buf) {
    if (b) break;
    s = "1" + s;
  }
  return s;
};
const newWallet = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, address: b58(publicKey.export({ format: "der", type: "spki" }).subarray(12)) };
};
const origin = new URL(base).origin;
const post = (path, body, { cookie, headers = {}, origin: o = origin } = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(o && { Origin: o }), ...(cookie && { cookie }), ...headers },
    body: JSON.stringify(body ?? {}),
  });
const get = (path, { cookie, bearer } = {}) =>
  fetch(base + path, { headers: { ...(cookie && { cookie }), ...(bearer && { Authorization: `Bearer ${bearer}` }) } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : extra);
  if (!ok) failures++;
};

// Sign in a throwaway wallet through the real challenge/verify flow; returns its session cookie.
async function signIn(wallet, priorSessionCookie) {
  const chRes = await post("/api/auth/challenge", { wallet: wallet.address });
  const ch = await chRes.json();
  const preauth = (chRes.headers.get("set-cookie") ?? "").split(";")[0];
  const signature = b58(sign(null, Buffer.from(ch.message), wallet.privateKey));
  const res = await post(
    "/api/auth/verify",
    { wallet: wallet.address, nonce: ch.nonce, signature },
    { cookie: priorSessionCookie ? `${preauth}; ${priorSessionCookie}` : preauth },
  );
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

const me = newWallet();
const cookie = await signIn(me);

// --- code issuance
check("code issue without session -> 401", (await post("/api/link/code", {})).status === 401);
check("code issue with foreign Origin -> 403", (await post("/api/link/code", {}, { cookie, origin: "https://evil.example" })).status === 403);
const issuedRes = await post("/api/link/code", {}, { cookie });
const issued = await issuedRes.json();
check("code issue with session -> 200 {code, expiresAt}", issuedRes.status === 200 && /^[A-Z2-9]{8}$/.test(issued.code) && !!issued.expiresAt, JSON.stringify(issued));
check("grouped display XXXX-XXXX", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(issued.display ?? ""));
const ttl = Date.parse(issued.expiresAt) - Date.now();
check("TTL is about 2 minutes (or the test override)", ttlMs ? ttl <= ttlMs + 500 : ttl > 100_000 && ttl <= 120_500, `ttl=${ttl}`);

// --- exchange
check("exchange without code -> 400", (await post("/api/link/exchange", {}, { origin: null })).status === 400);
const ex = await post("/api/link/exchange", { code: issued.display.toLowerCase(), deviceName: "Smoke iPhone" }, { origin: null });
const exBody = await ex.json();
check("exchange (dash/lowercase tolerated, no cookie/Origin) -> 200 {token, wallet, expiresAt}", ex.status === 200 && exBody.wallet === me.address && !!exBody.token, JSON.stringify(exBody));
const hours = (Date.parse(exBody.expiresAt) - Date.now()) / 3_600_000;
check("device token TTL about 12h", hours > 11.9 && hours <= 12.01, `hours=${hours}`);
check("device token is distinct from the web cookie", exBody.token?.startsWith("tfd1.") && !cookie.includes(exBody.token));
const reuse = await post("/api/link/exchange", { code: issued.code }, { origin: null });
check("reused code -> 409 already_used", reuse.status === 409 && (await reuse.json()).error === "already_used");
const unknown = await post("/api/link/exchange", { code: "ZZZZ-ZZZZ" }, { origin: null });
check("unknown code -> 404 unknown_code", unknown.status === 404 && (await unknown.json()).error === "unknown_code");
const bad = await post("/api/link/exchange", { code: "0O1I-LLLL" }, { origin: null });
check("malformed code -> 400 invalid_code", bad.status === 400 && (await bad.json()).error === "invalid_code");

if (ttlMs) {
  const short = await (await post("/api/link/code", {}, { cookie })).json();
  await sleep(ttlMs + 300);
  const late = await post("/api/link/exchange", { code: short.code }, { origin: null });
  check("expired code -> 410 expired", late.status === 410 && (await late.json()).error === "expired");
} else {
  console.log("SKIP expired code check (start the server and this script with TWINFOLD_LINK_CODE_TTL_MS)");
}

const second = await (await post("/api/link/code", {}, { cookie })).json();
const replaced = await (await post("/api/link/code", {}, { cookie })).json();
check(
  "one live code per wallet: a new code invalidates the previous one",
  (await post("/api/link/exchange", { code: second.code }, { origin: null })).status === 404 &&
    (await post("/api/link/exchange", { code: replaced.code }, { origin: null })).status === 200,
);

// --- bearer session
const token = exBody.token;
const sess = await get("/api/link/session", { bearer: token });
check("bearer session -> 200 wallet", sess.status === 200 && (await sess.json()).wallet === me.address);
check("no bearer -> 401", (await get("/api/link/session")).status === 401);
check("tampered bearer -> 401", (await get("/api/link/session", { bearer: token.slice(0, -2) + "xx" })).status === 401);
check("web cookie value is not a valid bearer -> 401", (await get("/api/link/session", { bearer: cookie.split("=")[1] })).status === 401);

// --- devices list + audit (web session)
const devices = await (await get("/api/link/devices", { cookie })).json();
check("devices lists the linked iPhone", devices.devices?.some((d) => d.name === "Smoke iPhone") && !JSON.stringify(devices).includes(token));
check("devices requires web session", (await get("/api/link/devices")).status === 401 && (await get("/api/link/devices", { bearer: token })).status === 401);
const audit = await (await get("/api/link/audit", { cookie })).json();
const events = new Set((audit.events ?? []).map((e) => e.event));
check("audit has issued / exchanged / failed", ["code_issued", "code_exchanged", "code_exchange_failed"].every((e) => events.has(e)), [...events].join(","));
check("audit never contains the code or token", !JSON.stringify(audit).includes(token) && !JSON.stringify(audit).includes(issued.code));

// --- server-signed transfer is no longer an owner path (refusal paths only; nothing is ever sent)
const transferBody = { requestId: "link-smoke-never-sent", assetId: "tf-ukiyoe-001", from: "owner-a", to: "owner-b" };
const caps = await (await get("/api/devnet/capabilities")).json();
const flagOn = caps.serverSignedTestTransfers === true;
console.log(`INFO insecure dev flag ${flagOn ? "ON" : "off"} (capabilities.serverSignedTestTransfers=${caps.serverSignedTestTransfers})`);
const phantom = await post("/api/devnet/transfer", transferBody, { cookie });
const phantomBody = await phantom.json();
check("transfer, authenticated non-test wallet (cookie) -> 403", phantom.status === 403, `${phantom.status} ${JSON.stringify(phantomBody)}`);
const phantomBearer = await post("/api/devnet/transfer", transferBody, { headers: { Authorization: `Bearer ${token}` }, origin: null });
check("transfer, authenticated non-test wallet (device token) -> 403", phantomBearer.status === 403);
check("transfer with revoked/garbage bearer -> 401 or 403", [401, 403].includes((await post("/api/devnet/transfer", transferBody, { headers: { Authorization: "Bearer tfd1.x.y" }, origin: null })).status));
if (!flagOn) {
  check("flag off: unauthenticated transfer -> 403 (server signing disabled)", (await post("/api/devnet/transfer", transferBody, { origin: null })).status === 403);
  check("flag off: transfer status without auth -> 401", (await get("/api/devnet/transfer/link-smoke-never-sent")).status === 401);
} else {
  check("flag on: Phantom-required message for non-test wallet", String(phantomBody.error).includes("Phantom"));
}

// --- transfer requests (owner approves with Phantom on the Web)
const reqBody = { requestId: "smoke-request-0001", assetId: "tf-ukiyoe-001", kind: "buyback" };
check("create request without auth -> 401", (await post("/api/transfer-requests", reqBody, { origin: null })).status === 401);
check("create request, cookie + foreign Origin -> 403", (await post("/api/transfer-requests", reqBody, { cookie, origin: "https://evil.example" })).status === 403);
check("create request, bad input -> 400", (await post("/api/transfer-requests", { requestId: "x" }, { headers: { Authorization: `Bearer ${token}` }, origin: null })).status === 400);
const created = await post("/api/transfer-requests", reqBody, { headers: { Authorization: `Bearer ${token}` }, origin: null });
if (created.status === 403) check("create request for an asset the wallet does not own -> 403 not_owner", (await created.json()).error?.startsWith("not_owner"));
else console.log(`SKIP not-owner check (status ${created.status}: needs SOLANA_ASSET_ADDRESSES + a real HELIUS_API_KEY)`);
check("list requires web session (bearer -> 401)", (await get("/api/transfer-requests", { bearer: token })).status === 401 && (await get("/api/transfer-requests")).status === 401);
check("list with web session -> 200", (await get("/api/transfer-requests", { cookie })).status === 200);
check("status without auth -> 401", (await get("/api/transfer-requests/smoke-request-0001")).status === 401);
check("status of unknown request -> 404", (await get("/api/transfer-requests/nope-nope-nope", { bearer: token })).status === 404);
for (const action of ["prepare", "submit", "reject"]) {
  const url = `/api/transfer-requests/smoke-request-0001/${action}`;
  check(`${action}: no auth -> 401`, (await post(url, {}, { origin: null })).status === 401);
  check(`${action}: device token is not enough -> 401`, (await post(url, {}, { headers: { Authorization: `Bearer ${token}` }, origin: null })).status === 401);
  check(`${action}: cookie + foreign Origin -> 403`, (await post(url, {}, { cookie, origin: "https://evil.example" })).status === 403);
  check(`${action}: unknown request (web session) -> 404`, (await post(url, { signedTransaction: "AAAA" }, { cookie })).status === 404);
}

// --- revocation
const logoutWallet = newWallet();
const logoutCookie = await signIn(logoutWallet);
const lc = await (await post("/api/link/code", {}, { cookie: logoutCookie })).json();
const lt = await (await post("/api/link/exchange", { code: lc.code }, { origin: null })).json();
check("second wallet's device token works", (await get("/api/link/session", { bearer: lt.token })).status === 200);

check("revoke requires web session", (await post("/api/link/revoke", {})).status === 401);
const rev = await post("/api/link/revoke", {}, { cookie });
check("revoke -> 200", rev.status === 200 && (await rev.json()).revoked >= 1);
check("revoked token -> 401", (await get("/api/link/session", { bearer: token })).status === 401);
check("revoke did not touch another wallet's device", (await get("/api/link/session", { bearer: lt.token })).status === 200);
check("devices empty after revoke", ((await (await get("/api/link/devices", { cookie })).json()).devices ?? ["x"]).length === 0);

const out = await post("/api/auth/logout", {}, { cookie: logoutCookie });
check("logout -> 200 and revokes that wallet's device tokens", out.status === 200 && (await get("/api/link/session", { bearer: lt.token })).status === 401);

// --- "Twinfoldから取得" auth paths (Issue #60). Only refusal paths: no real transfer is ever sent.
{
  const acq = { requestId: "smoke-acq-0001", assetId: "tf-does-not-exist" };
  check("acquisition POST without auth -> 401", (await post("/api/acquisitions", acq, { origin: null })).status === 401);
  check("acquisition POST with a bad Bearer token -> 401", (await post("/api/acquisitions", acq, { origin: null, headers: { Authorization: "Bearer nope" } })).status === 401);
  check("acquisition POST with a session but foreign Origin -> 403", (await post("/api/acquisitions", acq, { cookie, origin: "https://evil.example" })).status === 403);
  check("acquisition POST with a session and an invalid body -> 400", (await post("/api/acquisitions", { requestId: "x" }, { cookie })).status === 400);
  const unknown = await post("/api/acquisitions", acq, { cookie });
  check("acquisition POST for an unconfigured asset is refused (404/403/503), never a transfer", [404, 403, 503].includes(unknown.status), String(unknown.status));
  check("acquisition GET without auth -> 401", (await get("/api/acquisitions/smoke-acq-0001")).status === 401);
  check("acquisition GET list without auth -> 401", (await get("/api/acquisitions")).status === 401);
  check("acquisition GET of an unknown id with a session -> 404", (await get("/api/acquisitions/smoke-acq-0001", { cookie })).status === 404);
  const bearerAcq = await (await post("/api/link/code", {}, { cookie })).json();
  const dev = await (await post("/api/link/exchange", { code: bearerAcq.code, deviceName: "Acq iPhone" }, { origin: null })).json();
  check("acquisition GET of an unknown id with a device Bearer token -> 404 (token accepted)", (await get("/api/acquisitions/smoke-acq-0001", { bearer: dev.token })).status === 404);
  const vaultList = await get("/api/vault/assets");
  check("GET /api/vault/assets answers without credentials (200, or 502/503 when devnet/vault is not configured)", [200, 502, 503].includes(vaultList.status), String(vaultList.status));
}

// --- signing in as a different wallet revokes the previous wallet's device tokens (review A5)
{
  const w1 = newWallet();
  const w2 = newWallet();
  const c1 = await signIn(w1);
  const code1 = await (await post("/api/link/code", {}, { cookie: c1 })).json();
  const ex1 = await (await post("/api/link/exchange", { code: code1.code, deviceName: "A5 iPhone" }, { origin: null })).json();
  check("A5: device token works before the wallet switch", (await get("/api/link/session", { bearer: ex1.token })).status === 200);
  await signIn(w2, c1); // the browser still carries w1's session cookie while w2 signs in
  check("A5: device token of the previous wallet -> 401 after signing in as another wallet", (await get("/api/link/session", { bearer: ex1.token })).status === 401);
}

// --- lockout (opt-in)
if (withLockout) {
  const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
  let last = 0;
  for (let i = 0; i < 12; i++) {
    last = (await post("/api/link/exchange", { code: "ABCD-EFGH" }, { origin: null, headers: { "X-Forwarded-For": ip } })).status;
  }
  check("brute force -> 429 lockout", last === 429, `last=${last}`);
} else {
  console.log("SKIP lockout check (pass --lockout)");
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
