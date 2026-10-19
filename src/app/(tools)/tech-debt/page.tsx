import { TechDebtClient } from "./tech-debt-client";

export const metadata = {
  title: "Technical Debt Tracker",
  description: "Track technical debt with impact × effort, interest rate, and hotspot heatmap.",
};

export default function Page() {
  return <TechDebtClient />;
}
