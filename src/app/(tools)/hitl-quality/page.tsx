import type { Metadata } from "next";
import { HitlQualityClient } from "./hitl-quality-client";

export const metadata: Metadata = {
  title: "Human-in-the-Loop Quality Tracker",
  description:
    "Reviewer ratings, reviewer–model agreement, reasons for disagreements, and mean rating over time.",
};

export default function Page() {
  return <HitlQualityClient />;
}
