import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shared snapshot",
  description: "A read-only copy of an Agile Toolkit board, shared as a link.",
  // Each link's content lives in its #fragment; there's nothing to index.
  robots: { index: false, follow: false },
};

export default function SnapshotLayout({ children }: { children: React.ReactNode }) {
  return children;
}
