import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { CapacityPlannerClient } from "./capacity-planner-client";

export const metadata: Metadata = toolMetadata("capacity-planner");

export default function CapacityPlannerPage() {
  return <CapacityPlannerClient />;
}
