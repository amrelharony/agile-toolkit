import type { Metadata } from "next";
import { MaturityClient } from "./maturity-client";

export const metadata: Metadata = {
  title: "Agile Maturity Assessment",
  description:
    "Assess your team's Agile maturity across 8 dimensions with a radar chart visualization and a targeted improvement roadmap.",
};

export default function MaturityPage() {
  return <MaturityClient />;
}
