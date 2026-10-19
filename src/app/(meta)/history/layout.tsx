import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Activity history",
  description: "Everything you've done across the toolkit's tools in this browser.",
};

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
