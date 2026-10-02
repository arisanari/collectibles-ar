// Smoke test for the redeem dry run API auth paths (401 / 403 / 404 / 400). NO chain call is ever made:
// every request here is refused before any Solana RPC / Helius access.
//
//   TWINFOLD_SESSION_SECRET=dummy-secret-0123456789 TWINFOLD_DEVNET_SERVER_SIGNING=1 \
//     TWINFOLD_OPERATOR_TOKEN=smoke-operator-token TWINFOLD_DATA_DIR=/tmp/twinfold-smoke-data \
//     npx next dev -p 3100
//   node scripts/redemption-smoke.mjs http://localhost:3100
//
// Generates a throwaway ed25519 key in memory (nothing is written to disk, no real wallet is touched).
import { generateKeyPairSync, sign } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:3000";
const origin = new URL(base).origin;
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
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const address = b58(publicKey.export({ format: "der", type: "spki" }).subarray(12));

const post = (path, body, cookie, headers = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...(cookie && { cookie }), ...headers },
    body: JSON.stringify(body),
  });

let failures = 0;
const check = (name, ok) => {
  console.log(ok ? "PASS" : "FAIL", name);
  if (!ok) failures++;
};

// Sign in with the throwaway wallet (same flow as the Web: challenge -> signature -> session cookie).
const challengeRes = await post("/api/auth/challenge", { wallet: address });
const challenge = await challengeRes.json();
const preauth = (challengeRes.headers.get("set-cookie") ?? "").split(";")[0];
const signature = b58(sign(null, Buffer.from(challenge.message), privateKey));
const verified = await post("/api/auth/verify", { wallet: address, nonce: challenge.nonce, signature }, preauth);
const session = (verified.headers.get("set-cookie") ?? "").split(";")[0];
check("session established with a throwaway wallet", verified.status === 200 && !!session);

const body = { requestId: "smoke-req-0001", assetId: "smoke-no-such-asset" };
const bearer = { authorization: "Bearer not-a-real-token" };

// ---- 401: no credential ----
check("POST /api/redemptions without a session -> 401", (await post("/api/redemptions", body)).status === 401);
check("GET /api/redemptions without a session -> 401", (await fetch(base + "/api/redemptions")).status === 401);
check("GET /api/redemptions/[id] without a session -> 401", (await fetch(base + "/api/redemptions/smoke-req-0001")).status === 401);
check("POST cancel without a session -> 401", (await post("/api/redemptions/smoke-req-0001/cancel", {})).status === 401);
check("POST receive without a session -> 401", (await post("/api/redemptions/smoke-req-0001/receive", {})).status === 401);
check("bad Bearer token on POST /api/redemptions -> 401", (await post("/api/redemptions", body, undefined, bearer)).status === 401);
check("bad Bearer token on GET /api/redemptions/[id] -> 401", (await fetch(base + "/api/redemptions/smoke-req-0001", { headers: bearer })).status === 401);
check("owner-only cancel/receive do not accept a Bearer token -> 401", (await post("/api/redemptions/smoke-req-0001/cancel", {}, undefined, bearer)).status === 401);

// ---- 403: origin / operator ----
check("POST /api/redemptions with a foreign Origin -> 403", (await post("/api/redemptions", body, session, { Origin: "https://evil.example" })).status === 403);
check("POST receive with a foreign Origin -> 403", (await post("/api/redemptions/smoke-req-0001/receive", {}, session, { Origin: "https://evil.example" })).status === 403);
check("operator action without the operator token -> 403", (await post("/api/redemptions/smoke-req-0001/operator", { action: "ship" })).status === 403);
check("operator action with a wrong operator token -> 403", (await post("/api/redemptions/smoke-req-0001/operator", { action: "ship" }, undefined, { "x-twinfold-operator-token": "wrong" })).status === 403);
check("a web session is not an operator credential -> 403", (await post("/api/redemptions/smoke-req-0001/operator", { action: "ship" }, session)).status === 403);
check("operator list without the token -> 403", (await fetch(base + "/api/operator/redemptions")).status === 403);

// ---- 400 / 404 with a valid session (still no chain call) ----
check("invalid input -> 400", (await post("/api/redemptions", { requestId: "x" }, session)).status === 400);
check("personal data in the body is refused -> 400", (await post("/api/redemptions", { ...body, address: "Tokyo 1-1" }, session)).status === 400);
check("personal data (phone) is refused -> 400", (await post("/api/redemptions", { ...body, phone: "090" }, session)).status === 400);
check("unknown asset -> 404", (await post("/api/redemptions", body, session)).status === 404);
check("GET /api/redemptions/[id] unknown -> 404", (await fetch(base + "/api/redemptions/smoke-req-0001", { headers: { cookie: session } })).status === 404);
check("POST cancel unknown -> 404", (await post("/api/redemptions/smoke-req-0001/cancel", {}, session)).status === 404);
check("POST receive unknown -> 404", (await post("/api/redemptions/smoke-req-0001/receive", {}, session)).status === 404);
check("GET /api/redemptions (own, session) -> 200 with an empty list", await (async () => {
  const res = await fetch(base + "/api/redemptions", { headers: { cookie: session } });
  const json = await res.json().catch(() => ({}));
  return res.status === 200 && Array.isArray(json.redemptions) && json.redemptions.length === 0;
})());

// ---- public Passport ----
check("GET /api/passports/[unknown] -> 404", (await fetch(base + "/api/passports/no-such-asset")).status === 404);
check("GET /api/passports/[invalid] -> 400", (await fetch(base + "/api/passports/" + encodeURIComponent("a b"))).status === 400);
check("/passport/[unknown] page renders (not a 500)", (await fetch(base + "/passport/no-such-asset")).status < 500);

process.exit(failures ? 1 : 0);
