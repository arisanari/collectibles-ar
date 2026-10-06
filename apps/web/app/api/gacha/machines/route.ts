import { NextResponse } from "next/server";
import { getGachaProvider } from "../../../../lib/gacha";
import { cachedMachines } from "../../../../lib/gacha/machinesCache";
import { gachaErrorResponse } from "../../../../lib/gacha/routeUtils";

export const dynamic = "force-dynamic";

/**
 * GET /api/gacha/machines[?demo=1]
 * Machines (price, odds, EV, stock, buyback %) exactly as Collector Crypt publishes them; nothing is computed here.
 * Cached on the server for 30 seconds. `fetchedAt` is when Collector Crypt was really asked, so the UI can show how
 * old the numbers are. `demo=1` returns the DEMO DATA machine.
 */
export async function GET(request: Request) {
  const demo = new URL(request.url).searchParams.get("demo") === "1";
  try {
    const provider = getGachaProvider({ demo });
    const { machines, fetchedAt } = await cachedMachines(provider.isDemoData ? "demo" : provider.network, () => provider.listMachines());
    return NextResponse.json({ isDemoData: provider.isDemoData, network: provider.network, fetchedAt, machines });
  } catch (error) {
    return gachaErrorResponse(error);
  }
}
