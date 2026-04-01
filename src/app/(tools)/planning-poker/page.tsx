import type { Metadata } from "next";
import { PlanningPokerClient } from "./planning-poker-client";

export const metadata: Metadata = { title: "Planning Poker" };

export default function PlanningPokerPage() {
  return <PlanningPokerClient />;
}
