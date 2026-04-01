import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface EstimationGuideData {
  selectedScale: string;
  descriptions: Record<string, string>;
  examples: Record<string, string>;
}

export function generateEstimationGuidePrompts(data: EstimationGuideData): PromptDefinition[] {
  const keys = Object.keys(data.descriptions);
  if (keys.length === 0) return [];

  const table = formatTable(
    ["Point Value", "Description", "Team Examples"],
    keys.map((k) => [k, data.descriptions[k] || "(none)", data.examples[k] || "(none)"])
  );

  return [
    {
      id: "estimation-calibration",
      title: "Estimation Calibration Review",
      description: "Evaluate whether the scale descriptions and examples are clear and consistent.",
      prompt: buildPreamble("Estimation Reference Guide", `The team uses the "${data.selectedScale}" estimation scale.`) +
        `## Current Scale\n\n${table}\n\n## Questions\n\n1. Are the descriptions clear enough that a new team member could use them? What's ambiguous?\n2. Do the examples represent a consistent progression of complexity/effort between levels?\n3. Are there any gaps in the scale where the team might struggle to choose between two values?\n4. Suggest improved descriptions for any points that seem vague or overlapping.\n5. What 2-3 additional example stories would you add to each point value to make calibration easier?`,
    },
    {
      id: "estimation-workshop",
      title: "Calibration Workshop Plan",
      description: "Design a team estimation calibration exercise using this scale.",
      prompt: buildPreamble("Estimation Reference Guide", "Design a calibration workshop for the team.") +
        `## Current Scale: ${data.selectedScale}\n\n${table}\n\n## Questions\n\n1. Design a 30-minute estimation calibration workshop agenda for this team.\n2. Create 5 hypothetical user stories at different complexity levels for the team to estimate together.\n3. What discussion questions help teams align on what separates each point value?\n4. How should the team handle disagreements during estimation? Outline a protocol.\n5. What signs indicate the team needs to recalibrate their estimation scale?`,
    },
  ];
}
