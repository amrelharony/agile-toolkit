import type { Metadata } from "next";
import { WeightedDecisionClient } from "./weighted-decision-client";

export const metadata: Metadata = {
  title: "Weighted Decision Matrix",
  description:
    "Score options against weighted criteria (Pugh / MCDA) — converts gut-feel debates into traceable numbers.",
};

export default function Page() {
  return <WeightedDecisionClient />;
}
