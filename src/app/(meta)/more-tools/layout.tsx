import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "More tools",
  description:
    "Tools for neighbouring work — AI product management, security, reliability and strategy — kept off the main navigation. Open them here or show them everywhere.",
};

export default function MoreToolsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
