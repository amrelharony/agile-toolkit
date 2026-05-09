import { RiskiestAssumptionClient } from "./riskiest-assumption-client";

export const metadata = {
  title: "Riskiest Assumption Canvas — Agile Toolkit",
  description:
    "Lean canvas variant — list assumptions, rank by risk × evidence, and generate test cards.",
};

export default function Page() {
  return <RiskiestAssumptionClient />;
}
