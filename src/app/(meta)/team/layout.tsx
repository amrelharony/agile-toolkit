import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Team",
  description:
    "The people on your team and the agreements you work by: the roster, the working agreement, Definition of Ready and Done, the estimation baseline and the ceremony times.",
};

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return children;
}
