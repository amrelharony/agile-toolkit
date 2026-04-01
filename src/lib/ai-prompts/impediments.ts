import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, truncateData } from "./prompt-utils";

interface ImpedimentData {
  impediments: {
    title: string;
    description: string;
    category: string;
    severity: string;
    status: string;
    raisedBy: string;
    assignedTo: string;
    raisedDate: string;
    resolvedDate?: string;
  }[];
}

export function generateImpedimentPrompts(data: ImpedimentData): PromptDefinition[] {
  if (data.impediments.length === 0) return [];

  const { data: shown, truncated, totalCount } = truncateData(data.impediments);
  const table = formatTable(
    ["Title", "Category", "Severity", "Status", "Raised", "Assigned To"],
    shown.map((i) => [i.title, i.category, i.severity, i.status, i.raisedDate, i.assignedTo || "-"])
  );
  const note = truncated ? `\n(Showing ${shown.length} of ${totalCount} impediments)\n` : "";

  const open = data.impediments.filter((i) => i.status !== "Resolved");
  const critical = open.filter((i) => i.severity === "Critical" || i.severity === "High");
  const byCategory = data.impediments.reduce((acc, i) => { acc[i.category] = (acc[i.category] || 0) + 1; return acc; }, {} as Record<string, number>);

  return [
    {
      id: "impediment-patterns",
      title: "Impediment Pattern Analysis",
      description: "Find recurring themes, systemic issues, and resolution patterns.",
      prompt: buildPreamble("Impediment Tracker", "It logs blockers and impediments with category, severity, and resolution tracking.") +
        `## Impediments\n\n${table}${note}\n\n## Summary\n\nTotal: ${data.impediments.length} | Open: ${open.length} | Critical/High open: ${critical.length}\nBy category: ${Object.entries(byCategory).map(([k, v]) => `${k}: ${v}`).join(", ")}\n\n## Questions\n\n1. What patterns do you see in the impediments? Are they clustered by category or severity?\n2. Which impediments are systemic (will recur) vs. one-off? What structural changes address the systemic ones?\n3. How does the ratio of open to resolved impediments look? Is the team clearing them fast enough?\n4. Are there impediments that have been open too long? What's blocking resolution?\n5. What metrics should the team track to reduce impediment frequency over time?`,
    },
    {
      id: "impediment-escalation",
      title: "Escalation Strategy",
      description: "Prioritize open impediments and draft escalation paths for critical ones.",
      prompt: buildPreamble("Impediment Tracker", "Help prioritize and escalate impediments effectively.") +
        `## Open Impediments\n\n${formatTable(
          ["Title", "Category", "Severity", "Description"],
          open.slice(0, 10).map((i) => [i.title, i.category, i.severity, i.description.slice(0, 80)])
        )}${open.length > 10 ? `\n(Showing 10 of ${open.length} open impediments)\n` : ""}\n\n## Questions\n\n1. Rank the open impediments by business impact — which should be resolved first?\n2. For each Critical/High impediment, draft a 2-sentence escalation message for management.\n3. Who should own resolution for each impediment? Should any be escalated outside the team?\n4. What is the likely sprint velocity impact if these impediments remain unresolved?\n5. Design a simple impediment triage protocol the team can use at standup.`,
    },
    {
      id: "impediment-rootcause",
      title: "Root Cause Analysis",
      description: "Apply 5-Whys thinking to recurring impediments.",
      prompt: buildPreamble("Impediment Tracker", "Conduct root cause analysis on the team's impediments.") +
        `## All Impediments\n\n${table}${note}\n\nCategory distribution: ${Object.entries(byCategory).map(([k, v]) => `${k}: ${v}`).join(", ")}\n\n## Questions\n\n1. For the top 3 most impactful impediments, apply the 5-Whys technique to find root causes.\n2. Are the root causes within the team's control, or do they require organizational change?\n3. What preventive measures could stop the most common impediment category (${Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0]?.[0]}) from recurring?\n4. Create a brief "impediment prevention checklist" for sprint planning.\n5. What investments (tools, training, process changes) would eliminate the most impediments?`,
    },
  ];
}
