import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "../components/AuthProvider";
import { SiteFooter, SiteHeader } from "../components/SiteHeader";

export const metadata: Metadata = {
  title: "Collectibles AR — Your collectibles. Summon in AR.",
  description: "Real graded cards on Solana, in AR, wherever you are. Bring the cards in your wallet or pull a new one, and see them in AR. The card stays in the vault.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: browser extensions add attributes to <html> (for example data-redeviation-bs-uid) before
    // React hydrates, which logs a mismatch warning. It only silences attribute differences on this one element.
    <html lang="en" suppressHydrationWarning>
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
