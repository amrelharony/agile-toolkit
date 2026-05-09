import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface Component {
  id: string;
  name: string;
  evolution: number;
  visibility: number;
  description?: string;
}

interface Link {
  id: string;
  fromId: string;
  toId: string;
}

const STAGES = ["Genesis", "Custom", "Product", "Commodity"] as const;

function evolutionStage(e: number): (typeof STAGES)[number] {
  if (e < 0.25) return "Genesis";
  if (e < 0.5) return "Custom";
  if (e < 0.75) return "Product";
  return "Commodity";
}

export function generateWardleyMapPrompts(data: {
  components: Component[];
  links: Link[];
}): PromptDefinition[] {
  if (data.components.length === 0) return [];

  const compTable = formatTable(
    ["Component", "Stage", "Evolution", "Visibility", "Description"],
    data.components
      .slice(0, 25)
      .map((c) => [
        c.name,
        evolutionStage(c.evolution),
        c.evolution.toFixed(2),
        c.visibility.toFixed(2),
        (c.description ?? "—").slice(0, 60),
      ])
  );

  const nameById = (id: string) =>
    data.components.find((c) => c.id === id)?.name ?? id;
  const linkLines =
    data.links.length === 0
      ? "(no links)"
      : data.links
          .slice(0, 30)
          .map((l) => `- ${nameById(l.fromId)} → ${nameById(l.toId)}`)
          .join("\n");

  const stageCounts: Record<(typeof STAGES)[number], number> = {
    Genesis: 0,
    Custom: 0,
    Product: 0,
    Commodity: 0,
  };
  for (const c of data.components) stageCounts[evolutionStage(c.evolution)]++;
  const avgEvo =
    data.components.reduce((s, c) => s + c.evolution, 0) /
    data.components.length;

  return [
    {
      id: "wm-critique",
      title: "Map critique — strategic risks",
      description: "Surface strategic risks visible in the current shape of the map.",
      prompt:
        buildPreamble(
          "Wardley Map Canvas",
          `${data.components.length} components, ${data.links.length} links. Stage distribution — Genesis: ${stageCounts.Genesis}, Custom: ${stageCounts.Custom}, Product: ${stageCounts.Product}, Commodity: ${stageCounts.Commodity}. Avg evolution: ${avgEvo.toFixed(2)}.`
        ) +
        `## Components\n\n${compTable}\n\n## Links\n\n${linkLines}\n\n## Questions\n\n1. Which components in Custom or Product look like they should already be Commodity (i.e. the team is building bespoke what they could buy)?\n2. Are user-visible (high-visibility) components anchored on fragile Genesis-stage dependencies?\n3. Where does the value chain reveal a single point of failure?\n4. What two strategic moves (build/buy/outsource/migrate) would most reduce risk?`,
    },
    {
      id: "wm-stage",
      title: "Evolution stage check",
      description: "Critique whether each component is placed at a defensible evolution stage.",
      prompt:
        buildPreamble(
          "Wardley Map Canvas",
          `Component placement on the evolution axis is the single most-debated part of a Wardley map.`
        ) +
        `## Components\n\n${compTable}\n\n## Questions\n\n1. For each component, is the evolution stage defensible? Flag any that look mis-placed and explain.\n2. Which components are most likely to move stage in the next 12 months?\n3. Suggest one external signal you would track to validate each predicted move.\n4. Are there components missing from the chain that the user would notice if they vanished?`,
    },
  ];
}
