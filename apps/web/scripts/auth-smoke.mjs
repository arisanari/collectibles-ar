// Smoke test for /api/auth/*.
// Run the server with a secret, then this script:
//   TWINFOLD_SESSION_SECRET=$(openssl rand -base64 32) npm run dev
//   node scripts/auth-smoke.mjs [http://localhost:3000]
// Generates a throwaway ed25519 key in memory (nothing is written to disk).
import { generateKeyPairSync, sign } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:3000";
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
const post = (path, body, cookie, headers = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...(cookie && { cookie }), ...headers },
    body: JSON.stringify(body),
  });
// Returns the challenge plus the pre-auth cookie ("browser") it is bound to.
const challenge = async (wallet) => {
  const res = await post("/api/auth/challenge", { wallet });
  const body = await res.json();
  return { ...body, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] };
};

let failures = 0;
const check = (name, ok) => {
  console.log(ok ? "PASS" : "FAIL", name);
  if (!ok) failures++;
};

const me = newWallet();
const ch = await challenge(me.address);
const goodSig = b58(sign(null, Buffer.from(ch.message), me.privateKey));
check(
  "bad signature -> 401",
  (await post("/api/auth/verify", { wallet: me.address, nonce: ch.nonce, signature: b58(Buffer.alloc(64, 1)) }, ch.cookie)).status === 401,
);
check(
  "nonce is burned after a failed attempt",
  (await post("/api/auth/verify", { wallet: me.address, nonce: ch.nonce, signature: goodSig }, ch.cookie)).status === 401,
);

const ch2 = await challenge(me.address);
const sig2 = b58(sign(null, Buffer.from(ch2.message), me.privateKey));
const ok = await post("/api/auth/verify", { wallet: me.address, nonce: ch2.nonce, signature: sig2 }, ch2.cookie);
check("valid signature -> 200", ok.status === 200);
const setCookie = ok.headers.get("set-cookie") ?? "";
check("cookie is HttpOnly + SameSite=Lax", /httponly/i.test(setCookie) && /samesite=lax/i.test(setCookie));
check("replayed nonce -> 401", (await post("/api/auth/verify", { wallet: me.address, nonce: ch2.nonce, signature: sig2 }, ch2.cookie)).status === 401);

const session = await fetch(base + "/api/auth/session", { headers: { cookie: setCookie.split(";")[0] } });
check("session returns the wallet", session.status === 200 && (await session.json()).wallet === me.address);
check("no cookie -> 401", (await fetch(base + "/api/auth/session")).status === 401);

const other = newWallet();
const ch3 = await challenge(me.address);
check(
  "wallet mismatch -> 401",
  (await post("/api/auth/verify", { wallet: other.address, nonce: ch3.nonce, signature: sig2 }, ch3.cookie)).status === 401,
);
check("unknown nonce -> 401", (await post("/api/auth/verify", { wallet: me.address, nonce: "nope", signature: sig2 }, ch3.cookie)).status === 401);
const ch4 = await challenge(me.address);
const sig4 = b58(sign(null, Buffer.from(ch4.message), me.privateKey));
const ch5 = await challenge(me.address);
const sig5 = b58(sign(null, Buffer.from(ch5.message), me.privateKey));
check("older challenge replaced by newer one for same wallet", (await post("/api/auth/verify", { wallet: me.address, nonce: ch4.nonce, signature: sig4 }, ch4.cookie)).status === 401);
check("missing pre-auth cookie -> 401", (await post("/api/auth/verify", { wallet: me.address, nonce: ch5.nonce, signature: sig5 })).status === 401);
const ch6 = await challenge(me.address);
const sig6 = b58(sign(null, Buffer.from(ch6.message), me.privateKey));
check("other browser's cookie -> 401", (await post("/api/auth/verify", { wallet: me.address, nonce: ch6.nonce, signature: sig6 }, "twinfold_preauth=deadbeef")).status === 401);
check("Origin: null -> 403", (await post("/api/auth/challenge", { wallet: me.address }, undefined, { Origin: "null" })).status === 403);
check("missing Origin -> 403", (await fetch(base + "/api/auth/challenge", { method: "POST", body: JSON.stringify({ wallet: me.address }) })).status === 403);
check("foreign Origin on verify -> 403", (await post("/api/auth/verify", { wallet: me.address, nonce: "x", signature: sig5 }, undefined, { Origin: "https://evil.example" })).status === 403);
check("oversize wallet -> 400", (await post("/api/auth/challenge", { wallet: "1".repeat(45) })).status === 400);
check("oversize signature -> 400", (await post("/api/auth/verify", { wallet: me.address, nonce: "x", signature: "1".repeat(89) })).status === 400);
check("oversize body -> 400", (await post("/api/auth/challenge", { wallet: me.address, pad: "x".repeat(5000) })).status === 400);
check("logout clears cookie", /max-age=0/i.test((await post("/api/auth/logout", {})).headers.get("set-cookie") ?? ""));
process.exit(failures ? 1 : 0);
