import type { Metadata } from "next";
import { toolMetadata } from "@/lib/seo/tool-metadata";
import { SprintGoalClient } from "./sprint-goal-client";

export const metadata: Metadata = toolMetadata("sprint-goal");

export default function SprintGoalPage() {
  return <SprintGoalClient />;
}
