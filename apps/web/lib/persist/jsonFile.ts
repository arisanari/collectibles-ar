// Server-only. Tiny file-backed JSON persistence for records that must survive a dev-server
// restart (redemptions, Redeemed Provenance Passports). Files live under apps/web/.data/ (gitignored,
// created lazily) or TWINFOLD_DATA_DIR. Writes are atomic (temp file + rename). Nothing stored here
// may contain personal data or secrets; callers store only public chain facts and Twinfold records.
//
// MVP LIMITATION: single-process, local disk. A real backend uses a database.

import * as fs from "node:fs";
import * as path from "node:path";

export function dataDir(): string {
  return process.env.TWINFOLD_DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
}

export function readJsonFile<T>(name: string, fallback: T): T {
  const file = path.join(dataDir(), name);
  try {
    if (!fs.existsSync(/* turbopackIgnore: true */ file)) return fallback;
    return JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, "utf8")) as T;
  } catch (error) {
    // A corrupt file must not be silently replaced by an empty store on the next write.
    throw new Error(`persisted file ${name} is unreadable: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

export function writeJsonFileAtomic(name: string, value: unknown): void {
  const dir = dataDir();
  fs.mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, name);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(/* turbopackIgnore: true */ tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(/* turbopackIgnore: true */ tmp, /* turbopackIgnore: true */ file);
}
