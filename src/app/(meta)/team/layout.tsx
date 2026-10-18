import type { Metadata } from "next";

// The page is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Team",
  description:
    "One list of the people on your team, shared by Standup, Mood Tracker, Kudos, Capacity Planner and Ceremony Timer.",
};

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return children;
}
