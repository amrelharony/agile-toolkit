import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface VulnData {
  cve?: string;
  severity: string;
  status: string;
  ageDays: number;
  slaTargetDays: number;
  slaBreached: boolean;
  owner?: string;
  description?: string;
}

export function generateVulnPrompts(data: {
  vulns: VulnData[];
  totalOpen: number;
  slaBreaches: number;
  avgResolveDays: number | null;
  criticalHigh: number;
}): PromptDefinition[] {
  if (data.vulns.length === 0) return [];

  const table = formatTable(
    ["CVE", "Severity", "Status", "Age (d)", "SLA (d)", "Breach?", "Owner", "Description"],
    data.vulns
      .slice(0, 25)
      .map((v) => [
        v.cve ?? "—",
        v.severity,
        v.status,
        v.ageDays.toFixed(0),
        v.slaTargetDays,
        v.slaBreached ? "YES" : "no",
        v.owner ?? "—",
        (v.description ?? "—").slice(0, 80),
      ])
  );

  const avgLine =
    data.avgResolveDays !== null
      ? `Avg time-to-resolve: ${data.avgResolveDays.toFixed(1)}d.`
      : "No vulns resolved yet — no MTTR available.";

  return [
    {
      id: "vuln-sla",
      title: "SLA Risk Hotspots",
      description:
        "Find vulns at the highest risk of (or already in) SLA breach and explain the systemic causes.",
      prompt:
        buildPreamble(
          "Vulnerability Burn-Down",
          `${data.totalOpen} open vuln(s); ${data.slaBreaches} SLA breach(es); ${data.criticalHigh} critical+high open. ${avgLine}`
        ) +
        `## Open vulns\n\n${table}\n\n## Questions\n\n1. List vulns currently in SLA breach and the ones within 25% of their SLA target.\n2. Are breaches concentrated by severity, owner, or component? Surface the pattern.\n3. Suggest one process change that would prevent the next batch of breaches.`,
    },
    {
      id: "vuln-triage",
      title: "Backlog Triage Strategy",
      description:
        "Prescribe a triage strategy that drains the open backlog without starving new work.",
      prompt:
        buildPreamble(
          "Vulnerability Burn-Down",
          `${data.totalOpen} open vuln(s), ${data.criticalHigh} critical+high.`
        ) +
        `## Vulns\n\n${table}\n\n## Questions\n\n1. Recommend a triage queue order: which vulns ship first this sprint and why?\n2. Are any vulns better moved to "accepted" with a documented compensating control?\n3. Estimate weekly throughput needed to clear the backlog in 90 days.`,
    },
  ];
}
