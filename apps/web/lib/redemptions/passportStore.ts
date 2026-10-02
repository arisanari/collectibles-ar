import type { RedeemedProvenancePassport, TwinfoldAsset } from "../contract";
import { recordAudit } from "../link/audit";
import { readJsonFile, writeJsonFileAtomic } from "../persist/jsonFile";

// File-backed Passport store (survives a dev-server restart). A Passport is a public provenance record:
// it holds no personal data and no wallet beyond what is already on chain. Written once per Asset;
// a second write for the same assetId is ignored (idempotent).

const FILE = "passports.json";
type Persisted = { passports: Record<string, RedeemedProvenancePassport> };
const g = globalThis as unknown as { __twinfoldPassports?: Map<string, RedeemedProvenancePassport> };

function load(): Map<string, RedeemedProvenancePassport> {
  if (g.__twinfoldPassports) return g.__twinfoldPassports;
  const data = readJsonFile<Persisted>(FILE, { passports: {} });
  g.__twinfoldPassports = new Map(Object.entries(data.passports));
  return g.__twinfoldPassports;
}

export function reloadPassportsFromDiskForTests() {
  g.__twinfoldPassports = undefined;
}

export function getPassport(assetId: string): RedeemedProvenancePassport | undefined {
  return load().get(assetId);
}

/** Returns false when a Passport for this Asset already exists (not overwritten). */
export function savePassport(passport: RedeemedProvenancePassport): boolean {
  const all = load();
  if (all.has(passport.assetId)) return false;
  all.set(passport.assetId, passport);
  writeJsonFileAtomic(FILE, { passports: Object.fromEntries(all) } satisfies Persisted);
  recordAudit("passport_written", { detail: `passport ${passport.assetId}` });
  return true;
}

// Pre-burn snapshot of the Asset (public chain facts + Twinfold's off-chain record), taken right before the
// burn so the Passport never depends on the chain still serving a burnt Asset.
const SNAP_FILE = "passport-snapshots.json";
type Snaps = { snapshots: Record<string, TwinfoldAsset> };
const gs = globalThis as unknown as { __twinfoldSnapshots?: Map<string, TwinfoldAsset> };

function loadSnaps(): Map<string, TwinfoldAsset> {
  if (gs.__twinfoldSnapshots) return gs.__twinfoldSnapshots;
  const data = readJsonFile<Snaps>(SNAP_FILE, { snapshots: {} });
  gs.__twinfoldSnapshots = new Map(Object.entries(data.snapshots));
  return gs.__twinfoldSnapshots;
}

export function saveSnapshot(assetId: string, asset: TwinfoldAsset): void {
  const all = loadSnaps();
  all.set(assetId, asset);
  writeJsonFileAtomic(SNAP_FILE, { snapshots: Object.fromEntries(all) } satisfies Snaps);
}

export function getSnapshot(assetId: string): TwinfoldAsset | undefined {
  return loadSnaps().get(assetId);
}
