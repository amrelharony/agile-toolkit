import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface ThreatData {
  service: string;
  category: string;
  severity: number;
  status: string;
  mitigation?: string;
  description?: string;
}

/**
 * AI prompts for the Threat Model Registry.
 *
 * Two engineering-leader questions:
 * 1. Where are the STRIDE coverage gaps?
 * 2. How should mitigation work be prioritized?
 */
export function generateThreatModelPrompts(data: {
  threats: ThreatData[];
  totalOpen: number;
  mitigationRate: number;
  servicesCount: number;
}): PromptDefinition[] {
  if (data.threats.length === 0) return [];

  const services = Array.from(new Set(data.threats.map((t) => t.service))).sort();
  const stride = [
    "spoofing",
    "tampering",
    "repudiation",
    "information_disclosure",
    "denial_of_service",
    "elevation_of_privilege",
  ];
  const matrixHeader = ["Service", ...stride];
  const matrixRows = services.map((svc) => [
    svc,
    ...stride.map((cat) =>
      data.threats.filter((t) => t.service === svc && t.category === cat).length
    ),
  ]);
  const matrixTable = formatTable(matrixHeader, matrixRows);

  const threatTable = formatTable(
    ["Service", "Category", "Severity", "Status", "Mitigation", "Description"],
    data.threats
      .slice(0, 25)
      .map((t) => [
        t.service,
        t.category,
        t.severity,
        t.status,
        (t.mitigation ?? "—").slice(0, 80),
        (t.description ?? "—").slice(0, 80),
      ])
  );

  return [
    {
      id: "threat-model-gaps",
      title: "Coverage Gaps by STRIDE Category",
      description:
        "Surface STRIDE categories under-modeled per service so the team knows where to focus the next threat-modeling session.",
      prompt:
        buildPreamble(
          "Threat Model Registry",
          `${data.totalOpen} open threat(s) across ${data.servicesCount} service(s). Mitigation rate ${(data.mitigationRate * 100).toFixed(0)}%.`
        ) +
        `## STRIDE Coverage Matrix\n\n${matrixTable}\n\n## Threats\n\n${threatTable}\n\n## Questions\n\n1. Which (service, STRIDE category) cells are empty and probably under-modeled? Not every cell has to be 1+, but flag the systemic blind spots.\n2. Which services have zero coverage in any category — are they out of scope or just unmodeled?\n3. Recommend the next 1-2 threat-modeling sessions and what to focus on.`,
    },
    {
      id: "threat-model-prioritization",
      title: "Mitigation Prioritization",
      description:
        "Sequence open mitigation work by severity, exploitability, and STRIDE class.",
      prompt:
        buildPreamble(
          "Threat Model Registry",
          `${data.totalOpen} open threat(s); mitigation rate ${(data.mitigationRate * 100).toFixed(0)}%.`
        ) +
        `## Threats\n\n${threatTable}\n\n## Questions\n\n1. Rank the top 5 open threats by mitigation priority. Use severity × likelihood × blast radius (call out your reasoning).\n2. Identify any 'accepted' threats that should probably be re-examined.\n3. Suggest concrete mitigations for the top 3, in plain engineering terms.`,
    },
  ];
}
