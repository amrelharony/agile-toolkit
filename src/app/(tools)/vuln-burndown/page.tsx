import { VulnBurndownClient } from "./vuln-burndown-client";

export const metadata = {
  title: "Vulnerability Burn-Down",
  description:
    "Track open vulnerabilities by severity over time with SLA aging, stacked area chart, and CSV export.",
};

export default function Page() {
  return <VulnBurndownClient />;
}
