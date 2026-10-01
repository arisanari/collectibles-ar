"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useWalletAuth } from "../lib/auth/useWalletAuth";

type WalletAuth = ReturnType<typeof useWalletAuth>;

const AuthContext = createContext<WalletAuth | null>(null);

/** Single useWalletAuth instance shared by every route (mounted in the root layout). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useWalletAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): WalletAuth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside <AuthProvider>");
  return auth;
}
