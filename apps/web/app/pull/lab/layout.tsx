import { notFound } from "next/navigation";

// Read per request, not at build time, so LAB_PAGES can be set on the running server.
export const dynamic = "force-dynamic";

/**
 * The /pull/lab pages are prototypes of the opening effect (DEMO DATA only). In a production build they answer 404 unless
 * LAB_PAGES=1 is set on the server (never NEXT_PUBLIC_). `next dev` serves them as before.
 */
export default function LabLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production" && process.env.LAB_PAGES !== "1") notFound();
  return children;
}
