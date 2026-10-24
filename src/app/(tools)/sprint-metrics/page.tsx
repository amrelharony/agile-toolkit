import type { Metadata } from "next";
import { SprintMetricsClient } from "./sprint-metrics-client";

export const metadata: Metadata = {
  title: "Sprint Metrics",
  description:
    "How your sprints went over time: say/do, carry-over and scope churn across the last finished sprints, with links to the cockpit and every sprint tool.",
};

export default function SprintMetricsPage() {
  return <SprintMetricsClient />;
}
