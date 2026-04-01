import type { Metadata } from "next";
import { PrioritizerClient } from "./prioritizer-client";

export const metadata: Metadata = {
  title: "Backlog Prioritizer",
  description:
    "Multi-framework backlog prioritization: MoSCoW, WSJF, RICE scoring, and Value vs. Effort matrix.",
};

export default function PrioritizerPage() {
  return <PrioritizerClient />;
}
