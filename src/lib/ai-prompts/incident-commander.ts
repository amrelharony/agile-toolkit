import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface IncidentLite {
  title: string;
  severity: string;
  status: string;
  openedAt: string;
  resolvedAt?: string;
  commander?: string;
  scribe?: string;
  description?: string;
  timelineCount: number;
}

export function generateIncidentCommanderPrompts(data: {
  incidents: IncidentLite[];
  openCount: number;
  avgMttrHours: number | null;
  bySeverity: Record<string, number>;
}): PromptDefinition[] {
  if (data.incidents.length === 0) return [];

  const recentTable = formatTable(
    ["Title", "Severity", "Status", "Commander", "Timeline #", "Description"],
    data.incidents.slice(0, 15).map((i) => [
      i.title,
      i.severity,
      i.status,
      i.commander ?? "—",
      i.timelineCount,
      (i.description ?? "—").slice(0, 80),
    ])
  );

  const sevTable = formatTable(
    ["Severity", "Count (last 30d)"],
    Object.entries(data.bySeverity).map(([sev, n]) => [sev, n])
  );

  const mttrText =
    data.avgMttrHours === null
      ? "No resolved incidents yet."
      : `Average MTTR (7d): ${data.avgMttrHours.toFixed(2)} hours.`;

  return [
    {
      id: "incident-response-review",
      title: "Incident response review",
      description:
        "Review recent incident handling, commander/scribe coverage, and timeline discipline.",
      prompt:
        buildPreamble(
          "Incident Commander",
          `${data.openCount} open incidents. ${mttrText}`
        ) +
        `## Severity distribution\n\n${sevTable}\n\n## Recent incidents\n\n${recentTable}\n\n## Questions\n\n1. Is the team logging timeline entries densely enough to support a future post-mortem?\n2. Are commander and scribe roles consistently assigned, or is there a coverage gap?\n3. Where does response time appear to slip — paging, coordination, or comms?\n4. Recommend three concrete drills for the next quarter.`,
    },
    {
      id: "severity-calibration",
      title: "Severity calibration",
      description:
        "Check whether severity ratings appear consistent across incidents and recommend a calibration exercise.",
      prompt:
        buildPreamble(
          "Incident Commander",
          "Severity ratings drive paging, comms cadence, and post-mortem requirements. Mis-calibration causes alert fatigue or under-reaction."
        ) +
        `## Recent incidents\n\n${recentTable}\n\n## Severity counts (last 30d)\n\n${sevTable}\n\n## Questions\n\n1. Looking at the titles and descriptions, do the severity assignments look defensible?\n2. Are sev1/sev2 incidents over- or under-represented vs. industry norms?\n3. Draft a one-paragraph severity matrix for the team to align on.\n4. What proxy signals (customer impact, revenue, MTTD) should be added to the rubric?`,
    },
  ];
}
