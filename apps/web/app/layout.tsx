import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "../components/AuthProvider";
import { SiteFooter, SiteHeader } from "../components/SiteHeader";

export const metadata: Metadata = {
  title: "Twinfold — Collect what matters",
  description: "Own real-world collectibles on Solana. Starting with ukiyo-e prints on your wall.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>
        <AuthProvider>
          <SiteHeader />
          {children}
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}
