import { RunbookScorerClient } from "./runbook-scorer-client";

export const metadata = {
  title: "Runbook Maturity Scorer",
  description:
    "Score each runbook on freshness, completeness, and tested-status with a team-wide hygiene index.",
};

export default function Page() {
  return <RunbookScorerClient />;
}
