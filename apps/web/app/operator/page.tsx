import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OperatorConsole } from "../../components/OperatorConsole";
import { assertDevnetServerSigningAllowed } from "../../lib/solana/devnetSigningGuard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Operator (dry run) — OshiPin", robots: { index: false, follow: false } };

/** Dev-only: 404 unless the devnet server-signing guard passes (never in production, devnet only, explicit opt-in). */
export default function OperatorPage() {
  try {
    assertDevnetServerSigningAllowed();
  } catch {
    notFound();
  }
  return <OperatorConsole />;
}
