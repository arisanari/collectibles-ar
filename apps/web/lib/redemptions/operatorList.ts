import type { Redemption } from "../contract";
import { passportMissing } from "./flow";
import { listOpen } from "./store";
import { getAllRetired } from "./storeExtras";

/** Open redemptions plus retired ones whose Passport could not be written (operator attention). */
export function getRedemptionsForOperator(): Redemption[] {
  const retiredWithoutPassport = getAllRetired().filter(passportMissing).map((r) => ({ ...r, passportMissing: true }));
  return [...listOpen(), ...retiredWithoutPassport];
}
