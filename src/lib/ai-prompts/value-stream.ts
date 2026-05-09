import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface Stage {
  name: string;
  processTime: number;
  leadTime: number;
  completeAccurate: number;
}

export function generateValueStreamPrompts(data: {
  stages: Stage[];
  totalProcess: number;
  totalLead: number;
  flowEfficiency: number;
  rolledCA: number;
}): PromptDefinition[] {
  if (data.stages.length === 0) return [];
  const table = formatTable(
    ["Stage", "Process", "Lead", "Wait", "%C/A"],
    data.stages.map((s) => [s.name, s.processTime, s.leadTime, Math.max(0, s.leadTime - s.processTime), `${s.completeAccurate}%`])
  );
  return [
    {
      id: "vsm-efficiency",
      title: "Flow Efficiency Analysis",
      description: "Coach on where wait time dominates and how to reduce it.",
      prompt:
        buildPreamble(
          "Value Stream Map",
          `Flow efficiency ${data.flowEfficiency.toFixed(0)}%. Rolled %C/A ${data.rolledCA.toFixed(0)}%. Lead ${data.totalLead}d.`
        ) +
        `## Stages\n\n${table}\n\n## Questions\n\n1. Which stages have the worst wait:process ratio?\n2. What organizational causes drive those waits?\n3. Recommend 2-3 targeted interventions (WIP limits, batching, pull policies).`,
    },
    {
      id: "vsm-quality",
      title: "Rolled %C/A Diagnosis",
      description: "Explain why rolled quality drops across stages.",
      prompt:
        buildPreamble(
          "Value Stream Map",
          `Each stage compounds defects into downstream work. Rolled %C/A is ${data.rolledCA.toFixed(0)}%.`
        ) +
        `## Stages\n\n${table}\n\n## Questions\n\n1. Which stage contributes most to the defect chain?\n2. What upstream check could catch problems earlier?\n3. Where should the team invest in feedback loops?`,
    },
  ];
}
