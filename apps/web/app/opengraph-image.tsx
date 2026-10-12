import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Share image for links to the site (Open Graph; X falls back to it). Built once at build time from the hero's poster frame.
export const alt = "Collectibles AR. Your collectibles. Summon in AR.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const poster = await readFile(join(process.cwd(), "public/lp/hero-demo.jpg"));
  const posterSrc = `data:image/jpeg;base64,${poster.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#07080a", color: "#f3f1ea", padding: "0 80px" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 700 }}>
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 6, color: "#a3a59b" }}>COLLECTIBLES AR</div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 26, fontSize: 92, fontWeight: 700, lineHeight: 1, letterSpacing: -4 }}>
            <span>Your collectibles.</span>
            <span style={{ color: "#d9ff43" }}>Summon in AR.</span>
          </div>
          <div style={{ display: "flex", marginTop: 34, fontSize: 30, lineHeight: 1.4, color: "#c9cabf" }}>
            Real graded cards on Solana, in AR.
          </div>
        </div>
        <div style={{ display: "flex", width: 262, height: 536, borderRadius: 44, border: "9px solid #0b0b0d", boxShadow: "0 0 0 2px #5b5d66, 0 0 90px rgba(217,255,67,0.28)", overflow: "hidden", background: "#0b0b0d" }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- rendered to a PNG by ImageResponse, not shown as an element */}
          <img src={posterSrc} width={244} height={518} style={{ objectFit: "cover" }} />
        </div>
      </div>
    ),
    size,
  );
}
