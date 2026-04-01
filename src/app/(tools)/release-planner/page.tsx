import type { Metadata } from "next";
import { ReleasePlannerClient } from "./release-planner-client";

export const metadata: Metadata = {
  title: "Release Planner",
  description:
    "Monte Carlo simulation for release date forecasting with confidence intervals and sensitivity analysis.",
};

export default function ReleasePlannerPage() {
  return <ReleasePlannerClient />;
}
