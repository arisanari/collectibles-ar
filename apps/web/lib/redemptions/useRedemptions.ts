"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Redemption } from "../contract";

const POLL_MS = 4000;

async function call(url: string, method: "GET" | "POST", body?: unknown) {
  const res = await fetch(url, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

/**
 * Redemptions (Redeem Physical, dry run) of the authenticated wallet and the owner actions: request,
 * cancel, confirm receipt. The Phantom signature for the lock is NOT handled here: the request appears in
 * 「承認待ちの依頼」 (useTransferRequests). No personal data is ever sent from this hook.
 */
export function useRedemptions(wallet: string | null, onChanged?: () => void) {
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [notice, setNotice] = useState("");
  const inFlight = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const res = await call("/api/redemptions", "GET").catch(() => null);
    if (res?.ok) setRedemptions((res.data as { redemptions: Redemption[] }).redemptions);
  }, []);

  useEffect(() => {
    if (!wallet) return;
    const first = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [wallet, refresh]);

  const setError = (id: string, message?: string) => setErrors((e) => ({ ...e, [id]: message }));

  /** Creates the redemption (status `requested`) and its lock approval; returns true when created. */
  const request = useCallback(
    async (assetId: string): Promise<boolean> => {
      setNotice("");
      const res = await call("/api/redemptions", "POST", { requestId: crypto.randomUUID(), assetId });
      if (!res.ok) {
        const message = typeof res.data.message === "string" ? res.data.message : "";
        const reasons = Array.isArray(res.data.reasons) ? (res.data.reasons as string[]).join(", ") : "";
        setNotice(
          res.status === 409 && res.data.error === "redemption_in_progress"
            ? "This work already has a redemption in progress"
            : res.status === 403
              ? typeof res.data.error === "string" && res.data.error.startsWith("not_owner")
                ? "This wallet is not the current owner on devnet"
                : "Could not submit the request (check the server's devnet signing setup)"
              : `Could not submit the request${message || reasons ? `: ${message || reasons}` : ""}`,
        );
        return false;
      }
      await refresh();
      onChanged?.();
      return true;
    },
    [refresh, onChanged],
  );

  const act = useCallback(
    async (id: string, action: "cancel" | "receive") => {
      if (inFlight.current.has(id)) return;
      inFlight.current.add(id);
      setBusy((b) => ({ ...b, [id]: true }));
      setError(id);
      try {
        const res = await call(`/api/redemptions/${id}/${action}`, "POST", {});
        if (!res.ok) setError(id, typeof res.data.error === "string" ? res.data.error : "Could not complete the action");
      } catch {
        setError(id, "Something went wrong while processing");
      } finally {
        inFlight.current.delete(id);
        setBusy((b) => ({ ...b, [id]: false }));
        void refresh();
        onChanged?.();
      }
    },
    [refresh, onChanged],
  );

  return {
    redemptions,
    busy,
    errors,
    notice,
    request,
    cancel: (id: string) => act(id, "cancel"),
    receive: (id: string) => act(id, "receive"),
    refresh,
  };
}

export type RedemptionsState = ReturnType<typeof useRedemptions>;
