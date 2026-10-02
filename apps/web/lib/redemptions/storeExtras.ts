import type { Redemption } from "../contract";
import { listAll } from "./store";

export function getAllRetired(): Redemption[] {
  return listAll().filter((r) => r.status === "retired");
}
