import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "My activity",
  description: "Your streaks, busiest tools and activity trends across the toolkit.",
};

export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
