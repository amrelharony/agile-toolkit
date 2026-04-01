import type { Metadata } from "next";
import { CycleTimeClient } from "./cycle-time-client";

export const metadata: Metadata = {
  title: "Cycle Time Analyzer",
  description:
    "Histogram, scatter plot, and percentile analysis with SLE calculator for your team's delivery cycle times.",
};

export default function CycleTimePage() {
  return <CycleTimeClient />;
}
