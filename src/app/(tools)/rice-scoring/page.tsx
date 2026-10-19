import type { Metadata } from "next";
import { RiceScoringClient } from "./rice-scoring-client";

export const metadata: Metadata = {
  title: "RICE Scoring Calculator",
  description:
    "Score initiatives by Reach × Impact × Confidence ÷ Effort to rank a backlog economically.",
};

export default function Page() {
  return <RiceScoringClient />;
}
