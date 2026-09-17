import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Twinfold — Collect what matters",
  description: "Physical anime art, authenticated and preserved on Solana.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
