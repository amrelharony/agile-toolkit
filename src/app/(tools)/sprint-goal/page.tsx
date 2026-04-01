import type { Metadata } from "next";
import { SprintGoalClient } from "./sprint-goal-client";

export const metadata: Metadata = { title: "Sprint Goal Builder" };

export default function SprintGoalPage() {
  return <SprintGoalClient />;
}
