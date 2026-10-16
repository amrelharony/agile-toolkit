import type { Metadata } from "next";
import { TokenCostTrackerClient } from "./token-cost-tracker-client";

export const metadata: Metadata = {
  title: "Token-Cost Tracker",
  description:
    "Per-feature token-spend rollup with cost forecast, budget alerts, and model-mix optimisation.",
};

export default function Page() {
  return <TokenCostTrackerClient />;
}
