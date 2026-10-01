const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Minimal base58 decoder (Solana addresses / signatures). Returns null on invalid input. */
export function base58Decode(input: string): Uint8Array | null {
  if (!input) return null;
  const bytes: number[] = [];
  for (const char of input) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of input) {
    if (char !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

/** A Solana wallet address is a base58 string that decodes to exactly 32 bytes. */
export function decodeWalletAddress(address: string): Uint8Array | null {
  const bytes = base58Decode(address);
  return bytes && bytes.length === 32 ? bytes : null;
}
