import type { Metadata } from "next";
import { CapacityPlannerClient } from "./capacity-planner-client";

export const metadata: Metadata = {
  title: "Sprint Capacity Planner",
  description:
    "Plan sprint capacity by calculating effective hours for each team member based on availability, days off, ceremony overhead, and focus factor.",
};

export default function CapacityPlannerPage() {
  return <CapacityPlannerClient />;
}
