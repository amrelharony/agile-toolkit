import type { Metadata } from "next";
import { RlhfLogClient } from "./rlhf-log-client";

export const metadata: Metadata = {
  title: "RLHF Feedback Log — Agile Toolkit",
  description:
    "Pairwise comparisons + ratings dataset: prompt, A, B, winner, reviewer, reason.",
};

export default function Page() {
  return <RlhfLogClient />;
}
