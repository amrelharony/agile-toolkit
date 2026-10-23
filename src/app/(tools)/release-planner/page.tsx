import type { Metadata } from "next";
import { ReleasePlannerClient } from "./release-planner-client";

export const metadata: Metadata = {
  title: "Release Planner",
  description:
    "Monte Carlo release forecast from the backlog or a story-map slice and the team's velocity: the date to commit to, and the chance of hitting a target date.",
};

export default function ReleasePlannerPage() {
  return <ReleasePlannerClient />;
}
