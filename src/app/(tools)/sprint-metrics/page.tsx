import type { Metadata } from "next";
import { SprintMetricsClient } from "./sprint-metrics-client";

export const metadata: Metadata = {
  title: "Sprint Metrics",
  description:
    "Every sprint in one place: committed, scope, done, pace against the ideal line and the recent average, with links into Burndown, Burnup, Velocity, Sprint Comparison and Release Planner.",
};

export default function SprintMetricsPage() {
  return <SprintMetricsClient />;
}
