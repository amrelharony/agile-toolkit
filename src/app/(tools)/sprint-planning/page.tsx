import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { SprintPlanningClient } from "./sprint-planning-client";

export const metadata: Metadata = toolMetadata("sprint-planning");

export default function SprintPlanningPage() {
  return <SprintPlanningClient />;
}
