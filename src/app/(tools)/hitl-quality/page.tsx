import type { Metadata } from "next";
import { HitlQualityClient } from "./hitl-quality-client";

export const metadata: Metadata = {
  title: "Human-in-the-Loop Quality Tracker — Agile Toolkit",
  description:
    "Reviewer ratings, agreement rate, disagreement-resolution log, acceptance rate over time.",
};

export default function Page() {
  return <HitlQualityClient />;
}
